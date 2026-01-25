// queryUnderstanding.js
import OpenAI from "openai";
import { runCypherReadOnly } from "./neo4jClient.js";
import {
  getSchema
} from "./schemaMetadata.js";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Pre‑built query templates
 */
const QUERY_TEMPLATES = [
  {
    id: "top_users_by_issues",
    examples: [
      "Which users reported the most issues?",
      "Who are the top contributors?",
      "Show me most active users",
      "Users with most reports",
    ],
    cypher: `
      MATCH (u:User)-[:AUTHORED]->(r:Report)-[:MENTIONS]->(i:Issue)
      WITH u, COUNT(DISTINCT i) AS issue_count
      RETURN u.username AS username, u.platform AS platform, issue_count
      ORDER BY issue_count DESC
      LIMIT {{limit}}
    `,
    defaultParams: { limit: 10 },
    embedding: null,
  },
  {
    id: "severe_issues",
    examples: [
      "What are the most severe issues?",
      "Show critical problems",
      "Top severity issues",
      "Worst issues reported",
    ],
    cypher: `
      MATCH (i:Issue)
      WHERE i.severity IS NOT NULL
      RETURN i.issue_id AS issue_id, i.type AS type, i.severity AS severity, i.description AS description
      ORDER BY i.severity DESC
      LIMIT {{limit}}
    `,
    defaultParams: { limit: 10 },
    embedding: null,
  },
  {
    id: "confirmed_solutions",
    examples: [
      "What solutions actually work?",
      "Show proven solutions",
      "Confirmed fixes",
      "Which solutions are verified?",
    ],
    cypher: `
      MATCH (r:Report)-[:CONFIRMS]->(s:Solution)
      WITH s, COUNT(r) AS confirmations
      RETURN s.solution_id AS solution_id, s.type AS type, s.description AS description, confirmations
      ORDER BY confirmations DESC
      LIMIT {{limit}}
    `,
    defaultParams: { limit: 15 },
    embedding: null,
  },
  {
    id: "negative_sentiment",
    examples: [
      "Show negative feedback",
      "What are people complaining about?",
      "Negative reviews",
      "Bad reports",
    ],
    cypher: `
      MATCH (r:Report)
      WHERE r.sentiment_score < 0
      RETURN r.report_id AS report_id, r.product AS product, r.text AS text, r.sentiment_score AS sentiment_score
      ORDER BY r.sentiment_score ASC
      LIMIT {{limit}}
    `,
    defaultParams: { limit: 20 },
    embedding: null,
  },
  {
    id: "product_issues",
    examples: [
      "Which products have the most issues?",
      "Products with problems",
      "Issue count by product",
      "Most problematic products",
    ],
    cypher: `
      MATCH (r:Report)-[:MENTIONS]->(i:Issue)
      WHERE r.product IS NOT NULL
      WITH r.product AS product, COUNT(DISTINCT i) AS issue_count
      RETURN product, issue_count
      ORDER BY issue_count DESC
      LIMIT {{limit}}
    `,
    defaultParams: { limit: 15 },
    embedding: null,
  },
  {
    id: "platform_activity",
    examples: [
      "Which platforms are most active?",
      "Platform statistics",
      "Reports by platform",
      "Most used platforms",
    ],
    cypher: `
      MATCH (u:User)-[:AUTHORED]->(r:Report)
      WITH u.platform AS platform, COUNT(DISTINCT u) AS user_count, COUNT(r) AS report_count
      RETURN platform, user_count, report_count
      ORDER BY report_count DESC
      LIMIT {{limit}}
    `,
    defaultParams: { limit: 10 },
    embedding: null,
  },
];

let embeddingCache = new Map();

/**
 * Initialize template embeddings
 */
async function initializeTemplates() {
  console.log("🔄 Generating embeddings for query templates...");
  for (const template of QUERY_TEMPLATES) {
    const combinedExamples = template.examples.join(" | ");
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: combinedExamples,
    });
    template.embedding = response.data[0].embedding;
  }
  console.log("✅ Template embeddings generated");
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Classify the user query to a template
 */
async function classifyQuery(userQuestion) {
  const cacheKey = userQuestion.toLowerCase().trim();
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: userQuestion,
  });
  const queryEmbedding = response.data[0].embedding;

  let bestMatch = null;
  let bestScore = 0;
  const SIMILARITY_THRESHOLD = 0.75;

  for (const template of QUERY_TEMPLATES) {
    if (!template.embedding) continue;
    const similarity = cosineSimilarity(queryEmbedding, template.embedding);
    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = template;
    }
  }

  const result =
    bestScore >= SIMILARITY_THRESHOLD
      ? { template: bestMatch, confidence: bestScore }
      : null;

  embeddingCache.set(cacheKey, result);
  return result;
}

/**
 * Extract parameters from question (simple)
 */
