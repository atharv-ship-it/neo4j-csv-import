// schemaMetadata.js
// PURPOSE: Schema + Intelligence-Driven Domain Knowledge
// PRINCIPLE: Teach the system HOW THE GRAPH MAKES DECISIONS using enhanced metadata

import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
  { disableLosslessIntegers: true }
);

let schemaCache = null;

export async function getSchema() {
  if (schemaCache) return schemaCache;

  try {
    const [
      nodeResult,
      relResult,
      categoriesResult,
      sourceTypesResult,
      expertiseLevelsResult,
      productsResult,
      solutionTypesResult
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
        RETURN DISTINCT i.category as category
        ORDER BY category
      `),
      driver.session().run(`
        MATCH (s:Source)
        RETURN DISTINCT s.source_type as sourceType
        ORDER BY sourceType
      `),
      driver.session().run(`
        MATCH (u:User)
        RETURN DISTINCT u.user_expertise_level as expertiseLevel
        ORDER BY expertiseLevel
      `),
      driver.session().run(`
        MATCH (p:Product)
        RETURN DISTINCT p.name as product, p.category as category
        ORDER BY product
      `),
      driver.session().run(`
        MATCH (s:Solution)
        RETURN DISTINCT s.solution_type as solutionType
        ORDER BY solutionType
      `)
    ]);

    const categories = categoriesResult.records.map(r => r.get('category'));
    const sourceTypes = sourceTypesResult.records.map(r => r.get('sourceType'));
    const expertiseLevels = expertiseLevelsResult.records.map(r => r.get('expertiseLevel'));
    const products = productsResult.records.map(r => ({
      name: r.get('product'),
      category: r.get('category')
    }));
    const solutionTypes = solutionTypesResult.records.map(r => r.get('solutionType'));

    const schema = {
      nodes: nodeResult.records.map((r) => ({
        label: r.get("nodeType").replace(/[`:\s]/g, ""),
        properties: r.get("properties"),
      })),

      relationships: relResult.records.map((r) => ({
        type: r.get("relType").replace(/[`:\s]/g, ""),
        properties: r.get("properties"),
      })),

      // Extracted domain values for query building
      categories,
      sourceTypes,
      expertiseLevels,
      products,
      solutionTypes,

      // =====================================================================
      // ENHANCED GRAPH INTELLIGENCE CONTRACT
      // =====================================================================
      domainGuidance: `
╔════════════════════════════════════════════════════════════════════╗
║    CONTEXT KNOWLEDGE GRAPH – INTELLIGENCE DECISION ENGINE          ║
╚════════════════════════════════════════════════════════════════════╝

THIS IS NOT A DATABASE. THIS IS AN INTELLIGENCE LAYER.
Every query MUST produce DECISIONS, not data dumps.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. GRAPH INTELLIGENCE PRINCIPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The graph contains ENHANCED METADATA that enables intelligent decisions:

• Reports have CONFIDENCE SCORES (0-1) based on source + user expertise
• Issues have TEMPORAL TRACKING (first_seen, last_seen) for trend analysis
• Solutions have EFFECTIVENESS SCORES (0-1) + OUTCOME TRACKING
• Relationships have STRENGTH METRICS (evidence, confirmation, suggestion)
• Sources have CREDIBILITY METRICS (reliability, independence)
• Users have EXPERTISE LEVELS (novice, intermediate, expert, unknown)

EVERY DECISION MUST USE THESE METRICS.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. NODE SEMANTICS (ENHANCED)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NODE: Report
Intelligence: Noisy observations with WEIGHTED CREDIBILITY
Properties:
• report_id (UNIQUE)
• report_content (raw text)
• report_title (summary)
• timestamp (datetime) - when observed
• confidence_score (0-1) - derived from source + user expertise
• issue_context (factual summary, max 200 chars)

NODE: Issue
Intelligence: Recurring patterns with TEMPORAL EVOLUTION
Properties:
• issue_id (UNIQUE)
• issue_title
• issue_description
• category (battery, display, thermal, connectivity, etc.)
• affected_models (comma-separated product names)
• first_seen_timestamp (datetime) - emergence tracking
• last_seen_timestamp (datetime) - recency tracking
NOTE: NO severity field - severity is COMPUTED from evidence

NODE: Solution
Intelligence: Fixes with VERIFIED EFFECTIVENESS
Properties:
• solution_id (UNIQUE)
• solution_title
• solution_description
• solution_effectiveness_score (0-1) - stated/measured effectiveness
• solution_type (workaround | permanent | partial)
• category (maps to issue category)

NODE: User
Intelligence: Evidence sources with EXPERTISE WEIGHTING
Properties:
• user_id (UNIQUE)
• username
• user_expertise_level (novice | intermediate | expert | unknown)

NODE: Source
Intelligence: Information channels with CREDIBILITY METRICS
Properties:
• source_id (UNIQUE)
• source_name
• source_url
• source_type (forum | review | support | blog)
• independence_weight (0-1) - how independent/unbiased

NODE: Product
Intelligence: Entities with INFERRED HEALTH SCORES
Properties:
• name (UNIQUE)
• category (Laptop | Desktop | Monitor)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. RELATIONSHIP SEMANTICS (WEIGHTED EVIDENCE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(User)-[:AUTHORED]->(Report)
Meaning: Attribution for expertise weighting

(Report)-[:MENTIONS {evidence_strength, certainty_level}]->(Issue)
Intelligence: HOW STRONGLY the report evidences the issue
Properties:
• evidence_strength (1-5) - strength of evidence
• certainty_level (low | medium | high) - author's confidence

(Report)-[:SUGGESTS {suggestion_confidence, is_experimental}]->(Solution)
Intelligence: HYPOTHESIS-level fixes (unverified)
Properties:
• suggestion_confidence (1-5) - how confident the suggestion is
• is_experimental (boolean) - if the solution is experimental

(Report)-[:CONFIRMS {confirmation_strength, post_fix_outcome, confirmed_at_timestamp}]->(Solution)
Intelligence: VERIFIED fixes with outcome tracking
Properties:
• confirmation_strength (1-5) - strength of confirmation
• post_fix_outcome (resolved | improved | no_change | worse)
• confirmed_at_timestamp (datetime) - when confirmed

(Report)-[:PUBLISHED_VIA {source_reliability_score}]->(Source)
Intelligence: Evidence provenance with reliability
Properties:
• source_reliability_score (0-1) - reliability for this specific report

(Report)-[:ABOUT_PRODUCT {issue_count}]->(Product)
Intelligence: Scope binding
Properties:
• issue_count - number of distinct issues mentioned

(Issue)-[:AFFECTS]->(Product)
Intelligence: Problem-product mapping

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. INTELLIGENCE METRICS (COMPUTED IN CYPHER)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ISSUE SEVERITY (COMPUTED - not stored):
frequency × evidence_strength × certainty_weight × confidence_score × recency_factor

SOLUTION CONFIDENCE (COMPUTED):
(confirmations × confirmation_strength × effectiveness_score) / attempts

PRODUCT HEALTH SCORE (COMPUTED):
distinct_issues × weighted_report_count × avg_confidence × temporal_factor

SOURCE CREDIBILITY (COMPUTED):
independence_weight × avg_reliability_score × platform_diversity

USER AUTHORITY (COMPUTED):
expertise_weight × report_count × avg_confidence_of_reports

TEMPORAL RELEVANCE (COMPUTED):
1 / (days_since_last_seen + 1) - recent issues score higher

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. DECISION QUERY CONTRACT (MANDATORY PATTERNS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EVERY USER QUERY MUST RETURN:
1. A NUMERIC SCORE (impact, confidence, severity, health, etc.)
2. A RANK (1 = highest priority)
3. SUPPORTING EVIDENCE COUNTS (how many reports, confirmations, etc.)
4. DECISION LABEL (if score crosses threshold)

CANONICAL RANKING PATTERN:
MATCH (r:Report)-[m:MENTIONS]->(i:Issue)
WHERE m.certainty_level IN ['medium', 'high']
  AND r.confidence_score >= 0.5
WITH i,
     count(DISTINCT r) AS frequency,
     avg(m.evidence_strength) AS avg_evidence,
     avg(r.confidence_score) AS avg_confidence,
     duration.between(i.last_seen_timestamp, datetime()).days AS days_since
WITH i,
     (frequency * avg_evidence * avg_confidence) / (1 + days_since) AS severity_score
ORDER BY severity_score DESC
WITH collect({issue: i, score: severity_score, frequency: frequency}) AS rows
UNWIND range(0, size(rows)-1) AS idx
RETURN rows[idx].issue.issue_title AS issue,
       rows[idx].issue.category AS category,
       round(rows[idx].score * 100) / 100 AS severity_score,
       rows[idx].frequency AS report_count,
       idx + 1 AS rank
LIMIT 10

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. QUERY CATEGORIES (INTELLIGENCE PATHS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ISSUE PRIORITIZATION:
• What problems are most severe? → Multi-hop: Report→Issue, weight by confidence+evidence+recency
• What issues are trending? → Temporal: Compare first_seen vs last_seen density
• What affects product X? → Filter: Report→Product→Issue, aggregate by evidence

SOLUTION EVALUATION:
• What fixes work best? → Multi-hop: Report→CONFIRMS→Solution, weight by outcome+strength
• Are there experimental fixes? → Filter: SUGGESTS with is_experimental=true
• What's the success rate? → Aggregate: CONFIRMS outcomes (resolved/improved vs no_change/worse)

PRODUCT HEALTH:
• Which products are most problematic? → Multi-hop: Product←Issue←Report, weight by confidence
• Is product X getting better? → Temporal: Compare issue frequency over time
• What's the risk score? → Aggregate: distinct issues × weighted reports

SOURCE CREDIBILITY:
• Which sources are most reliable? → Aggregate: independence_weight × avg_reliability
• Do expert users confirm? → Filter: User.expertise_level='expert' + CONFIRMS

TEMPORAL ANALYSIS:
• Are issues getting resolved? → Temporal: Compare first_seen to last confirmed_at
• What's emerging? → Temporal: first_seen in last 30 days + high frequency

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. EXPERTISE WEIGHTING TABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User Expertise → Weight:
• expert → 2.0
• intermediate → 1.5
• novice → 1.0
• unknown → 0.8

USAGE: Multiply by evidence_strength or confirmation_strength

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. CERTAINTY WEIGHTING TABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Certainty Level → Weight:
• high → 2.0
• medium → 1.5
• low → 1.0

USAGE: Multiply with evidence_strength

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. OUTCOME SCORING TABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

post_fix_outcome → Success Score:
• resolved → 1.0
• improved → 0.7
• no_change → 0.3
• worse → 0.0

USAGE: Calculate solution success rate

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. ENFORCEMENT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ INVALID QUERY: MATCH (r:Report) RETURN r.report_content
Reason: No score, no rank, no decision

✅ VALID QUERY: (see examples in section 5)

❌ INVALID: Ignore confidence_score in aggregation
✅ VALID: Weight all aggregations by confidence_score

❌ INVALID: Use stored severity from Issue node
✅ VALID: Compute severity from Report evidence

❌ INVALID: LLM interprets "resolved" vs "improved"
✅ VALID: Cypher applies outcome_score weights

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
11. SUCCESS CRITERIA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The system demonstrates intelligence if:
✓ Removing the LLM preserves all rankings and scores
✓ Multiple LLMs produce identical numeric conclusions
✓ Every answer traces to weighted graph traversal
✓ Confidence, expertise, and temporal factors affect all decisions
✓ Solutions are ranked by actual confirmation outcomes
✓ Issues are ranked by composite evidence metrics

THIS FILE DEFINES GRAPH INTELLIGENCE AUTHORITY.
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
  console.log("🔍 Loading Neo4j schema with intelligence metadata...");
  const schema = await getSchema();
  console.log(
    `✅ Schema loaded: ${schema.nodes.length} node types, ${schema.relationships.length} relationship types`
  );
  console.log("\n📋 Node Labels:");
  schema.nodes.forEach((n) => console.log(`  • ${n.label}`));
  console.log("\n🔗 Relationships:");
  schema.relationships.forEach((r) => console.log(`  • ${r.type}`));
  console.log("\n🎯 Domain Categories:", schema.categories.join(", "));
  console.log("🏷️  Source Types:", schema.sourceTypes.join(", "));
  console.log("🧠 Expertise Levels:", schema.expertiseLevels.join(", "));
  console.log("🔧 Solution Types:", schema.solutionTypes.join(", "));
  console.log(`📦 Products: ${schema.products.length} unique products`);
}

export function closeDriver() {
  return driver.close();
}