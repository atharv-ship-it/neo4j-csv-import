// schemaMetadata.js - COMPREHENSIVE CYPHER EDUCATION WITH DOMAIN INTELLIGENCE

import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

let schemaCache = null;

export async function getSchema() {
  if (schemaCache) return schemaCache;

  try {
    // Run all queries in parallel with separate sessions
    const [
      nodeResult,
      relResult,
      issueTypesResult,
      platformsResult,
      solutionTypesResult,
      productsResult
    ] = await Promise.all([
      driver.session().run(`
        CALL db.schema.nodeTypeProperties()
        YIELD nodeType, propertyName, propertyTypes
        RETURN nodeType, collect({property: propertyName, types: propertyTypes}) as properties
      `),
      driver.session().run(`
        CALL db.schema.relTypeProperties()
        YIELD relType, propertyName, propertyTypes
        RETURN relType, collect({property: propertyName, types: propertyTypes}) as properties
      `),
      driver.session().run(`
        MATCH (i:Issue)
        RETURN DISTINCT i.type as issueType
        ORDER BY issueType
      `),
      driver.session().run(`
        MATCH (r:Report)
        RETURN DISTINCT r.platform as platform
        ORDER BY platform
      `),
      driver.session().run(`
        MATCH (s:Solution)
        RETURN DISTINCT s.type as solutionType
        ORDER BY solutionType
      `),
      driver.session().run(`
        MATCH (r:Report)
        RETURN DISTINCT r.product as product
        ORDER BY product
      `)
    ]);

    const issueTypes = issueTypesResult.records.map(r => r.get('issueType'));
    const platforms = platformsResult.records.map(r => r.get('platform'));
    const solutionTypes = solutionTypesResult.records.map(r => r.get('solutionType'));
    const products = productsResult.records.map(r => r.get('product'));

    const schema = {
      nodes: nodeResult.records.map((r) => ({
        label: r.get("nodeType").replace(/[`:\s]/g, ""),
        properties: r.get("properties"),
      })),

      relationships: relResult.records.map((r) => ({
        type: r.get("relType").replace(/[`:\s]/g, ""),
        properties: r.get("properties"),
      })),

      // ============================================================================
      // COMPREHENSIVE DOMAIN INTELLIGENCE & CYPHER LANGUAGE GUIDE
      // ============================================================================
      domainGuidance: `
╔════════════════════════════════════════════════════════════════════════════╗
║         CONTEXT KNOWLEDGE GRAPH - CYPHER GUIDE                             ║
║            Understanding Graph Structure & Query Patterns                  ║
╚════════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. GRAPH SCHEMA - NODE TYPES AND PROPERTIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────────────────────────┐
│ NODE: Report (Customer Reviews, Feedback, Problem Reports)              │
├─────────────────────────────────────────────────────────────────────────┤
│ Properties:                                                             │
│ • report_id (String, UNIQUE) - Primary identifier: "rep_001", "rep_002" │
│ • text (String) - Full review/feedback text (150-2000 characters)       │
│ • sentiment_score (Float) - Range [-1.0 to 1.0]                         │
│     → > 0 = Positive sentiment (user satisfied)                         │
│     → < 0 = Negative sentiment (user dissatisfied)                      │
│     → = 0 = Neutral                                                     │
│ • product (String) - Dell product name, CASE-SENSITIVE                  │
│     Available products: ${products.map(p => `"${p}"`).join(", ")}
│ • platform (String) - Source platform where review was posted           │
│     Valid values: ${platforms.map(p => `"${p}"`).join(", ")}
│
│                                                                         │
│ Example JSON:                                                           │
│ {                                                                       │
│   report_id: "rep_001",                                                 │
│   product: "XPS 13",                                                    │
│   platform: "Reddit",                                                   │
│   sentiment_score: 0.25,                                                │
│   text: "Just got my XPS 13. Beautiful screen, but runs hot..."         │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ NODE: Issue (Known Problems, Bug Reports)                               │
├─────────────────────────────────────────────────────────────────────────┤
│ Properties:                                                             │
│   • issue_id (String, UNIQUE) - Primary identifier: "issue_001"         │
│   • type (String) - Category of problem, CASE-SENSITIVE                 │
│     Valid types: ${issueTypes.map(t => `"${t}"`).join(", ")}
│   • severity (String) - Problem severity level                          │
│     Valid values: "Critical", "High", "Medium", "Low"                   │
│   • description (String) - Technical description of the issue           │
│                                                                         │
│ Example JSON:                                                           │
│ {                                                                       │
│   issue_id: "issue_001",                                                │
│   type: "Overheating",                                                  │
│   severity: "High",                                                     │
│   description: "Device runs hot under sustained load, thermal..."       │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ NODE: Solution (Fixes, Workarounds, Patches)                            │
├─────────────────────────────────────────────────────────────────────────┤
│ Properties:                                                             │
│   • solution_id (String, UNIQUE) - Primary identifier                   │
│   • type (String) - Category of solution                                │
│     Available types: ${solutionTypes.map(t => '"' + t + '"').join(", ")}
│   • description (String) - Step-by-step instructions or summary         │
│                                                                         │
│ Example JSON:                                                           │
│ {                                                                       │
│   solution_id: "sol_001",                                               │
│   type: "BIOS_Setting_Change",                                          │
│   description: "Disable CPU power management in BIOS settings..."       │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ NODE: User (Authors of Reports, Reviewers)                              │
├─────────────────────────────────────────────────────────────────────────┤
│ Properties:                                                             │
│   • user_id (String, UNIQUE) - Primary identifier                       │
│   • username (String) - User's username/handle (case-sensitive)         │
│   • platform (String) - Where user is from                              │
│     Same valid values as Report.platform                                │
│                                                                         │
│ Example JSON:                                                           │
│ {                                                                       │
│   user_id: "user_001",                                                  │
│   username: "TechReviewer92",                                           │
│   platform: "Reddit"                                                    │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ NODE: Source (Platforms, Communities)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ Properties:                                                             │
│   • source_id (String, UNIQUE) - Primary identifier                     │
│   • platform (String) - Platform name                                   │
│   • base_url (String) - Base URL of platform                            │
│     Examples: "reddit.com", "twitter.com", "amazon.com"                 │
│                                                                         │
│ Example JSON:                                                           │
│ {                                                                       │
│   source_id: "src_001",                                                 │
│   platform: "Reddit",                                                   │
│   base_url: "reddit.com"                                                │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. GRAPH SCHEMA - RELATIONSHIP TYPES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Relationships (All properties: [empty/none] - no property data)

  1. AUTHORED
     Pattern: (User)-[:AUTHORED]->(Report)
     Meaning: A user wrote/posted this report/review
     Cardinality: One user can author many reports
     
  2. MENTIONS
     Pattern: (Report)-[:MENTIONS]->(Issue)
     Meaning: A report describes/discusses this issue
     Cardinality: One report can mention multiple issues
     
  3. SUGGESTS
     Pattern: (Report)-[:SUGGESTS]->(Solution)
     Meaning: A report suggests/proposes this solution
     Cardinality: One report can suggest multiple solutions
     
  4. CONFIRMS
     Pattern: (Report)-[:CONFIRMS]->(Solution)
     Meaning: A report confirms/validates this solution works
     Cardinality: One report can confirm multiple solutions
     
  5. PUBLISHED_VIA
     Pattern: (Report)-[:PUBLISHED_VIA]->(Source)
     Meaning: This report was published on this platform/source
     Cardinality: Each report published on exactly one platform

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. CYPHER LANGUAGE FUNDAMENTALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CYPHER is Neo4j's graph query language. It uses ASCII-art-like syntax.

┌─────────────────────────────────────────────────────────────────────────┐
│ A. PATTERN MATCHING SYNTAX                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ Nodes in parentheses:                                                   │
│   (n)              - Anonymous node (no variable)                       │
│   (n:Label)        - Node with label 'Label' assigned to variable 'n'   │
│   (n:Label {prop: value})  - Node with property filter                  │
│                                                                         │
│ Relationships in square brackets:                                       │
│   --              - Undirected relationship                             │
│   ->              - Directed relationship (left to right)               │
│   <-              - Directed relationship (right to left)               │
│   -[:TYPE]->      - Relationship type "TYPE"                            │
│   -[r:TYPE]->     - Assign relationship to variable 'r'                 │
│                                                                         │
│ Examples:                                                               │
│   (user:User)-[:AUTHORED]->(report:Report)                              │
│   (report:Report)-[:MENTIONS]->(issue:Issue)                            │
│   (issue:Issue)<-[:MENTIONS]-(report:Report)   <- Same as above         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ B. CYPHER QUERY EXECUTION ORDER                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ Cypher queries execute in this order:                                   │
│                                                                         │
│ 1. MATCH    - Find patterns in the graph                                │
│ 2. WHERE    - Filter the matched patterns                               │
│ 3. WITH     - Transform, aggregate, pass results to next step           │
│ 4. RETURN   - Return final results                                      │
│ 5. ORDER BY - Sort results                                              │
│ 6. LIMIT    - Limit number of results                                   │
│                                                                         │
│ CRITICAL: WHERE filters raw matches. WITH must have AS aliases.         │
│           Use WHERE after WITH to filter aggregations.                  │
│                                                                         │
│ Basic Flow:                                                             │
│   MATCH (pattern) WHERE condition                                       │
│   WITH expression AS alias WHERE filtered_condition                     │
│   RETURN final_expression                                               │
│   ORDER BY expression DESC/ASC                                          │
│   LIMIT number                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ C. VARIABLE BINDING AND ALIASING                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ Variables are assigned to nodes and relationships:                      │
│                                                                         │
│ Single Variable (REQUIRED):                                             │
│   (report:Report)           <- Variable: report                         │
│   -[rel:MENTIONS]->         <- Variable: rel                            │
│                                                                         │
│ Using WITH for Transformations (AS REQUIRED):                           │
│   WITH variable AS newName                                              │
│   WITH report.sentiment_score AS sentiment_value                        │
│   WITH count(*) AS total_count                                          │
│                                                                         │
│ CRITICAL RULE: Every expression in WITH MUST have AS alias              │
│  ✅ WITH report.product AS product, count(*) AS cnt                     │
│   ❌ WITH report.product, count(*)    <- SYNTAX ERROR!                  │
└─────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. CRITICAL RULES FOR THIS DOMAIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rule 1: PLATFORM vs ISSUE TYPE
────────────────────────────────────────
Report.platform = WHERE the report came from (source platform)
Issue.type = WHAT problem is being discussed

❌ WRONG: WHERE report.platform = "Overheating"
✅ RIGHT: WHERE issue.type = "Overheating"

Correct platforms: "Reddit", "Twitter", "Amazon", "YouTube"
Correct issue types: "Overheating", "Battery_Drain", "Display_Issues"

Rule 2: PROPERTY NAMES ARE EXACT
────────────────────────────────────────
ALWAYS use the EXACT property names from schema:
  ✅ issue.type (not issue.name, not issue.problemType)
  ✅ report.sentiment_score (not report.sentiment, not report.score)
  ✅ solution.description (not solution.details, not solution.text)

Rule 3: PRODUCT NAMES ARE CASE-SENSITIVE
────────────────────────────────────────
Product names must match EXACTLY:
  ✅ report.product = "XPS 13"
  ✅ report.product = "G15"
  ✅ report.product = "Inspiron 15"
  ❌ report.product = "xps 13"        <- Wrong case!
  ❌ report.product = "XPS"           <- Wrong format!

Rule 4: SENTIMENT SCORE IS A FLOAT (-1.0 to 1.0)
────────────────────────────────────────────────
  ✅ sentiment_score > 0        <- Positive feedback
  ✅ sentiment_score < 0        <- Negative feedback
  ✅ sentiment_score > 0.5      <- Very positive
  ✅ sentiment_score < -0.5     <- Very negative
  ❌ sentiment_score = "positive"   <- Type error!

Rule 5: NEVER USE HAVING - Use WHERE AFTER WITH
────────────────────────────────────────────────
Neo4j Cypher does NOT support HAVING clause.
Filter aggregations using WHERE after WITH:

❌ WRONG:
   MATCH (issue:Issue)<-[:MENTIONS]-(report:Report)
   RETURN issue.type, count(report) as cnt
   HAVING cnt > 1

✅ RIGHT:
   MATCH (issue:Issue)<-[:MENTIONS]-(report:Report)
   WITH issue.type AS type, count(report) AS cnt
   WHERE cnt > 1
   RETURN type, cnt

Rule 6: ALL EXPRESSIONS IN WITH NEED AS ALIASES
────────────────────────────────────────────────
Every computed value in WITH must have an AS alias:

❌ WRONG:
   WITH report.product, count(report) as cnt

✅ RIGHT:
   WITH report.product AS product, count(report) AS cnt

❌ WRONG:
   WITH issue.type

✅ RIGHT:
   WITH issue.type AS type

Rule 7: USE DISTINCT FOR COUNTING UNIQUE ITEMS
────────────────────────────────────────────────
When counting unique nodes (not rows), use DISTINCT:

To count unique reports mentioning an issue:
  ✅ count(DISTINCT report)     <- Counts unique report nodes
  ❌ count(report)              <- Counts report references (may have duplicates)

To get distinct solution descriptions:
  ✅ COLLECT(DISTINCT solution.description)
  ❌ COLLECT(solution.description)

Rule 8: ALWAYS ADD LIMIT TO PREVENT HUGE RESULTS
─────────────────────────────────────────────────
EVERY query should end with LIMIT:
  LIMIT 100      <- Default safe limit
  LIMIT 10       <- For smaller result sets
  LIMIT 1000     <- Only for very specific queries

Queries without LIMIT may return millions of rows!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. AGGREGATION FUNCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────────────────────────┐
│ COMMON AGGREGATION FUNCTIONS                                            │
├─────────────────────────────────────────────────────────────────────────┤
│ count(*)              - Count all rows/matches                          │
│ count(DISTINCT node)  - Count unique nodes                              │
│ count(property)       - Count non-null property values                  │
│ sum(property)         - Sum numeric values                              │
│ avg(property)         - Average numeric values                          │
│ min(property)         - Minimum value                                   │
│ max(property)         - Maximum value                                   │
│ collect(value)        - Collect values into a list [a,b,c]              │
│ collect(DISTINCT val) - Collect unique values into list                 │
│ size(list)            - Length of a list                                │
└─────────────────────────────────────────────────────────────────────────┘

Aggregation GROUPS BY non-aggregated columns:
  WITH issue.type AS type, count(*) AS cnt
     └─ Automatically groups by 'type'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. COMMON QUERY PATTERNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATTERN 1: Find All Solutions for a Specific Issue
──────────────────────────────────────────────────
Goal: Get all solutions suggested or confirmed for "Battery_Drain"

MATCH (issue:Issue {type: "Battery_Drain"})<-[:MENTIONS]-(report:Report)
-[:SUGGESTS|CONFIRMS]->(solution:Solution)
RETURN DISTINCT solution.description, solution.type
LIMIT 20

Explanation:
  • MATCH finds issue with type "Battery_Drain"
  • <-[:MENTIONS]- finds reports that mention this issue
  • -[:SUGGESTS|CONFIRMS]-> follows either SUGGESTS or CONFIRMS relationships
  • DISTINCT ensures each solution appears only once
  • RETURN returns solution details

PATTERN 2: Find Reports About Product with Specific Issue
──────────────────────────────────────────────────────────
Goal: Find all negative reports about "XPS 13" mentioning "Overheating"

MATCH (report:Report)-[:MENTIONS]->(issue:Issue)
WHERE report.product = "XPS 13"
  AND issue.type = "Overheating"
  AND report.sentiment_score < 0
RETURN report.text, report.sentiment_score, report.platform
ORDER BY report.sentiment_score ASC
LIMIT 50

Explanation:
  • WHERE filters reports by product, issue type, and sentiment
  • ORDER BY shows most negative first (ASC = ascending)
  • Returns actual review text for analysis

PATTERN 3: Find Most Discussed Issues (WITH Grouping)
──────────────────────────────────────────────────────
Goal: Rank issues by number of mentions

MATCH (issue:Issue)<-[:MENTIONS]-(report:Report)
WITH issue.type AS issue_type, issue.severity AS severity, 
     count(DISTINCT report) AS mention_count
WHERE mention_count > 2
RETURN issue_type, severity, mention_count
ORDER BY mention_count DESC
LIMIT 20

Explanation:
  • WITH groups results by issue type and severity
  • count(DISTINCT report) counts unique reports (not duplicate references)
  • WHERE filters to only issues mentioned more than twice
  • ORDER BY shows most discussed first

PATTERN 4: Solutions Confirmed by Multiple Users
──────────────────────────────────────────────────
Goal: Find solutions that users confirm actually work

MATCH (report:Report)-[:CONFIRMS]->(solution:Solution)
WITH solution.description AS description, 
     solution.solution_id AS sol_id,
     count(DISTINCT report) AS confirmations
WHERE confirmations >= 2
RETURN description, sol_id, confirmations
ORDER BY confirmations DESC
LIMIT 30

Explanation:
  • WITH creates aggregation on solutions
  • count(DISTINCT report) prevents double-counting
  • WHERE filters to solutions with 2+ confirmations
  • Shows which solutions are validated by users

PATTERN 5: Find Negative Feedback for Products
──────────────────────────────────────────────
Goal: Get top 20 most negative reviews for "G15"

MATCH (report:Report)
WHERE report.product = "G15" 
  AND report.sentiment_score < 0
RETURN report.text, report.sentiment_score, report.platform
ORDER BY report.sentiment_score ASC
LIMIT 20

Explanation:
  • WHERE filters for product and negative sentiment
  • sentiment_score < 0 means negative feedback
  • ORDER BY ASC shows worst reviews first (most negative)

PATTERN 6: Issues by Platform (Who Reports What)
──────────────────────────────────────────────────
Goal: What issues get reported on Reddit?

MATCH (report:Report)-[:MENTIONS]->(issue:Issue)
WHERE report.platform = "Reddit"
WITH issue.type AS issue_type, count(DISTINCT report) AS report_count
RETURN issue_type, report_count
ORDER BY report_count DESC
LIMIT 15

Explanation:
  • Filters reports by platform first
  • Groups by issue type
  • Shows distribution of problems on each platform

PATTERN 7: High-Severity Issues Impact
────────────────────────────────────────
Goal: Which high-severity issues appear most in negative feedback?

MATCH (report:Report)-[:MENTIONS]->(issue:Issue)
WHERE issue.severity = "High"
  AND report.sentiment_score < -0.3
WITH issue.type AS problem, count(DISTINCT report) AS negative_mentions
RETURN problem, negative_mentions
ORDER BY negative_mentions DESC
LIMIT 10

PATTERN 8: User Contribution Analysis
──────────────────────────────────────
Goal: Most active reviewers and their sentiment patterns

MATCH (user:User)-[:AUTHORED]->(report:Report)
WITH user.username AS username, 
     count(report) AS review_count,
     avg(report.sentiment_score) AS avg_sentiment
WHERE review_count >= 3
RETURN username, review_count, avg_sentiment
ORDER BY review_count DESC
LIMIT 25

Explanation:
  • Aggregates reports per user
  • Calculates average sentiment across their reviews
  • Shows who are the most engaged critics/supporters

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. ADVANCED PATTERNS & TECHNIQUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OPTIONAL RELATIONSHIPS (with OPTIONAL MATCH)
─────────────────────────────────────────────
Match relationships that may or may not exist:

MATCH (report:Report)-[:MENTIONS]->(issue:Issue)
OPTIONAL MATCH (report)-[:SUGGESTS|CONFIRMS]->(solution:Solution)
WHERE report.product = "XPS 13"
RETURN issue.type, report.text, solution.description
LIMIT 50

Explanation:
  • OPTIONAL MATCH allows reports to exist without solutions
  • solution.description may be NULL if no solution exists

FILTERING WITH PROPERTIES
──────────────────────────
Match properties for precise filtering:

MATCH (issue:Issue)<-[:MENTIONS]-(report:Report)
WHERE issue.severity IN ["High", "Critical"]
  AND report.product CONTAINS "XPS"
  AND report.sentiment_score BETWEEN -1 AND 0.5
WITH issue, count(DISTINCT report) AS impact
RETURN issue.type, issue.severity, impact
ORDER BY impact DESC
LIMIT 10

Explanation:
  • IN checks if value is in list
  • CONTAINS checks if string contains substring
  • BETWEEN checks numeric ranges

MULTIPLE PATHS & COMPLEX MATCHING
──────────────────────────────────
Find users who both report issues AND confirm solutions:

MATCH (user:User)-[:AUTHORED]->(report1:Report)-[:MENTIONS]->(issue:Issue)
MATCH (user)-[:AUTHORED]->(report2:Report)-[:CONFIRMS]->(solution:Solution)
WHERE report1 != report2
WITH DISTINCT user.username AS user, 
     count(DISTINCT issue) AS issues_reported,
     count(DISTINCT solution) AS solutions_confirmed
RETURN user, issues_reported, solutions_confirmed
LIMIT 20

Explanation:
  • Two MATCH clauses find different relationship patterns from same user
  • report1 != report2 ensures different reports
  • Shows users who contribute at multiple levels

CONDITIONAL LOGIC
──────────────────
Use CASE statements for conditional returns:

MATCH (issue:Issue)<-[:MENTIONS]-(report:Report)
WITH issue.type AS issue_type, 
     count(DISTINCT report) AS count,
     CASE 
       WHEN count > 50 THEN "Critical"
       WHEN count > 20 THEN "Major"
       WHEN count > 10 THEN "Moderate"
       ELSE "Minor"
     END AS impact_level
RETURN issue_type, count, impact_level
ORDER BY count DESC
LIMIT 15

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. COMMON MISTAKES & HOW TO FIX THEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MISTAKE 1: Using HAVING Instead of WHERE After WITH
─────────────────────────────────────────────────────
❌ BROKEN:
MATCH (issue:Issue)<-[:MENTIONS]-(report:Report)
RETURN issue.type, count(report) as cnt
HAVING cnt > 1

✅ FIXED:
MATCH (issue:Issue)<-[:MENTIONS]-(report:Report)
WITH issue.type AS type, count(report) AS cnt
WHERE cnt > 1
RETURN type, cnt

Why: Neo4j doesn't support HAVING. Use WITH ... WHERE instead.

MISTAKE 2: Missing AS Aliases in WITH
──────────────────────────────────────
❌ BROKEN:
WITH report.product, count(report) as cnt

✅ FIXED:
WITH report.product AS product, count(report) AS cnt

Why: Every expression in WITH needs an alias or it's a syntax error.

MISTAKE 3: Forgetting DISTINCT in Aggregations
───────────────────────────────────────────────
❌ BROKEN (Counts duplicate references):
count(report)

✅ FIXED (Counts unique reports):
count(DISTINCT report)

Why: Without DISTINCT, the same node referenced multiple times gets counted multiple times.

MISTAKE 4: Case Sensitivity in Product Names
──────────────────────────────────────────────
❌ BROKEN (wrong case):
WHERE report.product = "xps 13"

✅ FIXED (exact case):
WHERE report.product = "XPS 13"

Why: String comparison is case-sensitive. "xps 13" ≠ "XPS 13"

MISTAKE 5: Confusing platform and issue.type
──────────────────────────────────────────────
❌ BROKEN (platform is source, not issue type):
WHERE report.platform = "Overheating"

✅ FIXED (platform for source, type for issue):
WHERE issue.type = "Overheating"
  AND report.platform = "Reddit"

Why: report.platform is Reddit/Twitter/Amazon (where feedback came from), 
     issue.type is Overheating/Battery_Drain (what problem is being discussed).

MISTAKE 6: Wrong Property Name
───────────────────────────────
❌ BROKEN:
WHERE solution.instructions CONTAINS "BIOS"

✅ FIXED:
WHERE solution.description CONTAINS "BIOS"

Why: The property is 'description', not 'instructions'.

MISTAKE 7: No LIMIT on Large Queries
──────────────────────────────────────
❌ BROKEN (may return millions):
MATCH (report:Report) RETURN report

✅ FIXED:
MATCH (report:Report) RETURN report LIMIT 100

Why: Without LIMIT, database returns every single node, causing memory issues.

MISTAKE 8: Aggregating Without Grouping
─────────────────────────────────────────
❌ BROKEN (what are we grouping by?):
MATCH (report:Report) 
RETURN count(report)

✅ BETTER:
MATCH (report:Report)-[:MENTIONS]->(issue:Issue)
WITH issue.type AS type, count(report) AS cnt
RETURN type, cnt

Why: Aggregations need grouping keys for meaningful results.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. QUICK REFERENCE - PROPERTY VALUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Valid Platform Values (for Report.platform, User.platform, Source.platform):
${platforms.map(p => '  • ' + p).join('\n')}

Valid Issue Types (for Issue.type):
${issueTypes.map(t => '  • ' + t).join('\n')}

Valid Severity Levels (for Issue.severity):
  • Critical
  • High
  • Medium
  • Low

Valid Solution Types (for Solution.type):
${solutionTypes.map(t => '  • ' + t).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. TESTING YOUR QUERIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before running a query against millions of rows:

1. ADD LIMIT FIRST:
   Always include LIMIT 10 or LIMIT 100 for testing

2. CHECK SYNTAX:
   • Parentheses balanced: (nodes)
   • Square brackets closed: [relationships]
   • All colons for labels: :Label
   • All property names exact

3. VERIFY LOGIC:
   • Are WHERE conditions correct?
   • Do WITH aliases exist for all expressions?
   • Is aggregation grouped correctly?

4. TRACE EXECUTION:
   • MATCH: What patterns am I finding?
   • WHERE: What am I filtering?
   • WITH: What am I transforming?
   • RETURN: What am I returning?

Example validation for:
"Find most negative XPS 13 reviews on Reddit"

MATCH (report:Report)
WHERE report.product = "XPS 13"        ← Correct: exact product name
  AND report.platform = "Reddit"       ← Correct: platform not type
  AND report.sentiment_score < 0       ← Correct: negative = < 0
RETURN report.text, report.sentiment_score
ORDER BY report.sentiment_score ASC    ← Most negative first
LIMIT 20                               ← Safe limit

✅ Passes all checks!

════════════════════════════════════════════════════════════════════════════════
END OF CYPHER GUIDE
════════════════════════════════════════════════════════════════════════════════
      `.trim(),
    };

    schemaCache = schema;
    return schema;
  } catch (error) {
    console.error("Error loading schema:", error);
    throw error;
  }
}

export async function initializeSchemaCache() {
  console.log("🔍 Loading Neo4j schema metadata...");
  const schema = await getSchema();
  console.log(
    `✅ Schema loaded: ${schema.nodes.length} node types, ${schema.relationships.length} relationship types`
  );
  console.log("\n📋 Available Node Labels:");
  schema.nodes.forEach((n) => {
    console.log(` - ${n.label}`);
  });
  console.log("\n🔗 Available Relationships:");
  schema.relationships.forEach((r) => {
    console.log(` - ${r.type}`);
  });
}

export function closeDriver() {
  return driver.close();
}