// queryUnderstanding.js - Dynamic LLM Graph Q&A
//
// Principle: Give LLM complete schema knowledge, let it reason about traversals

import { runCypher } from "./neo4jClient.js";
import { callLLM } from "./llmClient.js";

// ============================================================================
// STATE
// ============================================================================
let schema = null;
let conversation = {
  messages: [],
  lastResults: [],
  lastCypher: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================
export async function initialize() {
  console.log("🔄 Discovering graph schema...");
  schema = await discoverSchema();
  console.log(`✅ Schema ready: ${schema.nodes.length} node types`);

  // Log what we found
  for (const node of schema.nodes) {
    const sampleCount = schema.samples[node.label]?.length || 0;
    console.log(`  • ${node.label}: ${node.properties.length} props, ${sampleCount} samples`);
  }

  return schema;
}

async function discoverSchema() {
  const [nodesData, relsData, structureData] = await Promise.all([
    runCypher(`
      CALL db.schema.nodeTypeProperties() YIELD nodeType, propertyName, propertyTypes
      WITH replace(replace(nodeType, ':\`', ''), '\`', '') as label, propertyName, propertyTypes
      RETURN label, collect({property: propertyName, types: propertyTypes}) as properties
    `),
    runCypher(`
      CALL db.schema.relTypeProperties() YIELD relType, propertyName, propertyTypes
      WITH replace(replace(relType, ':\`', ''), '\`', '') as type, propertyName, propertyTypes
      RETURN type, collect({property: propertyName, types: propertyTypes}) as properties
    `),
    runCypher(`
      MATCH (a)-[r]->(b)
      RETURN DISTINCT labels(a)[0] as from, type(r) as rel, labels(b)[0] as to
    `)
  ]);

  // Get rich sample data for each node type - return properties directly
  const samples = {};
  for (const node of nodesData) {
    try {
      const result = await runCypher(`MATCH (n:\`${node.label}\`) RETURN properties(n) as props LIMIT 3`);
      samples[node.label] = result.map(r => r.props).filter(Boolean);
    } catch {
      // Skip
    }
  }

  return {
    nodes: nodesData,
    relationships: relsData,
    structure: structureData,
    samples
  };
}

function buildSchemaPrompt() {
  let prompt = "=== COMPLETE GRAPH SCHEMA ===\n\n";

  // Node types with full property info and samples
  for (const node of schema.nodes) {
    const props = node.properties.filter(p => p.property);
    prompt += `[${node.label}]\n`;
    prompt += `  Properties:\n`;
    for (const p of props) {
      prompt += `    - ${p.property} (${p.types?.join('|') || 'unknown'})\n`;
    }

    // Show actual sample data with longer text previews
    if (schema.samples[node.label]?.length > 0) {
      prompt += `  Sample records:\n`;
      for (const sample of schema.samples[node.label].slice(0, 2)) {
        // For text/content fields, show more characters so LLM understands what's searchable
        const displaySample = {};
        for (const [key, value] of Object.entries(sample)) {
          if (typeof value === 'string' && value.length > 100) {
            displaySample[key] = value.substring(0, 300) + "...";
          } else {
            displaySample[key] = value;
          }
        }
        prompt += `    ${JSON.stringify(displaySample)}\n`;
      }
    }
    prompt += "\n";
  }

  // Relationships with properties
  prompt += "=== RELATIONSHIPS ===\n";
  for (const rel of schema.relationships) {
    const props = rel.properties.filter(p => p.property).map(p => p.property);
    prompt += `  [:${rel.type}]${props.length > 0 ? ` {${props.join(", ")}}` : ""}\n`;
  }

  // Graph structure - how things connect
  prompt += "\n=== GRAPH CONNECTIONS ===\n";
  for (const s of schema.structure) {
    prompt += `  (${s.from})-[:${s.rel}]->(${s.to})\n`;
  }

  return prompt;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
export async function answerUserQuery(question) {
  if (!schema) await initialize();

  console.log(`\n🔍 "${question}"`);
  const startTime = Date.now();

  conversation.messages.push({ role: "user", content: question });

  try {
    // Generate query
    const queryResult = await generateCypher(question);

    if (queryResult.notPossible) {
      const answer = queryResult.reason;
      conversation.messages.push({ role: "assistant", content: answer });
      return { question, answer, method: "not-possible" };
    }

    console.log(`📝 Cypher: ${queryResult.cypher}`);

    // Execute
    let results;
    try {
      results = await runCypher(queryResult.cypher);
    } catch (err) {
      console.log(`⚠️ Query error, attempting fix...`);
      const fixed = await fixCypher(queryResult.cypher, err.message, question);
      if (fixed) {
        console.log(`🔧 Fixed query: ${fixed}`);
        results = await runCypher(fixed);
      } else {
        throw err;
      }
    }

    if (!results || results.length === 0) {
      const answer = "No matching data found in the knowledge graph.";
      conversation.messages.push({ role: "assistant", content: answer });
      return { question, answer, cypher: queryResult.cypher, method: "no-results" };
    }

    conversation.lastResults = results;
    conversation.lastCypher = queryResult.cypher;

    const answer = await generateAnswer(question, results);
    conversation.messages.push({ role: "assistant", content: answer });

    console.log(`✅ ${results.length} results in ${Date.now() - startTime}ms`);

    return {
      question,
      answer,
      cypher: queryResult.cypher,
      resultCount: results.length,
      queryTime: Date.now() - startTime
    };

  } catch (error) {
    console.error("❌", error.message);
    const answer = `Error: ${error.message}`;
    conversation.messages.push({ role: "assistant", content: answer });
    return { question, answer, error: error.message };
  }
}

// ============================================================================
// LLM QUERY GENERATION
// ============================================================================
async function generateCypher(question) {
  const schemaPrompt = buildSchemaPrompt();

  // Debug: log schema prompt
  console.log(`📋 Schema prompt: ${schemaPrompt.length} chars`);
  console.log(schemaPrompt.substring(0, 1500) + "\n...[truncated]");

  // Build conversation context
  let context = "";
  if (conversation.messages.length > 2) {
    context = "CONVERSATION HISTORY:\n";
    for (const m of conversation.messages.slice(-6)) {
      context += `${m.role}: ${m.content.substring(0, 300)}\n`;
    }
    context += "\n";
  }
  if (conversation.lastResults.length > 0) {
    context += "PREVIOUS QUERY RESULTS (for follow-up reference):\n";
    context += JSON.stringify(conversation.lastResults.slice(0, 5), null, 2) + "\n\n";
  }

  const prompt = `You are a Neo4j Cypher expert. Generate a Cypher query for the question.

${schemaPrompt}

${context}

QUESTION: "${question}"

Generate a Cypher query that:
1. Searches text fields (properties with String type containing actual content) for relevant keywords
2. Traverses relationships shown in GRAPH CONNECTIONS to gather context
3. Returns meaningful content, not just IDs
4. Uses: WHERE toLower(property) CONTAINS toLower("keyword")
5. Includes LIMIT 10

Respond ONLY with JSON:
{"cypher": "your query"}`;

  const response = await callLLM(prompt, { temperature: 0, max_tokens: 600 });

  try {
    const json = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || "{}");
    if (json.cypher) {
      json.cypher = json.cypher.replace(/```[a-z]*\n?|```/g, "").trim();
    }
    return json;
  } catch {
    const match = response.match(/MATCH[\s\S]+?RETURN[\s\S]+?(?:LIMIT \d+)?/i);
    if (match) return { cypher: match[0].trim() };
    return { notPossible: true, reason: "Could not generate query." };
  }
}

async function fixCypher(badCypher, error, question) {
  const prompt = `Fix this Cypher query.

SCHEMA:
${buildSchemaPrompt()}

FAILED QUERY:
${badCypher}

ERROR: ${error}

QUESTION: "${question}"

Return ONLY the corrected Cypher query.`;

  const response = await callLLM(prompt, { temperature: 0, max_tokens: 400 });
  const fixed = response.replace(/```[a-z]*\n?|```/g, "").trim();

  if (fixed.toUpperCase().includes("MATCH")) return fixed;
  return null;
}

// ============================================================================
// ANSWER GENERATION
// ============================================================================
async function generateAnswer(question, results) {
  const prompt = `Generate a helpful answer from this data.

QUESTION: "${question}"

DATA:
${JSON.stringify(results.slice(0, 15), null, 2)}

RULES:
- Use ONLY the data above, do not invent anything
- Be specific - reference actual values from the data
- Provide actionable insights when possible
- If data is incomplete, say what WAS found
- Keep it concise (3-5 sentences)`;

  return await callLLM(prompt, { temperature: 0.2, max_tokens: 400 });
}

// ============================================================================
// EXPORTS
// ============================================================================
export function clearConversation() {
  conversation = { messages: [], lastResults: [], lastCypher: null };
}

export function getConversation() {
  return { ...conversation };
}

export function getSchema() {
  return schema;
}
