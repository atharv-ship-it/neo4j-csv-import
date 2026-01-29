// queryUnderstanding.js - LLM-Powered Graph Intelligence
//
// Core principle: Search ALL text in the graph, then traverse to find context

import { runCypher } from "./neo4jClient.js";
import { callLLM } from "./llmClient.js";

// ============================================================================
// STATE
// ============================================================================
let schema = null;
let conversation = {
  history: [],
  lastEntities: [],
  lastQuery: null,
  lastResults: []
};

// ============================================================================
// INITIALIZATION
// ============================================================================
export async function initialize() {
  console.log("🔄 Loading graph schema...");
  schema = await discoverSchema();
  console.log(`✅ Schema loaded: ${schema.nodeLabels.length} node types`);
  return schema;
}

async function discoverSchema() {
  const [nodeData, structureData] = await Promise.all([
    runCypher(`
      CALL db.schema.nodeTypeProperties() YIELD nodeType, propertyName, propertyTypes
      WITH replace(replace(nodeType, ':\`', ''), '\`', '') as label,
           collect({name: propertyName, types: propertyTypes}) as props
      RETURN label, props
    `),
    runCypher(`
      MATCH (a)-[r]->(b)
      WITH labels(a)[0] as from, type(r) as rel, labels(b)[0] as to
      RETURN DISTINCT from, rel, to
    `)
  ]);

  const nodeLabels = [];
  const properties = {};
  const textFields = {}; // Which fields contain searchable text

  for (const n of nodeData) {
    nodeLabels.push(n.label);
    const props = n.props.filter(p => p.name).map(p => p.name);
    properties[n.label] = props;

    // Identify text fields for this node type
    const textProp = props.find(p => /^text$/i.test(p)) ||
                     props.find(p => /^content$/i.test(p)) ||
                     props.find(p => /^description$/i.test(p)) ||
                     props.find(p => /^body$/i.test(p)) ||
                     props.find(p => /^title$/i.test(p));
    if (textProp) {
      textFields[n.label] = textProp;
    }
  }

  return {
    nodeLabels,
    properties,
    textFields,
    structure: structureData
  };
}

// ============================================================================
// MAIN QUERY HANDLER
// ============================================================================
export async function answerUserQuery(question) {
  if (!schema) await initialize();

  console.log(`\n🔍 "${question}"`);
  const startTime = Date.now();

  conversation.history.push({ role: 'user', content: question });

  try {
    // Extract search terms from the question
    const searchTerms = extractSearchTerms(question);
    console.log(`🔎 Search terms: ${searchTerms.join(', ')}`);

    // Search across ALL text fields in the graph
    let results = await searchGraph(searchTerms, question);

    if (results.length === 0) {
      // Try LLM-generated query as fallback
      console.log("⚠️ Broad search empty, trying LLM query...");
      results = await tryLLMQuery(question);
    }

    if (results.length === 0) {
      const response = "I searched the knowledge graph but found no data matching your question.";
      conversation.history.push({ role: 'assistant', content: response });
      return { question, answer: response, method: "no-data" };
    }

    // Update memory
    conversation.lastEntities = results.slice(0, 10).map(r => ({
      type: r._nodeType || 'Unknown',
      id: r.id || Object.values(r)[0],
      data: r
    }));
    conversation.lastResults = results;

    // Synthesize answer
    const answer = await synthesizeAnswer(question, results);

    console.log(`✅ ${results.length} results in ${Date.now() - startTime}ms`);
    conversation.history.push({ role: 'assistant', content: answer });

    return {
      question,
      answer,
      resultCount: results.length,
      queryTime: Date.now() - startTime,
      method: "graph-search"
    };

  } catch (error) {
    console.error("❌", error.message);
    const response = `Error: ${error.message}`;
    conversation.history.push({ role: 'assistant', content: response });
    return { question, answer: response, error: error.message };
  }
}

// ============================================================================
// SEARCH - The core intelligence
// ============================================================================

