// queryUnderstanding.js
// PURPOSE: LLM generates Cypher queries dynamically from schema
// PRINCIPLE: Trust the schema, trust Neo4j validation, trust the LLM

import OpenAI from "openai";
import { runCypherReadOnly } from "./neo4jClient.js";
import { getSchema } from "./schemaMetadata.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateCypherFromSchema(question, schema, conversationHistory = []) {
  const systemPrompt = `You are a Neo4j Cypher query generator for an intelligent Context Knowledge Graph.

═══════════════════════════════════════════════════════════════════════════════
GRAPH SCHEMA (YOUR SOURCE OF TRUTH)
═══════════════════════════════════════════════════════════════════════════════

NODE TYPES:
${schema.nodes.map(n => `• ${n.label}: ${n.properties.map(p => p.property).join(', ') || 'no properties'}`).join('\n')}


RELATIONSHIP TYPES:
${schema.relationships.map(r => `• ${r.type}: ${r.properties.map(p => p.property).join(', ') || 'no properties'}`).join('\n')}

ACTUAL DATA IN GRAPH:
• Products: ${schema.products.map(p => `${p.name} (${p.category})`).join(', ')}
• Issue Categories: ${schema.categories.join(', ')}
• Source Types: ${schema.sourceTypes.join(', ')}
• Solution Types: ${schema.solutionTypes.join(', ')}
• Expertise Levels: ${schema.expertiseLevels.join(', ')}

RELATIONSHIP PATTERNS:
• (User)-[:AUTHORED]->(Report)
• (Report)-[:MENTIONS {evidence_strength, certainty_level}]->(Issue)
• (Report)-[:CONFIRMS {confirmation_strength, post_fix_outcome}]->(Solution)
• (Report)-[:SUGGESTS]->(Solution)
• (Report)-[:ABOUT_PRODUCT]->(Product)
• (Report)-[:PUBLISHED_VIA]->(Source)
• (Issue)-[:AFFECTS]->(Product)

═══════════════════════════════════════════════════════════════════════════════
NATURAL LANGUAGE → GRAPH SCHEMA TRANSLATION
═══════════════════════════════════════════════════════════════════════════════

Users speak naturally - translate their terms to graph queries:

REVIEWS & FEEDBACK:
• "reviews/feedback/reports/complaints" → Report nodes (r:Report)
• "recent reviews" → Report ORDER BY timestamp DESC
• "most reliable/expert opinions" → Report from expert users AND high confidence_score
• "positive/negative sentiment" → ❌ NOT TRACKED (no sentiment data exists)
• "trusted reviews" → Report WHERE confidence_score >= 0.7 (high credibility)

NOTE: confidence_score = trustworthiness (expert+reliable source), NOT user satisfaction

PRODUCTS:
• "laptop/computer/device/model" → Product nodes (p:Product)
• Use CONTAINS for fuzzy matching: WHERE toLower(p.name) CONTAINS toLower($term)

ISSUES & PROBLEMS:
• "problems/bugs/defects/issues" → Issue nodes (i:Issue)
• "severe/critical/major" → Compute severity from report counts + confidence
• "common/frequent" → Issues with high count(Report) mentioning them
• Map common terms to categories:
  - "overheating/hot/temperature" → category = 'thermal'
  - "battery drain/battery life/charging" → category = 'battery' or 'power'
  - "crashes/freezing/errors" → category = 'software'
  - "screen/display" → category = 'display'
  - "keyboard/trackpad/mouse" → category = 'input'
  - "wifi/bluetooth/network" → category = 'connectivity'

SOLUTIONS & FIXES:
• "solutions/fixes/workarounds" → Solution nodes (s:Solution)
• "best fix/working fix" → Solution with high solution_effectiveness_score
• "temporary fix" → solution_type = 'workaround'
• "permanent fix" → solution_type = 'permanent'

EXPERTISE & TRUST:
• "expert/professional opinion" → User WHERE user_expertise_level = 'expert'
• "beginner/novice feedback" → User WHERE user_expertise_level = 'novice'
• "trusted/reliable source" → Source with high independence_weight

TIME-BASED:
• "recent/latest/new" → ORDER BY timestamp DESC
• "trending" → Issues with many recent reports (timestamp filtering)

METRICS THAT DON'T EXIST (respond "not tracked"):
• "sentiment score/rating/star rating" → ❌ NOT TRACKED
• "positive reviews" → ✅ Report WHERE confidence_score >= 0.7 (this IS data)
• "negative reviews" → ✅ Report WHERE confidence_score < 0.5 (this IS data)
• If user asks for these, explain: "Not tracked - using confidence_score instead"

${schema.domainGuidance}

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: HANDLING NON-EXISTENT DATA
═══════════════════════════════════════════════════════════════════════════════

If user asks for properties NOT in the schema above (e.g., sentiment, ratings, 
positive reviews, negative reviews, review scores), respond:

{
  "reasoning": "The requested property does not exist in the schema",
  "cypher": "RETURN 'not_tracked' AS status",
  "parameters": {},
  "expectsResults": false
}

The system will automatically respond: "This data is not tracked in the knowledge graph."

DO NOT invent sentiment_score, rating, review_score, or any property not listed above.


═══════════════════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════════════════

Generate a valid Cypher query to answer the user's question.

EXPLICIT INSTRUCTIONS:
MATCHING STRATEGY:
- Always use CONTAINS for product/category filtering (never = equality)
- Always use toLower() for case-insensitive matching
- If user mentions generic term (gaming/business), expand to known products

GUIDELINES:
1. Use ONLY properties that exist in the schema above
2. For rankings/comparisons, compute scores using available metrics
3. For simple lookups, just MATCH and RETURN
4. If data doesn't exist in schema, return a query that returns empty results
5. Use parameters for user inputs: $filter, $product, etc.
6. Keep queries clean and efficient

RESPONSE FORMAT (JSON):
{
  "reasoning": "Brief explanation of approach",
  "cypher": "Complete Cypher query",
  "parameters": {"filter": "value or null"},
  "expectsResults": true/false
}

EXAMPLES:

Q: "How many products are there?"
{
  "reasoning": "Simple count query",
  "cypher": "MATCH (p:Product) RETURN count(p) AS product_count",
  "parameters": {},
  "expectsResults": true
}

// Example: Fuzzy product search
MATCH (p:Product)<-[:ABOUT_PRODUCT]-(r:Report)
WHERE toLower(p.name) CONTAINS toLower($product)  // Partial match
RETURN p.name, count(r) AS report_count


Q: "What are the worst issues?"
{
  "reasoning": "Rank issues by frequency and confidence",
  "cypher": "MATCH (r:Report)-[m:MENTIONS]->(i:Issue) WHERE r.confidence_score >= 0.4 WITH i, count(DISTINCT r) AS frequency, avg(r.confidence_score) AS avg_conf RETURN i.issue_title AS issue, round(frequency * avg_conf * 1000) / 1000 AS severity_score, frequency ORDER BY severity_score DESC LIMIT 10",
  "parameters": {},
  "expectsResults": true
}

Q: "What are desktop issues?" (when only Laptop exists in data)
{
  "reasoning": "Filter for Desktop category - will return empty if no data exists",
  "cypher": "MATCH (p:Product)<-[:ABOUT_PRODUCT]-(r:Report)-[:MENTIONS]->(i:Issue) WHERE toLower(p.category) = 'desktop' RETURN DISTINCT i.issue_title AS issue LIMIT 10",
  "parameters": {},
  "expectsResults": false
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: `User question: "${question}"` },
    ],
  });

  return JSON.parse(response.choices[0].message.content);
}

async function narrateResults(question, data, expectsResults, conversationHistory = []) {
  // Handle empty results
  if (!data || data.length === 0) {
    if (expectsResults === false) {
      return "The knowledge graph doesn't contain data matching your query. The requested information may not exist in the current dataset.";
    }
    return "No results found. This could mean the data doesn't exist or the query filters were too restrictive.";
  }

  // For simple single-value results, narrate directly
  if (data.length === 1 && Object.keys(data[0]).length === 1) {
    const value = Object.values(data[0])[0];
    const key = Object.keys(data[0])[0];

    if (typeof value === 'number') {
      return `The ${key.replace(/_/g, ' ')} is ${value}.`;
    }
    if (typeof value === 'boolean') {
      return value ? "Yes, this data exists in the knowledge graph." : "No, this data doesn't exist in the knowledge graph.";
    }
  }

  // For complex results, use LLM narration
  const narratorPrompt = `You are presenting results from a knowledge graph query.

