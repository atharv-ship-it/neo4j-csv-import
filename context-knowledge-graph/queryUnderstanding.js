// queryUnderstanding.js - LLM-Powered Graph Intelligence
//
// Design principles:
// 1. LLM generates Cypher from actual schema (not hallucinated)
// 2. Conversation memory for context continuity
// 3. Results are validated - only return what exists
// 4. Answers are grounded in actual data

import { runCypher } from "./neo4jClient.js";
import { callLLM } from "./llmClient.js";

// ============================================================================
// STATE
// ============================================================================
let schema = null;
let conversation = {
  history: [],        // [{role: 'user'|'assistant', content: string}]
  lastEntities: [],   // [{type, id, data}] - for resolving "this", "that"
  lastQuery: null,    // Last successful cypher query
  lastResults: []     // Last query results
};

// ============================================================================
// INITIALIZATION - Load actual schema from Neo4j
// ============================================================================
export async function initialize() {
  console.log("🔄 Loading graph schema...");
  schema = await discoverSchema();
  console.log(`✅ Schema: ${schema.nodes.length} node types, ${schema.relationships.length} relationships`);
  return schema;
}

async function discoverSchema() {
  // Get everything about the actual graph structure
  const [nodeData, relData, structureData, sampleData] = await Promise.all([
    // Node types with their properties
    runCypher(`
      CALL db.schema.nodeTypeProperties() YIELD nodeType, propertyName, propertyTypes
      WITH replace(replace(nodeType, ':\`', ''), '\`', '') as label,
           collect({name: propertyName, types: propertyTypes}) as props
      RETURN label, props
    `),
    // Relationship types with properties
    runCypher(`
      CALL db.schema.relTypeProperties() YIELD relType, propertyName, propertyTypes
      WITH replace(replace(relType, ':\`', ''), '\`', '') as type,
           collect({name: propertyName, types: propertyTypes}) as props
      RETURN type, props
    `),
    // How nodes connect
    runCypher(`
      MATCH (a)-[r]->(b)
      WITH labels(a)[0] as from, type(r) as rel, labels(b)[0] as to
      RETURN DISTINCT from, rel, to
    `),
    // Sample data to understand content
    runCypher(`
      CALL db.labels() YIELD label
      CALL apoc.cypher.run(
        'MATCH (n:\`' + label + '\`) RETURN n LIMIT 2', {}
      ) YIELD value
      RETURN label, collect(value.n) as samples
    `).catch(() => []) // APOC might not be available
  ]);

  const nodes = nodeData.map(n => ({
    label: n.label,
    properties: n.props.filter(p => p.name)
  }));

  const relationships = relData.map(r => ({
    type: r.type,
    properties: r.props.filter(p => p.name)
  }));

  // Build readable schema description for LLM
  const schemaDescription = buildSchemaDescription(nodes, relationships, structureData, sampleData);

  return {
    nodes,
    relationships,
    structure: structureData,
    samples: sampleData,
    description: schemaDescription
  };
}

function buildSchemaDescription(nodes, _relationships, structure, samples) {
  let desc = "GRAPH SCHEMA:\n\n";

  desc += "NODE TYPES:\n";
  for (const node of nodes) {
    const props = node.properties.map(p => p.name).join(", ");
    desc += `  ${node.label}: [${props}]\n`;
  }

  desc += "\nRELATIONSHIPS:\n";
  for (const edge of structure) {
    desc += `  (${edge.from})-[:${edge.rel}]->(${edge.to})\n`;
  }

  // Add sample data if available
  if (samples.length > 0) {
    desc += "\nSAMPLE DATA:\n";
    for (const s of samples.slice(0, 5)) {
      if (s.samples && s.samples.length > 0) {
        const sample = s.samples[0]?.properties || s.samples[0];
        if (sample) {
          const preview = JSON.stringify(sample).substring(0, 150);
          desc += `  ${s.label}: ${preview}...\n`;
        }
      }
    }
  }

  return desc;
}

