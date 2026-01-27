// queryUnderstanding.js
// PRINCIPLE: Neo4j decides through multi-hop traversal. LLM only narrates.
// GOAL: Use enhanced metadata (confidence, evidence, expertise, outcomes) for intelligence

import OpenAI from "openai";
import { runCypherReadOnly } from "./neo4jClient.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/*
============================================
WEIGHT TABLES (GRAPH INTELLIGENCE CONFIG)
============================================
*/
const WEIGHTS = {
  expertise: {
    expert: 2.0,
    intermediate: 1.5,
    novice: 1.0,
    unknown: 0.8,
  },
  certainty: {
    high: 2.0,
    medium: 1.5,
    low: 1.0,
  },
  outcome: {
    resolved: 1.0,
    improved: 0.7,
    no_change: 0.3,
    worse: 0.0,
  },
  solution_type: {
    permanent: 1.2,
    workaround: 0.8,
    partial: 0.6,
  },
};

/*
============================================
INTENT DEFINITIONS
============================================
*/
const INTENTS = {
  // Issue Analysis
  ISSUE_SEVERITY: "ISSUE_SEVERITY",                    // What are the most severe issues?
  ISSUE_TRENDS: "ISSUE_TRENDS",                        // What issues are trending/emerging?
  PRODUCT_ISSUES: "PRODUCT_ISSUES",                    // What problems affect product X?
  ISSUE_TIMELINE: "ISSUE_TIMELINE",                    // When did issue X start/end?
  
  // Solution Evaluation
  SOLUTION_EFFECTIVENESS: "SOLUTION_EFFECTIVENESS",    // What fixes work best?
  SOLUTION_FOR_ISSUE: "SOLUTION_FOR_ISSUE",           // How to fix issue X?
  EXPERIMENTAL_SOLUTIONS: "EXPERIMENTAL_SOLUTIONS",    // What experimental fixes exist?
  SOLUTION_SUCCESS_RATE: "SOLUTION_SUCCESS_RATE",     // What's the success rate?
  
  // Product Health
  PRODUCT_HEALTH: "PRODUCT_HEALTH",                    // Which products are most problematic?
  PRODUCT_COMPARISON: "PRODUCT_COMPARISON",            // Compare products X vs Y
  PRODUCT_IMPROVEMENT: "PRODUCT_IMPROVEMENT",          // Is product X getting better?
  
  // Source/User Credibility
  SOURCE_RELIABILITY: "SOURCE_RELIABILITY",            // Which sources are most reliable?
  EXPERT_CONSENSUS: "EXPERT_CONSENSUS",                // What do experts say about X?
  USER_CONTRIBUTION: "USER_CONTRIBUTION",              // Who are top contributors?
  
  // Root Cause
  ISSUE_ROOT_CAUSE: "ISSUE_ROOT_CAUSE",               // Why does issue X happen?
  COMMON_PATTERNS: "COMMON_PATTERNS",                  // What patterns exist?
};

