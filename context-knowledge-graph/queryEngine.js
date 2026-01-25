import OpenAI from "openai";
import { runCypherReadOnly } from "./neo4jClient.js";
import { getSchemaMetadata, generateSchemaDocumentation } from "./schemaMetadata.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * MAIN ENTRY POINT
 */
export async function answerUserQuery(userQuestion) {
  try {
    // Pre-fetch schema metadata in parallel (will use cache if available)
    const metadataPromise = getSchemaMetadata();

    // Step 1: Generate Cypher with retry logic
    let cypher;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Wait for metadata if needed (will be instant if cached)
        await metadataPromise;
        cypher = await generateCypher(userQuestion);
        cypher = optimizeCypher(cypher);
        break;
      } catch (error) {
        console.error(`Cypher generation attempt ${attempt} failed:`, error.message);
        if (attempt === 2) {
          throw new Error(`Failed to generate query: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Step 2: Execute query with retry logic
    let data;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        data = await runCypherReadOnly(cypher);
        break;
      } catch (error) {
        console.error(`Query execution attempt ${attempt} failed:`, error.message);

        if (attempt === 3) {
          throw new Error(`Query execution failed after 3 attempts: ${error.message}`);
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    // Step 3: Verbalize results
    const answer = await verbalizeAnswer(userQuestion, data);

    return {
      cypher,
      data,
      answer,
    };
  } catch (error) {
    console.error("Error in answerUserQuery:", error);

    // Better error classification
    if (error.message.includes("SyntaxError") || 
        error.message.includes("Invalid syntax") ||
        error.message.includes("Unknown function")) {
      return {
        error: "I couldn't generate a valid query for your question. Please try rephrasing it.",
        details: error.message,
      };
    }

    if (error.message.includes("execution failed")) {
      return {
        error: "The database query failed to execute. Please try again or contact support.",
        details: error.message,
      };
    }

    if (error.message.includes("Failed to generate")) {
      return {
        error: "I had trouble understanding your question. Could you rephrase it?",
        details: error.message,
      };
    }

    return {
      error: "An unexpected error occurred while processing your question.",
      details: error.message,
    };
  }
}

/**
 * QUERY OPTIMIZATION & VALIDATION
 */
function optimizeCypher(cypher) {
  let optimized = cypher.trim();

  // Remove markdown code blocks if present
  optimized = optimized.replace(/```cypher\n?/gi, '').replace(/```\n?/g, '');

  // Ensure LIMIT is present and <= 100
  if (!optimized.toUpperCase().includes("LIMIT")) {
    if (optimized.endsWith(";")) {
      optimized = optimized.slice(0, -1) + " LIMIT 100;";
    } else {
      optimized += " LIMIT 100";
    }
  }

  const limitMatch = optimized.match(/LIMIT\s+(\d+)/i);
  if (limitMatch) {
    const limit = parseInt(limitMatch[1]);
    if (limit > 100) {
      optimized = optimized.replace(/LIMIT\s+\d+/i, "LIMIT 100");
    }
  }

  // Warn about potentially slow queries
  if (optimized.toUpperCase().includes("MATCH") &&
      !optimized.toUpperCase().includes("WHERE") &&
      !optimized.toUpperCase().includes("LIMIT")) {
    console.warn("⚠️  Query without WHERE or LIMIT detected - may be inefficient");
  }

  return optimized;
}

/**
 * LLM → CYPHER GENERATION
 */
async function generateCypher(question) {
  // Get schema metadata and build enhanced prompt
  const metadata = await getSchemaMetadata();
  const schemaDoc = generateSchemaDocumentation(metadata);
  const enhancedPrompt = buildCypherGenerationPrompt(schemaDoc);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: enhancedPrompt
      },
      { role: "user", content: question }
    ]
  });

  return response.choices[0].message.content.trim();
}

/**
 * DATA → NATURAL LANGUAGE
 */
async function verbalizeAnswer(question, data) {
  const MAX_RESULTS = 50;
  const MAX_JSON_LENGTH = 50000;

  let truncatedData = data;
  let truncationNote = "";

  if (data.length > MAX_RESULTS) {
    truncatedData = data.slice(0, MAX_RESULTS);
    truncationNote = `\n\n[Note: Showing ${MAX_RESULTS} of ${data.length} total results]`;
  }

  let jsonString = JSON.stringify(truncatedData, null, 2);

  if (jsonString.length > MAX_JSON_LENGTH) {
    truncatedData = truncatedData.slice(0, Math.floor(MAX_RESULTS / 2));
    jsonString = JSON.stringify(truncatedData, null, 2);
    truncationNote = `\n\n[Note: Results truncated due to size. Showing ${truncatedData.length} results]`;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1, // Lower temperature to reduce hallucination
    messages: [
      {
        role: "system",
        content: VERBALIZATION_PROMPT
      },
      {
        role: "user",
        content: `User question: ${question}\n\nDatabase result:\n${jsonString}${truncationNote}`
      }
    ]
  });

  return response.choices[0].message.content.trim();
}

/**
 * ========================================
 * CYPHER GENERATION PROMPT BUILDER
 * ========================================
 */
function buildCypherGenerationPrompt(schemaDoc) {
  return `
You are a Cypher query generator for a Neo4j product feedback database.
Return ONLY the Cypher query - no markdown, no code blocks, no explanations, no preamble.

${schemaDoc}

========================================
QUERY GENERATION RULES
========================================

1. ALWAYS include LIMIT clause (max 100)

2. Use WHERE clauses for filtering - avoid full node scans

3. Text search options:
   - Exact: WHERE i.description = 'battery drain'
   - Contains: WHERE i.description CONTAINS 'battery'
   - Case-insensitive: WHERE toLower(i.description) CONTAINS 'battery'
   - Regex: WHERE i.description =~ '(?i).*battery.*'

4. Sentiment filtering:
   - Positive: WHERE r.sentiment_score > 0
   - Negative: WHERE r.sentiment_score < 0
   - Very negative: WHERE r.sentiment_score < -0.5
   - Range: WHERE r.sentiment_score >= -0.5 AND r.sentiment_score <= 0.5

5. Aggregations:
   - Use WITH for grouping before final RETURN
   - Always use DISTINCT when counting across relationships
   - Example: WITH u, COUNT(DISTINCT r) AS report_count

6. Ordering:
   - For "most/top/best": ORDER BY DESC + LIMIT
   - For "least/bottom": ORDER BY ASC + LIMIT

7. Solution queries:
   - SUGGESTS = proposed/recommended solutions
   - CONFIRMS = verified/proven solutions
   - For proven solutions: MATCH (r)-[:CONFIRMS]->(s)

8. Property access:
   - Severity: i.severity (string or numeric)
   - Sentiment: r.sentiment_score (float: -1.0 to 1.0)
   - Text: r.text, i.description, s.description

========================================
EXAMPLE QUERIES
========================================

Q: "What are the most severe issues?"
A: MATCH (i:Issue) WHERE i.severity IS NOT NULL RETURN i.issue_id, i.type, i.severity, i.description ORDER BY i.severity DESC LIMIT 10

Q: "Which users reported the most issues?"
A: MATCH (u:User)-[:AUTHORED]->(r:Report)-[:MENTIONS]->(i:Issue) WITH u, COUNT(DISTINCT i) AS issue_count RETURN u.username, u.platform, issue_count ORDER BY issue_count DESC LIMIT 10

Q: "What solutions actually worked for battery issues?"
A: MATCH (r:Report)-[:CONFIRMS]->(s:Solution) MATCH (r)-[:MENTIONS]->(i:Issue) WHERE toLower(i.description) CONTAINS 'battery' RETURN DISTINCT s.solution_id, s.type, s.description, COUNT(r) AS confirmations ORDER BY confirmations DESC LIMIT 20

Q: "Show negative feedback about XPS laptops"
A: MATCH (r:Report) WHERE toLower(r.product) CONTAINS 'xps' AND r.sentiment_score < 0 RETURN r.report_id, r.product, r.text, r.sentiment_score ORDER BY r.sentiment_score ASC LIMIT 25

Q: "Which products have the most issues?"
A: MATCH (r:Report)-[:MENTIONS]->(i:Issue) WHERE r.product IS NOT NULL WITH r.product, COUNT(DISTINCT i) AS issue_count RETURN r.product, issue_count ORDER BY issue_count DESC LIMIT 15

Q: "Find issues with no confirmed solutions"
A: MATCH (i:Issue)<-[:MENTIONS]-(r:Report) WHERE NOT EXISTS { MATCH (r2:Report)-[:CONFIRMS]->(:Solution) WHERE (r2)-[:MENTIONS]->(i) } RETURN DISTINCT i.issue_id, i.type, i.description, i.severity ORDER BY i.severity DESC LIMIT 20

Q: "Which platforms are most active?"
A: MATCH (u:User)-[:AUTHORED]->(r:Report) WITH u.platform AS platform, COUNT(DISTINCT u) AS user_count, COUNT(r) AS report_count RETURN platform, user_count, report_count ORDER BY report_count DESC LIMIT 10

Q: "Show me solutions suggested multiple times"
A: MATCH (r:Report)-[:SUGGESTS]->(s:Solution) WITH s, COUNT(r) AS suggestion_count WHERE suggestion_count > 1 RETURN s.solution_id, s.type, s.description, suggestion_count ORDER BY suggestion_count DESC LIMIT 20

Q: "Who are the top contributors on Reddit?"
A: MATCH (u:User)-[:AUTHORED]->(r:Report)-[:PUBLISHED_VIA]->(src:Source) WHERE toLower(src.platform) CONTAINS 'reddit' WITH u, COUNT(r) AS report_count RETURN u.username, report_count ORDER BY report_count DESC LIMIT 15

Q: "What's the average sentiment for MacBook reports?"
A: MATCH (r:Report) WHERE toLower(r.product) CONTAINS 'macbook' RETURN AVG(r.sentiment_score) AS avg_sentiment, COUNT(r) AS total_reports

========================================
COMMON MISTAKES TO AVOID
========================================

❌ WRONG: (Report)-[:MENTIONS]->(Issue)-[:SUGGESTS]->(Solution)
✅ RIGHT: (Report)-[:MENTIONS]->(Issue) and (Report)-[:SUGGESTS]->(Solution)

❌ WRONG: MATCH (u:User) RETURN u (scans all users)
✅ RIGHT: MATCH (u:User) RETURN u LIMIT 50

❌ WRONG: COUNT(r) when you need unique counts
✅ RIGHT: COUNT(DISTINCT r)

❌ WRONG: WHERE product = 'xps' (case-sensitive, exact match)
✅ RIGHT: WHERE toLower(product) CONTAINS 'xps'

========================================
CRITICAL REMINDERS
========================================

- Return ONLY the Cypher query, nothing else
- No markdown code blocks (no \`\`\`cypher)
- No explanations or comments
- Maximum LIMIT is 100
- Use DISTINCT for relationship counts
- Use toLower() for case-insensitive matching
- Property names are case-sensitive
- If question is vague, generate a broad query that returns options
`.trim();
}

/**
 * ========================================
 * VERBALIZATION PROMPT
 * ========================================
 */
const VERBALIZATION_PROMPT = `
You convert database query results into clear, natural answers.

========================================
CORE PRINCIPLES
========================================

1. Answer ONLY using data provided - NEVER invent or assume information
2. If data is empty array [], say "No results found"
3. Use plain text - NO markdown formatting (**bold**, _italic_, \`code\`)
4. Be conversational and concise
5. Format lists simply:
   ✓ "1. Item" or "- Item"
   ✗ No bullets (•), asterisks, or special characters

========================================
RESPONSE PATTERNS
========================================

EMPTY RESULTS []:
"No results found. This could mean there are no [items] matching your criteria in the database."

SINGLE RESULT (1 item):
Direct statement: "The most severe issue is [type] (Severity: X) - [description]"

SMALL LIST (2-5 items):
"Here are the top [N] [items]:
1. [Item 1]
2. [Item 2]"

MEDIUM LIST (6-20 items):
"Found [N] results. Here are the top 10:
1. [Item]
..."

LARGE LIST (20+ items):
"There are [N] total results. The top 5 are:
1. [Item]
..."

========================================
DOMAIN-SPECIFIC FORMATTING
========================================

ISSUES:
Format: "[Type] (Severity: X) - [Description]"
Example: "Hardware issue (Severity: 5) - Battery drains in 2 hours"

SOLUTIONS:
- Distinguish suggested vs confirmed
- "Suggested by 5 users" or "Confirmed effective by 3 users"
- If both: "Suggested by 8 users, confirmed by 2"

SENTIMENT SCORES (float -1.0 to 1.0):
- > 0.5 = "very positive"
- 0 to 0.5 = "somewhat positive"
- 0 = "neutral"
- -0.5 to 0 = "somewhat negative"
- < -0.5 = "very negative"

PRODUCTS:
Group if multiple: "XPS 15: 12 issues, XPS 13: 8 issues"

USERS:
Show activity: "alice - 23 reports" or "bob (Reddit) - 18 issues"

========================================
ADDING INSIGHTS
========================================

Mention patterns when clear:
✓ "Most issues relate to battery performance"
✓ "Reddit has 3x more reports than Twitter"

Call out outliers:
✓ "User alice reported 42 issues - significantly more than average"

========================================
TRUNCATION HANDLING
========================================

If you see "[Note: Showing 50 of 200 results]":
Say: "Showing top 50 of 200 total results:"

========================================
QUALITY EXAMPLES
========================================

INPUT: []
OUTPUT: "No results found. There may be no issues matching your criteria."

INPUT: [{"username": "alice", "issue_count": 23}, {"username": "bob", "issue_count": 18}]
OUTPUT: "The top 2 users by issues reported:
1. alice - 23 issues
2. bob - 18 issues"

INPUT: [{"issue_id": "i1", "type": "hardware", "severity": "5", "description": "Battery drains fast"}]
OUTPUT: "The most severe issue is a hardware problem (Severity: 5) where the battery drains fast."

INPUT: [{"solution_id": "s1", "description": "Update BIOS", "confirmations": 12}]
OUTPUT: "The most confirmed solution is updating the BIOS, verified effective by 12 users."

INPUT: [{"product": "XPS 15", "issue_count": 24}, {"product": "XPS 13", "issue_count": 18}]
OUTPUT: "Products with the most issues:
1. XPS 15 - 24 issues
2. XPS 13 - 18 issues"

========================================
CRITICAL RULES
========================================

- NEVER invent data not in results
- NEVER use markdown formatting
- Keep numbers exact as shown
- Stay factual and neutral
- If truncated, mention it naturally
- No code blocks, no special formatting
`.trim();