function extractParameters(question, template) {
  const params = { ...template.defaultParams };

  // Extract "limit"
  const limitMatch = question.match(
    /top (\d+)|show (\d+)|(\d+) (most|best|worst)/i
  );
  if (limitMatch) {
    const limit = parseInt(
      limitMatch[1] || limitMatch[2] || limitMatch[3],
      10
    );
    if (limit > 0 && limit <= 100) {
      params.limit = limit;
    }
  }

  // Basic product extraction if template expects {{product}} (not used in current templates)
  if (template.cypher.includes("{{product}}")) {
    const productMatch = question.match(/about ([\w\s]+)|for ([\w\s]+)/i);
    if (productMatch) {
      params.product = (productMatch[1] || productMatch[2]).trim();
    }
  }

  return params;
}

/**
 * Replace {{placeholders}} in Cypher template
 * Only used for simple numeric/string injection; KEEP it for templates.
 */
function fillTemplate(cypherTemplate, params) {
  let cypher = cypherTemplate;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = new RegExp(`{{${key}}}`, "g");
    cypher = cypher.replace(placeholder, value);
  }
  return cypher.trim();
}

/**
 * LLM fallback: generate Cypher when no template matches
 */
async function generateCypher(question, conversationHistory = []) {
  const schema = await getSchema();
  const schemaDoc = schema.domainGuidance;

  // Build messages array with conversation context
  const messages = [
    {
      role: "system",
      content: `You generate ONLY Cypher queries for Neo4j. Return ONLY the query.

${schemaDoc}

Rules:
1. Always add LIMIT (max 100)
2. Use WHERE for filtering
3. Use toLower() for case-insensitive text search
4. Use DISTINCT for relationship counts
5. When filtering by severity, use exact values from the schema (e.g., "high", "medium", "low")
6. When filtering by product, platform, or type, refer to the actual values listed in the schema
7. If the user references something from conversation history (e.g., "that", "those", "it"), use context to understand what they mean`,
    },
  ];

  // Inject last 4 messages of conversation history for context
  if (conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-4);
    messages.push(...recentHistory);
  }

  // Add current question
  messages.push({ role: "user", content: question });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages,
  });

  return response.choices[0].message.content.trim();
}

/**
 * Clean and normalize Cypher
 */
function optimizeCypher(cypher) {
  let optimized = cypher.trim();
  optimized = optimized
    .replace(/```cypher\n?/gi, "")
    .replace(/```\n?/g, "");

  if (!optimized.toUpperCase().includes("LIMIT")) {
    optimized += optimized.endsWith(";") ? " LIMIT 100;" : " LIMIT 100";
  }

  const limitMatch = optimized.match(/LIMIT\s+(\d+)/i);
  if (limitMatch && parseInt(limitMatch[1], 10) > 100) {
    optimized = optimized.replace(/LIMIT\s+\d+/i, "LIMIT 100");
  }

  return optimized;
}

/**
 * Turn data into natural language answer
 */
async function verbalizeAnswer(question, data, conversationHistory = []) {
  if (!data || data.length === 0) {
    return "No results found for your query.";
  }

  const MAX_RESULTS = 50;
  const truncatedData = data.slice(0, MAX_RESULTS);
  const truncationNote =
    data.length > MAX_RESULTS
      ? `\n[Showing ${MAX_RESULTS} of ${data.length} results]`
      : "";

  // Build messages with minimal history for context-aware responses
  const messages = [
    {
      role: "system",
      content:
        "Convert data to natural language. Use ONLY the provided data. No markdown. Plain text only. If the user refers to previous context, acknowledge it naturally.",
    },
  ];

  // Add last 2 messages for context (keeps verbalization fast)
  if (conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-2);
    messages.push(...recentHistory);
  }

  messages.push({
    role: "user",
    content: `Question: ${question}\n\nData:\n${JSON.stringify(
      truncatedData,
      null,
      2
    )}${truncationNote}`,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages,
  });

  return response.choices[0].message.content.trim();
}

/**
 * Main entry point
 */
export async function answerUserQuery(userQuestion, conversationHistory = []) {
  try {
    if (QUERY_TEMPLATES[0].embedding === null) {
      await initializeTemplates();
    }

    let cypher;
    let method;
    let classification = null;

    // 1. Try to match a template
    classification = await classifyQuery(userQuestion);

    if (classification) {
      console.log(
        `✅ Matched template: ${classification.template.id} (confidence: ${(
          classification.confidence * 100
        ).toFixed(1)}%)`
      );
      const params = extractParameters(userQuestion, classification.template);
      cypher = fillTemplate(classification.template.cypher, params);
      method = "template";
    } else {
      // 2. Fallback to LLM generated Cypher (with conversation context)
      console.log("🤖 No template match - generating Cypher with LLM");
      const raw = await generateCypher(userQuestion, conversationHistory);
      cypher = optimizeCypher(raw);
      method = "generated";
    }

    // 3. Execute query with retry
    let data;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        data = await runCypherReadOnly(cypher);
        break;
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message);
        if (attempt === 3) {
          throw new Error(`Query execution failed: ${error.message}`);
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * attempt)
        );
      }
    }

    // 4. Verbalize answer (with conversation context)
    const answer = await verbalizeAnswer(userQuestion, data, conversationHistory);

    return {
      cypher,
      data,
      answer,
      method,
      confidence: classification?.confidence ?? null,
    };
  } catch (error) {
    console.error("Error in answerUserQuery:", error);
    return {
      error: "An error occurred while processing your question.",
      details: error.message,
    };
  }
}