/*
============================================
INTENT → DECISION QUERIES
============================================
*/
const INTENT_QUERIES = {

  // =====================================
  // ISSUE SEVERITY (Multi-hop with confidence weighting)
  // =====================================
  [INTENTS.ISSUE_SEVERITY]: {
    cypher: `
MATCH (u:User)-[:AUTHORED]->(r:Report)-[m:MENTIONS]->(i:Issue)
WHERE r.confidence_score >= 0.4
WITH i,
     count(DISTINCT r) AS frequency,
     avg(r.confidence_score) AS avg_confidence,
     avg(m.evidence_strength) AS avg_evidence,
     sum(CASE m.certainty_level 
       WHEN 'high' THEN 2.0
       WHEN 'medium' THEN 1.5
       ELSE 1.0 END) AS certainty_weight,
     sum(CASE u.user_expertise_level
       WHEN 'expert' THEN 2.0
       WHEN 'intermediate' THEN 1.5
       WHEN 'novice' THEN 1.0
       ELSE 0.8 END) AS expertise_weight,
     duration.between(i.last_seen_timestamp, datetime()).days AS days_since
WITH i,
     frequency,
     avg_confidence,
     avg_evidence,
     (frequency * avg_confidence * avg_evidence * certainty_weight * expertise_weight) / (1 + days_since * 0.1) AS severity_score
ORDER BY severity_score DESC
WITH collect({
  issue: i.issue_title,
  category: i.category,
  score: severity_score,
  frequency: frequency,
  avg_confidence: avg_confidence,
  days_since: days_since
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].issue AS issue,
       rows[idx].category AS category,
       round(rows[idx].score * 100) / 100 AS severity_score,
       rows[idx].frequency AS report_count,
       round(rows[idx].avg_confidence * 100) / 100 AS avg_confidence,
       rows[idx].days_since AS days_since_last_seen,
       idx + 1 AS rank
LIMIT 10
`,
  },

  // =====================================
  // ISSUE TRENDS (Temporal analysis)
  // =====================================
  [INTENTS.ISSUE_TRENDS]: {
    cypher: `
MATCH (r:Report)-[:MENTIONS]->(i:Issue)
WHERE duration.between(i.first_seen_timestamp, datetime()).days <= 90
WITH i,
     count(DISTINCT r) AS frequency,
     duration.between(i.first_seen_timestamp, datetime()).days AS days_old,
     duration.between(i.first_seen_timestamp, i.last_seen_timestamp).days AS duration_active
WITH i,
     frequency,
     days_old,
     duration_active,
     (frequency * 30.0) / (days_old + 1) AS velocity_score
ORDER BY velocity_score DESC
WITH collect({
  issue: i.issue_title,
  category: i.category,
  score: velocity_score,
  frequency: frequency,
  days_old: days_old,
  first_seen: i.first_seen_timestamp
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].issue AS issue,
       rows[idx].category AS category,
       round(rows[idx].score * 100) / 100 AS velocity_score,
       rows[idx].frequency AS report_count,
       rows[idx].days_old AS days_since_emergence,
       toString(rows[idx].first_seen) AS first_seen,
       idx + 1 AS rank
LIMIT 10
`,
  },

  // =====================================
  // PRODUCT ISSUES (Filtered by product)
  // =====================================
  [INTENTS.PRODUCT_ISSUES]: {
    cypher: `
MATCH (r:Report)-[:ABOUT_PRODUCT]->(p:Product)
MATCH (r)-[m:MENTIONS]->(i:Issue)
WHERE toLower(p.name) CONTAINS toLower($product)
  AND r.confidence_score >= 0.4
WITH i,
     p,
     count(DISTINCT r) AS frequency,
     avg(r.confidence_score) AS avg_confidence,
     avg(m.evidence_strength) AS avg_evidence
WITH i,
     p.name AS product,
     frequency,
     (frequency * avg_confidence * avg_evidence) AS impact_score
ORDER BY impact_score DESC
WITH collect({
  issue: i.issue_title,
  category: i.category,
  product: product,
  score: impact_score,
  frequency: frequency
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].issue AS issue,
       rows[idx].category AS category,
       rows[idx].product AS product,
       round(rows[idx].score * 100) / 100 AS impact_score,
       rows[idx].frequency AS report_count,
       idx + 1 AS rank
LIMIT 10
`,
  },

  // =====================================
  // SOLUTION EFFECTIVENESS (Multi-hop with outcome weighting)
  // =====================================
  [INTENTS.SOLUTION_EFFECTIVENESS]: {
    cypher: `
MATCH (u:User)-[:AUTHORED]->(r:Report)-[c:CONFIRMS]->(s:Solution)
WITH s,
     count(DISTINCT r) AS confirmations,
     avg(c.confirmation_strength) AS avg_strength,
     sum(CASE c.post_fix_outcome
       WHEN 'resolved' THEN 1.0
       WHEN 'improved' THEN 0.7
       WHEN 'no_change' THEN 0.3
       ELSE 0.0 END) AS success_score,
     sum(CASE u.user_expertise_level
       WHEN 'expert' THEN 2.0
       WHEN 'intermediate' THEN 1.5
       ELSE 1.0 END) AS expertise_weight,
     collect(DISTINCT c.post_fix_outcome) AS outcomes
WITH s,
     confirmations,
     avg_strength,
     success_score,
     expertise_weight,
     outcomes,
     (confirmations * avg_strength * success_score * s.solution_effectiveness_score * expertise_weight) / confirmations AS effectiveness_score
ORDER BY effectiveness_score DESC
WITH collect({
  solution: s.solution_title,
  type: s.solution_type,
  category: s.category,
  score: effectiveness_score,
  confirmations: confirmations,
  effectiveness: s.solution_effectiveness_score,
  outcomes: outcomes
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].solution AS solution,
       rows[idx].type AS solution_type,
       rows[idx].category AS category,
       round(rows[idx].score * 100) / 100 AS effectiveness_score,
       rows[idx].confirmations AS confirmation_count,
       round(rows[idx].effectiveness * 100) / 100 AS stated_effectiveness,
       rows[idx].outcomes AS outcomes,
       idx + 1 AS rank
LIMIT 10
`,
  },

  // =====================================
  // SOLUTION FOR ISSUE (Specific issue solutions)
  // =====================================
  [INTENTS.SOLUTION_FOR_ISSUE]: {
    cypher: `
MATCH (i:Issue)<-[:MENTIONS]-(r:Report)
WHERE toLower(i.issue_title) CONTAINS toLower($issue) OR toLower(i.category) CONTAINS toLower($issue)
WITH i LIMIT 1
MATCH (r2:Report)-[:MENTIONS]->(i)
MATCH (r2)-[rel]->(s:Solution)
WHERE type(rel) IN ['SUGGESTS', 'CONFIRMS']
WITH s,
     count(DISTINCT CASE WHEN type(rel) = 'CONFIRMS' THEN r2 END) AS confirms,
     count(DISTINCT CASE WHEN type(rel) = 'SUGGESTS' THEN r2 END) AS suggests,
     avg(CASE WHEN type(rel) = 'CONFIRMS' THEN rel.confirmation_strength ELSE rel.suggestion_confidence END) AS avg_strength,
     s.solution_effectiveness_score AS effectiveness
WITH s,
     confirms,
     suggests,
     (confirms * 2.0 + suggests * 0.5) * avg_strength * effectiveness AS confidence_score
ORDER BY confidence_score DESC
WITH collect({
  solution: s.solution_title,
  description: s.solution_description,
  type: s.solution_type,
  score: confidence_score,
  confirms: confirms,
  suggests: suggests,
  effectiveness: effectiveness
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].solution AS solution,
       rows[idx].description AS description,
       rows[idx].type AS solution_type,
       round(rows[idx].score * 100) / 100 AS confidence_score,
       rows[idx].confirms AS confirmations,
       rows[idx].suggests AS suggestions,
       round(rows[idx].effectiveness * 100) / 100 AS effectiveness,
       idx + 1 AS rank
LIMIT 5
`,
  },

  // =====================================
  // PRODUCT HEALTH (Cross-product comparison)
  // =====================================
  [INTENTS.PRODUCT_HEALTH]: {
    cypher: `
MATCH (r:Report)-[:ABOUT_PRODUCT]->(p:Product)
MATCH (r)-[:MENTIONS]->(i:Issue)
WHERE r.confidence_score >= 0.4
WITH p,
     count(DISTINCT i) AS issue_count,
     count(DISTINCT r) AS report_count,
     avg(r.confidence_score) AS avg_confidence,
     duration.between(min(r.timestamp), max(r.timestamp)).days AS activity_span
WITH p,
     issue_count,
     report_count,
     avg_confidence,
     activity_span,
     (issue_count * report_count * avg_confidence) / (1 + activity_span * 0.01) AS health_score
ORDER BY health_score DESC
WITH collect({
  product: p.name,
  category: p.category,
  score: health_score,
  issues: issue_count,
  reports: report_count,
  confidence: avg_confidence
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].product AS product,
       rows[idx].category AS category,
       round(rows[idx].score * 100) / 100 AS health_score,
       rows[idx].issues AS unique_issues,
       rows[idx].reports AS total_reports,
       round(rows[idx].confidence * 100) / 100 AS avg_confidence,
       idx + 1 AS rank
LIMIT 15
`,
  },

  // =====================================
  // EXPERT CONSENSUS (Filter by expertise)
  // =====================================
  [INTENTS.EXPERT_CONSENSUS]: {
    cypher: `
MATCH (u:User)-[:AUTHORED]->(r:Report)-[:MENTIONS]->(i:Issue)
WHERE u.user_expertise_level IN ['expert', 'intermediate']
  AND r.confidence_score >= 0.6
WITH i,
     count(DISTINCT u) AS expert_count,
     count(DISTINCT r) AS report_count,
     avg(r.confidence_score) AS avg_confidence,
     collect(DISTINCT u.user_expertise_level) AS expertise_levels
WITH i,
     expert_count,
     report_count,
     avg_confidence,
     expertise_levels,
     expert_count * report_count * avg_confidence AS consensus_score
ORDER BY consensus_score DESC
WITH collect({
  issue: i.issue_title,
  category: i.category,
  score: consensus_score,
  experts: expert_count,
  reports: report_count,
  expertise: expertise_levels
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].issue AS issue,
       rows[idx].category AS category,
       round(rows[idx].score * 100) / 100 AS consensus_score,
       rows[idx].experts AS expert_count,
       rows[idx].reports AS report_count,
       rows[idx].expertise AS expertise_levels,
       idx + 1 AS rank
LIMIT 10
`,
  },

  // =====================================
  // SOURCE RELIABILITY (Credibility ranking)
  // =====================================
  [INTENTS.SOURCE_RELIABILITY]: {
    cypher: `
MATCH (r:Report)-[p:PUBLISHED_VIA]->(s:Source)
WITH s,
     count(DISTINCT r) AS report_count,
     avg(p.source_reliability_score) AS avg_reliability,
     avg(r.confidence_score) AS avg_confidence,
     s.independence_weight AS independence
WITH s,
     report_count,
     avg_reliability,
     avg_confidence,
     independence,
     (avg_reliability * independence * avg_confidence * report_count) AS credibility_score
ORDER BY credibility_score DESC
WITH collect({
  source: s.source_name,
  type: s.source_type,
  score: credibility_score,
  reports: report_count,
  reliability: avg_reliability,
  independence: independence
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].source AS source,
       rows[idx].type AS source_type,
       round(rows[idx].score * 100) / 100 AS credibility_score,
       rows[idx].reports AS report_count,
       round(rows[idx].reliability * 100) / 100 AS avg_reliability,
       round(rows[idx].independence * 100) / 100 AS independence_weight,
       idx + 1 AS rank
`,
  },

  // =====================================
  // EXPERIMENTAL SOLUTIONS (Filter experimental)
  // =====================================
  [INTENTS.EXPERIMENTAL_SOLUTIONS]: {
    cypher: `
MATCH (r:Report)-[sg:SUGGESTS]->(s:Solution)
WHERE sg.is_experimental = true
WITH s,
     count(DISTINCT r) AS suggestion_count,
     avg(sg.suggestion_confidence) AS avg_confidence,
     s.solution_effectiveness_score AS effectiveness
WITH s,
     suggestion_count,
     avg_confidence,
     effectiveness,
     suggestion_count * avg_confidence * effectiveness AS potential_score
ORDER BY potential_score DESC
WITH collect({
  solution: s.solution_title,
  type: s.solution_type,
  category: s.category,
  score: potential_score,
  suggestions: suggestion_count,
  confidence: avg_confidence
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].solution AS solution,
       rows[idx].type AS solution_type,
       rows[idx].category AS category,
       round(rows[idx].score * 100) / 100 AS potential_score,
       rows[idx].suggestions AS suggestion_count,
       round(rows[idx].confidence * 100) / 100 AS avg_confidence,
       idx + 1 AS rank
LIMIT 10
`,
  },

  // =====================================
  // ISSUE ROOT CAUSE (Pattern analysis)
  // =====================================
  [INTENTS.ISSUE_ROOT_CAUSE]: {
    cypher: `
MATCH (r:Report)-[:MENTIONS]->(i:Issue)
MATCH (r)-[:ABOUT_PRODUCT]->(p:Product)
MATCH (r)-[:PUBLISHED_VIA]->(s:Source)
WHERE toLower(i.issue_title) CONTAINS toLower($issue) OR toLower(i.category) CONTAINS toLower($issue)
WITH i, p, s,
     count(r) AS frequency,
     avg(r.confidence_score) AS avg_confidence
ORDER BY frequency DESC
WITH collect({
  issue: i.issue_title,
  product: p.name,
  source: s.source_name,
  source_type: s.source_type,
  frequency: frequency,
  confidence: avg_confidence
}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].issue AS issue,
       rows[idx].product AS affected_product,
       rows[idx].source AS reported_via,
       rows[idx].source_type AS source_type,
       rows[idx].frequency AS frequency,
       round(rows[idx].confidence * 100) / 100 AS avg_confidence,
       idx + 1 AS rank
LIMIT 10
`,
  },
};