// ============================================================================
// MAIN QUERY HANDLER
// ============================================================================
export async function answerUserQuery(question) {
  if (!schema) await initialize();

  console.log(`\n🔍 "${question}"`);
  const startTime = Date.now();

  // Add to conversation history
  conversation.history.push({ role: 'user', content: question });

  try {
    // Step 1: Generate Cypher query using LLM with full context
    const queryPlan = await generateQuery(question);

    if (queryPlan.cannotAnswer) {
      const response = {
        question,
        answer: queryPlan.reason,
        method: "not-answerable"
      };
      conversation.history.push({ role: 'assistant', content: queryPlan.reason });
      return response;
    }

    console.log(`📝 Cypher: ${queryPlan.cypher.split('\n')[0]}...`);

    // Step 2: Execute query
    let results;
    try {
      results = await runCypher(queryPlan.cypher);
    } catch (queryError) {
      console.error(`⚠️ Query failed: ${queryError.message}`);
      // Try to fix the query
      const fixedPlan = await fixQuery(question, queryPlan.cypher, queryError.message);
      if (fixedPlan.cypher) {
        console.log(`🔧 Retrying with: ${fixedPlan.cypher.split('\n')[0]}...`);
        results = await runCypher(fixedPlan.cypher);
      } else {
        throw queryError;
      }
    }

    // Step 3: Validate results - don't fabricate
    if (!results || results.length === 0) {
      const noDataResponse = "I searched the knowledge graph but found no data matching your question.";
      conversation.history.push({ role: 'assistant', content: noDataResponse });
      return {
        question,
        answer: noDataResponse,
        cypher: queryPlan.cypher,
        method: "no-data"
      };
    }

    // Step 4: Update conversation memory
    updateMemory(results);

    // Step 5: Generate intelligent answer from actual data
    const answer = await synthesizeAnswer(question, results);

    console.log(`✅ ${results.length} results in ${Date.now() - startTime}ms`);

    conversation.history.push({ role: 'assistant', content: answer });
    conversation.lastQuery = queryPlan.cypher;
    conversation.lastResults = results;

    return {
      question,
      answer,
      cypher: queryPlan.cypher,
      resultCount: results.length,
      data: results.slice(0, 10),
      queryTime: Date.now() - startTime,
      method: "llm-cypher"
    };

  } catch (error) {
    console.error("❌", error.message);
    const errorResponse = `I couldn't process that question. Error: ${error.message}`;
    conversation.history.push({ role: 'assistant', content: errorResponse });
    return {
      question,
      answer: errorResponse,
      error: error.message
    };
  }
}