function extractSearchTerms(question) {
  const q = question.toLowerCase();

  // Remove common words
  const stopWords = new Set([
    'what', 'which', 'how', 'why', 'when', 'where', 'who', 'is', 'are', 'was', 'were',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'about', 'tell', 'me', 'show', 'find', 'get', 'list', 'any', 'some', 'most', 'top',
    'there', 'this', 'that', 'these', 'those', 'it', 'they', 'them', 'issues', 'issue',
    'problems', 'problem', 'can', 'you', 'i', 'my', 'your', 'do', 'does', 'did', 'have', 'has'
  ]);

  // Extract meaningful terms
  const terms = q
    .replace(/[?!.,;:'"]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  // Also check for quoted phrases
  const quoted = question.match(/"([^"]+)"/g);
  if (quoted) {
    terms.push(...quoted.map(q => q.replace(/"/g, '')));
  }

  // If asking about previous context, use stored entities
  if (/\b(this|that|these|those|it)\b/.test(q) && conversation.lastEntities.length > 0) {
    // Return IDs from previous results for follow-up
    return conversation.lastEntities.slice(0, 3).map(e => String(e.id));
  }

  return [...new Set(terms)]; // Dedupe
}

async function searchGraph(searchTerms, question) {
  if (searchTerms.length === 0) {
    // No specific terms - check if it's a general query
    return await handleGeneralQuery(question);
  }

  // Build UNION query to search ALL text fields
  const searchQueries = [];

  for (const [label, textField] of Object.entries(schema.textFields)) {
    const allProps = schema.properties[label] || [];

    // Build WHERE clause for this node type
    const conditions = searchTerms.map(term =>
      `toLower(n.${textField}) CONTAINS toLower("${term.replace(/"/g, '\\"')}")`
    ).join(' OR ');

    // Select properties to return
    const returnProps = allProps.slice(0, 5).map(p => `n.${p} as ${p}`).join(', ');

    searchQueries.push(`
      MATCH (n:${label})
      WHERE ${conditions}
      RETURN ${returnProps}, "${label}" as _nodeType
      LIMIT 5
    `);
  }

  if (searchQueries.length === 0) {
    return [];
  }

  // Execute UNION of all searches
  const unionQuery = searchQueries.join('\nUNION ALL\n') + '\nLIMIT 15';

  try {
    console.log(`📝 Searching ${Object.keys(schema.textFields).length} node types...`);
    const results = await runCypher(unionQuery);

    // If we found content, try to enrich with related data
    if (results.length > 0) {
      return await enrichResults(results);
    }
    return results;
  } catch (error) {
    console.error("Search query failed:", error.message);
    return [];
  }
}

async function handleGeneralQuery(question) {
  const q = question.toLowerCase();

  // Count queries
  if (/how many|count|total number/.test(q)) {
    for (const label of schema.nodeLabels) {
      if (q.includes(label.toLowerCase())) {
        const result = await runCypher(`MATCH (n:${label}) RETURN count(n) as count`);
        return result;
      }
    }
  }

  // Top/most queries
  if (/most|top|frequent|common|popular/.test(q)) {
    // Find what's being asked about
    for (const label of schema.nodeLabels) {
      if (q.includes(label.toLowerCase()) || q.includes(label.toLowerCase() + 's')) {
        const textField = schema.textFields[label];
        if (textField) {
          // Find most mentioned/connected items
          const result = await runCypher(`
            MATCH (n:${label})<-[r]-()
            WITH n, count(r) as connections
            ORDER BY connections DESC
            LIMIT 10
            RETURN n.${textField} as content, connections
          `).catch(() => []);
          if (result.length > 0) return result;
        }
      }
    }
  }

  return [];
}

async function enrichResults(results) {
  // For each result, try to get related context
  const enriched = [];

  for (const r of results) {
    const nodeType = r._nodeType;
    const enrichedResult = { ...r };

    // Find related nodes based on graph structure
    const connections = schema.structure.filter(s =>
      s.from === nodeType || s.to === nodeType
    );

    if (connections.length > 0 && r.id) {
      // Get one level of connected context
      try {
        const contextQuery = `
          MATCH (n:${nodeType} {id: $id})-[rel]-(connected)
          RETURN type(rel) as relationship, labels(connected)[0] as connectedType,
                 connected.text as text, connected.title as title, connected.name as name
          LIMIT 3
        `;
        const context = await runCypher(contextQuery, { id: r.id });
        if (context.length > 0) {
          enrichedResult._context = context;
        }
      } catch {
        // Ignore enrichment errors
      }
    }

    enriched.push(enrichedResult);
  }

  return enriched;
}

async function tryLLMQuery(question) {
  const schemaDesc = buildSchemaDescription();

  const prompt = `Generate a Neo4j Cypher query to answer this question.

${schemaDesc}

QUESTION: "${question}"

RULES:
1. Use ONLY labels and properties from the schema
2. Return actual content (text, title, name), not just IDs
3. Add LIMIT 10
4. If the data doesn't exist in this schema, return: RETURN "not_available" as status

Return ONLY the Cypher query, nothing else.`;

  const response = await callLLM(prompt, { temperature: 0, max_tokens: 300 });

  const cypher = response
    .replace(/```cypher\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  if (cypher.includes('not_available')) {
    return [];
  }

  try {
    return await runCypher(cypher);
  } catch {
    return [];
  }
}

function buildSchemaDescription() {
  let desc = "SCHEMA:\n";

  for (const label of schema.nodeLabels) {
    const props = schema.properties[label] || [];
    const textField = schema.textFields[label];
    desc += `${label}: [${props.join(', ')}]${textField ? ` (text in: ${textField})` : ''}\n`;
  }

  desc += "\nRELATIONSHIPS:\n";
  for (const s of schema.structure) {
    desc += `(${s.from})-[:${s.rel}]->(${s.to})\n`;
  }

  return desc;
}

// ============================================================================
// ANSWER SYNTHESIS
// ============================================================================
async function synthesizeAnswer(question, results) {
  // Simple results - format directly
  if (results.length === 1 && results[0].count !== undefined) {
    return `There are ${results[0].count} items.`;
  }

  // Use LLM to create a coherent answer
  const dataStr = JSON.stringify(results.slice(0, 10), null, 2);

  const prompt = `Answer this question using ONLY the data provided.

QUESTION: "${question}"

DATA:
${dataStr}

RULES:
- Use ONLY information from the data above
- Be specific - cite actual text/values
- If data is insufficient, say what WAS found
- 2-4 sentences max
- Do not invent or assume anything not in the data`;

  return await callLLM(prompt, { temperature: 0.2, max_tokens: 300 });
}

// ============================================================================
// EXPORTS
// ============================================================================
export function clearConversation() {
  conversation = { history: [], lastEntities: [], lastQuery: null, lastResults: [] };
}

export function getConversation() {
  return { ...conversation };
}

export function getSchema() {
  return schema;
}