/*
============================================
INTENT CLASSIFICATION
============================================
*/
async function classifyIntent(question) {
  const q = question.toLowerCase();

  // Issue queries
  if (q.includes("severe") || q.includes("worst") || q.includes("critical") || q.includes("priority")) 
    return INTENTS.ISSUE_SEVERITY;
  if (q.includes("trend") || q.includes("emerging") || q.includes("new issue")) 
    return INTENTS.ISSUE_TRENDS;
  if (q.includes("problem") && (q.includes("with") || q.includes("on"))) 
    return INTENTS.PRODUCT_ISSUES;
  if (q.includes("when") && q.includes("start")) 
    return INTENTS.ISSUE_TIMELINE;

  // Solution queries
  if ((q.includes("fix") || q.includes("solve")) && (q.includes("best") || q.includes("work"))) 
    return INTENTS.SOLUTION_EFFECTIVENESS;
  if ((q.includes("fix") || q.includes("solve")) && !q.includes("best")) 
    return INTENTS.SOLUTION_FOR_ISSUE;
  if (q.includes("experimental")) 
    return INTENTS.EXPERIMENTAL_SOLUTIONS;
  if (q.includes("success rate")) 
    return INTENTS.SOLUTION_SUCCESS_RATE;

  // Product queries
  if (q.includes("health") || q.includes("problematic") || q.includes("reliable")) 
    return INTENTS.PRODUCT_HEALTH;
  if (q.includes("compare") || q.includes("vs") || q.includes("versus")) 
    return INTENTS.PRODUCT_COMPARISON;
  if (q.includes("getting better") || q.includes("improving")) 
    return INTENTS.PRODUCT_IMPROVEMENT;

  // Credibility queries
  if (q.includes("source") && q.includes("reliable")) 
    return INTENTS.SOURCE_RELIABILITY;
  if (q.includes("expert")) 
    return INTENTS.EXPERT_CONSENSUS;

  // Root cause
  if (q.includes("why") || q.includes("cause") || q.includes("reason")) 
    return INTENTS.ISSUE_ROOT_CAUSE;

  // Default
  return INTENTS.ISSUE_SEVERITY;
}