// ============================================================================
// LLM QUERY GENERATION - Grounded in actual schema
// ============================================================================
async function generateQuery(question) {
  // Build context from conversation memory
  const contextInfo = buildConversationContext();

  const prompt = `You are a Neo4j Cypher expert. Generate a query to answer the user's question.

${schema.description}

${contextInfo}

USER QUESTION: "${question}"

INSTRUCTIONS:
1. Use ONLY the node labels, relationship types, and properties shown in the schema above
2. If the question references "this", "that", "these" etc., use the PREVIOUS CONTEXT provided
3. If the question cannot be answered with this schema, respond with: {"cannotAnswer": true, "reason": "explanation"}
4. For text search, use: toLower(n.property) CONTAINS toLower("term")
5. Always LIMIT results (default 10)
6. Return meaningful content properties, not just IDs
7. For ranking/counting, use aggregation (count, collect) with ORDER BY

RESPOND WITH JSON ONLY:
{
  "intent": "brief description of what user wants",
  "cypher": "the cypher query",
  "cannotAnswer": false
}`;

  const response = await callLLM(prompt, { temperature: 0.1, max_tokens: 500 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Clean up cypher
      if (parsed.cypher) {
        parsed.cypher = parsed.cypher
          .replace(/```cypher\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
      }
      return parsed;
    }
  } catch (e) {
    console.error("Failed to parse LLM response:", e.message);
  }

  // If parsing failed, try to extract just the cypher
  const cypherMatch = response.match(/MATCH[\s\S]+?(?:RETURN[\s\S]+?)(?:LIMIT \d+)?/i);
  if (cypherMatch) {
    return { intent: "extracted query", cypher: cypherMatch[0].trim(), cannotAnswer: false };
  }

  return { cannotAnswer: true, reason: "Could not generate a valid query for this question." };
}

function buildConversationContext() {
  let context = "";

  // Recent conversation
  if (conversation.history.length > 0) {
    const recent = conversation.history.slice(-6); // Last 3 exchanges
    context += "CONVERSATION HISTORY:\n";
    for (const msg of recent) {
      context += `${msg.role.toUpperCase()}: ${msg.content.substring(0, 200)}\n`;
    }
    context += "\n";
  }

  // Last entities mentioned (for resolving references)
  if (conversation.lastEntities.length > 0) {
    context += "PREVIOUS CONTEXT (for resolving 'this', 'that', etc.):\n";
    context += `Entity type: ${conversation.lastEntities[0].type}\n`;
    context += `Entity IDs: ${conversation.lastEntities.map(e => e.id).join(", ")}\n`;
    context += `Sample data: ${JSON.stringify(conversation.lastEntities[0].data).substring(0, 200)}\n`;
    context += "\n";
  }

  return context;
}

async function fixQuery(question, failedCypher, errorMessage) {
  const prompt = `The following Cypher query failed. Fix it.

SCHEMA:
${schema.description}

FAILED QUERY:
${failedCypher}

ERROR:
${errorMessage}

USER QUESTION: "${question}"

Return ONLY the fixed Cypher query, nothing else.`;

  const response = await callLLM(prompt, { temperature: 0, max_tokens: 300 });

  const cypher = response
    .replace(/```cypher\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  // Validate it looks like cypher
  if (cypher.toUpperCase().includes('MATCH') || cypher.toUpperCase().includes('RETURN')) {
    return { cypher };
  }

  return { cypher: null };
}

// ============================================================================
// MEMORY MANAGEMENT
// ============================================================================
function updateMemory(results) {
  if (!results || results.length === 0) return;

  // Extract entities for future reference
  conversation.lastEntities = results.slice(0, 10).map(r => {
    // Try to identify the entity type and ID
    const keys = Object.keys(r);
    const idKey = keys.find(k => /id$/i.test(k)) || keys[0];
    const typeKey = keys.find(k => /type|label/i.test(k));

    return {
      type: typeKey ? r[typeKey] : 'Unknown',
      id: r[idKey],
      data: r
    };
  });
}

// ============================================================================
// ANSWER SYNTHESIS - Grounded in actual data
// ============================================================================
async function synthesizeAnswer(question, results) {
  // For simple results, format directly without LLM
  if (results.length === 1 && Object.keys(results[0]).length <= 2) {
    const keys = Object.keys(results[0]);
    if (keys.includes('count')) {
      return `There are ${results[0].count} matching items in the knowledge graph.`;
    }
    return `Result: ${JSON.stringify(results[0])}`;
  }

  // For complex results, use LLM to synthesize a helpful answer
  const dataPreview = JSON.stringify(results.slice(0, 10), null, 2);

  const prompt = `Generate a helpful, actionable answer based on this data.

QUESTION: "${question}"

DATA FROM KNOWLEDGE GRAPH:
${dataPreview}

INSTRUCTIONS:
1. Answer ONLY using the data provided - do not invent or assume anything
2. If the data doesn't fully answer the question, say what IS available
3. Be specific - cite actual values, names, counts from the data
4. If this is for decision-making, highlight key insights
5. Keep it concise but informative (3-5 sentences max)
6. If the data is empty or irrelevant, say "The knowledge graph doesn't contain this information"

Answer:`;

  const answer = await callLLM(prompt, { temperature: 0.2, max_tokens: 400 });

  // Validate the answer doesn't hallucinate
  return validateAnswer(answer, results);
}

function validateAnswer(answer, results) {
  // Basic check: if answer mentions specific values, verify they exist in results
  const resultStr = JSON.stringify(results).toLowerCase();

  // Extract numbers from answer
  const numbersInAnswer = answer.match(/\d+/g) || [];

  // Check if answer seems to be making up data
  // (This is a heuristic - if answer has many numbers not in results, it might be hallucinating)
  let suspiciousNumbers = 0;
  for (const num of numbersInAnswer) {
    if (!resultStr.includes(num) && parseInt(num) > 1) {
      suspiciousNumbers++;
    }
  }

  if (suspiciousNumbers > 3) {
    // Too many numbers not in data - regenerate with stricter prompt
    console.warn("⚠️ Answer may contain hallucinated data, using raw results");
    return formatRawResults(results);
  }

  return answer;
}

function formatRawResults(results) {
  if (results.length === 0) {
    return "No data found.";
  }

  const items = results.slice(0, 7).map((r, i) => {
    const values = Object.entries(r)
      .map(([k, v]) => `${k}: ${typeof v === 'string' && v.length > 100 ? v.substring(0, 100) + '...' : v}`)
      .join(', ');
    return `${i + 1}. ${values}`;
  }).join('\n');

  return `Found ${results.length} results:\n${items}`;
}

// ============================================================================
// UTILITIES
// ============================================================================
export function clearConversation() {
  conversation = {
    history: [],
    lastEntities: [],
    lastQuery: null,
    lastResults: []
  };
}

export function getConversation() {
  return { ...conversation };
}

export function getSchema() {
  return schema;
}