RULES:
- Be direct and concise
- For rankings, mention top 3-5 items with key metrics
- Use natural language, no markdown
- Don't explain methodology
- 2-4 sentences for simple queries, up to 6 for complex

User asked: "${question}"
Results:`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: narratorPrompt },
      ...conversationHistory,
      { role: "user", content: JSON.stringify(data, null, 2) },
    ],
  });

  return response.choices[0].message.content.trim();
}

export async function answerUserQuery(question, conversationHistory = []) {
  try {
    // Step 1: Load schema
    const schema = await getSchema();
    console.log(`\n📊 Schema loaded: ${schema.nodes.length} nodes, ${schema.relationships.length} relationships`);

    // Step 2: Generate Cypher from schema
    console.log("🤖 Generating Cypher query...");
    const { reasoning, cypher, parameters, expectsResults } = await generateCypherFromSchema(question, schema, conversationHistory);

    console.log(`💡 Reasoning: ${reasoning}`);
    console.log(`🔧 Generated Cypher:\n${cypher}\n`);
    if (Object.keys(parameters || {}).length > 0) {
      console.log(`📋 Parameters:`, parameters);
    }

    // Step 3: Execute query (Neo4j validates)
    console.log("⚡ Executing query...");
    const data = await runCypherReadOnly(cypher, parameters || {});

    console.log(`✅ Query returned ${data?.length || 0} results`);

    // Step 4: Narrate results
    const answer = await narrateResults(question, data, expectsResults, conversationHistory);

    return {
      answer,
      data,
      cypher,
      reasoning,
      confidence: data?.length > 0 ? 1.0 : 0.0,
    };

  } catch (error) {
    console.error("❌ Query error:", error.message);

    // Neo4j validation failed - return user-friendly error
    if (error.message?.includes("Neo4j") || error.message?.includes("Cypher")) {
      return {
        answer: "I couldn't generate a valid query for that question. Could you rephrase it or be more specific?",
        error: error.message,
        confidence: 0,
      };
    }

    return {
      answer: "An error occurred while processing your question. Please try again.",
      error: error.message,
      confidence: 0,
    };
  }
}