/*
============================================
PARAMETER EXTRACTION
============================================
*/
function extractParams(question, intent) {
  const params = {};
  
  if (intent === INTENTS.PRODUCT_ISSUES || intent === INTENTS.PRODUCT_COMPARISON) {
    // Extract product name
    const productMatch = question.match(/(?:with|on|for|about)\s+([A-Za-z0-9\s]+?)(?:\s|$|\?)/i);
    if (productMatch) {
      params.product = productMatch[1].trim();
    }
  }
  
  if (intent === INTENTS.SOLUTION_FOR_ISSUE || intent === INTENTS.ISSUE_ROOT_CAUSE) {
    // Extract issue keyword
    const issueMatch = question.match(/(?:fix|solve|about|for)\s+([A-Za-z0-9\s]+?)(?:\s|$|\?)/i);
    if (issueMatch) {
      params.issue = issueMatch[1].trim();
    }
  }
  
  return params;
}

/*
============================================
MAIN QUERY PIPELINE
============================================
*/
export async function answerUserQuery(question, conversationHistory = []) {
  try {
    // Step 1: Classify intent
    const intent = await classifyIntent(question);
    const queryDef = INTENT_QUERIES[intent];

    if (!queryDef) {
      return {
        error: "Query intent not supported. The graph cannot make a decision for this query.",
        intent,
      };
    }

    // Step 2: Extract parameters
    const params = extractParams(question, intent);

    // Step 3: Execute graph decision query
    const data = await runCypherReadOnly(queryDef.cypher, params);

    if (!data || data.length === 0) {
      return {
        answer: "The knowledge graph found no data matching your query criteria.",
        cypher: queryDef.cypher,
        intent,
        method: "graph_intelligence",
        confidence: 0,
        data: [],
      };
    }

    // Step 4: LLM narration (NO reasoning, only formatting)
    const systemPrompt = `You are a narrator for a knowledge graph intelligence system.

The graph has already made ALL DECISIONS using multi-hop traversal and weighted scoring.
Your ONLY job is to present the results in clear, natural language.

RULES:
- DO NOT interpret, analyze, or add reasoning
- DO NOT explain why scores are what they are
- ONLY narrate the numbers, ranks, and labels returned by the graph
- Keep responses concise (3-5 sentences)
- Mention the top 3-5 results if more than 5 exist

The user asked: "${question}"
The graph classified this as: ${intent}
The graph returned these DECISIONS (already ranked and scored):`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(data, null, 2) },
      ],
    });

    return {
      answer: response.choices[0].message.content.trim(),
      cypher: queryDef.cypher,
      intent,
      method: "graph_intelligence",
      confidence: 1.0,
      data,
    };

  } catch (error) {
    console.error("Query execution error:", error);
    return {
      error: "Failed to execute graph query. Please try again.",
      details: error.message,
    };
  }
}