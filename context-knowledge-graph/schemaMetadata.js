// schemaMetadata.js
// PURPOSE: Load Neo4j schema and provide domain guidance for LLM

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
        properties: (r.get("properties") || []).map(p => ({
          property: p.property || 'unknown',
          types: p.types || ['unknown'],
        })),
      })),
      relationships: relResult.records.map((r) => ({
        type: r.get("relType").replace(/[`:\s]/g, ""),
        properties: (r.get("properties") || []).map(p => ({
          property: p.property || 'unknown',
          types: p.types || ['unknown'],
        })),
      })),
      categories,
      sourceTypes,
      expertiseLevels,
      products,
      solutionTypes,

      // Domain guidance for LLM - this is the intelligence layer
      domainGuidance: `
╔════════════════════════════════════════════════════════════════════════════╗
║          CONTEXT KNOWLEDGE GRAPH – INTELLIGENCE ENGINE                    ║
╚════════════════════════════════════════════════════════════════════════════╝

THIS IS AN INTELLIGENCE LAYER, NOT A DATABASE.
Queries produce INSIGHTS, not raw data dumps.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GRAPH NODES & PROPERTIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Report: Observations with confidence scoring
  • report_id, report_content, report_title, timestamp
  • confidence_score (0-1) - weighted by source + user expertise
  • issue_context - factual summary

Issue: Recurring patterns with temporal tracking
  • issue_id, issue_title, issue_description, category
  • affected_models, first_seen_timestamp, last_seen_timestamp
  • NOTE: Severity is COMPUTED from evidence, not stored

Solution: Fixes with effectiveness tracking
  • solution_id, solution_title, solution_description
  • solution_effectiveness_score (0-1)
  • solution_type (workaround | permanent | partial)

User: Evidence sources with expertise levels
  • user_id, username
  • user_expertise_level (novice | intermediate | expert | unknown)

Source: Information channels with credibility
  • source_id, source_name, source_url
  • source_type (forum | review | support | blog)
  • independence_weight (0-1)

Product: Entities being evaluated
  • name (unique), category (Laptop | Desktop | Monitor)

Available Data:
• Products: ${products.map(p => p.name).join(", ")}
• Issue Categories: ${categories.join(", ")}
• Source Types: ${sourceTypes.join(", ")}
• Solution Types: ${solutionTypes.join(", ")}
• Expertise Levels: ${expertiseLevels.join(", ")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RELATIONSHIPS & EVIDENCE STRENGTH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(User)-[:AUTHORED]->(Report)
(Report)-[:MENTIONS {evidence_strength, certainty_level}]->(Issue)
(Report)-[:CONFIRMS {confirmation_strength, post_fix_outcome}]->(Solution)
(Report)-[:SUGGESTS {suggestion_confidence, is_experimental}]->(Solution)
(Report)-[:ABOUT_PRODUCT {issue_count}]->(Product)
(Report)-[:PUBLISHED_VIA {source_reliability_score}]->(Source)
(Issue)-[:AFFECTS]->(Product)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUERY PATTERNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATTERN 1: Issue Severity Ranking
────────────────────────────────────
MATCH (u:User)-[:AUTHORED]->(r:Report)-[m:MENTIONS]->(i:Issue)
WHERE r.confidence_score >= 0.4
WITH i,
  count(DISTINCT r) AS frequency,
  avg(r.confidence_score) AS avg_confidence,
  avg(m.evidence_strength) AS avg_evidence,
  sum(CASE m.certainty_level WHEN 'high' THEN 2.0 WHEN 'medium' THEN 1.5 ELSE 1.0 END) AS certainty_weight,
  sum(CASE u.user_expertise_level WHEN 'expert' THEN 2.0 WHEN 'intermediate' THEN 1.5 ELSE 1.0 END) AS expertise_weight
WITH i, frequency, avg_confidence, avg_evidence, certainty_weight, expertise_weight,
  (frequency * avg_confidence * avg_evidence * certainty_weight * expertise_weight) / 100.0 AS raw_severity
WITH max(raw_severity) AS max_severity,
     min(raw_severity) AS min_severity,
     collect({issue: i, severity: raw_severity, frequency: frequency}) AS all_issues
UNWIND all_issues AS item
RETURN item.issue.issue_title AS issue,
  round((item.severity - min_severity) / (max_severity - min_severity) * 1000) / 1000 AS normalized_severity,
  item.severity AS raw_severity,
  item.frequency AS report_count
ORDER BY normalized_severity DESC
LIMIT 10

PATTERN 2: Product-Specific Issues
──────────────────────────────────
MATCH (r:Report)-[:ABOUT_PRODUCT]->(p:Product)
MATCH (r)-[m:MENTIONS]->(i:Issue)
WHERE toLower(p.name) CONTAINS toLower($product)
  AND r.confidence_score >= 0.4
WITH i, p,
  count(DISTINCT r) AS frequency,
  avg(r.confidence_score) AS avg_confidence
RETURN i.issue_title AS issue, p.name AS product,
  round(frequency * avg_confidence * 1000) / 1000 AS impact_score,
  frequency AS report_count
ORDER BY impact_score DESC
LIMIT 10

PATTERN 3: Solution Effectiveness
─────────────────────────────────
MATCH (r:Report)-[c:CONFIRMS]->(s:Solution)
WITH s,
  count(DISTINCT r) AS confirmations,
  avg(c.confirmation_strength) AS avg_strength,
  sum(CASE c.post_fix_outcome
    WHEN 'resolved' THEN 1.0
    WHEN 'improved' THEN 0.7
    WHEN 'no_change' THEN 0.3
    ELSE 0.0 END) / count(*) AS success_rate
RETURN s.solution_title AS solution,
  round((confirmations * avg_strength * success_rate * s.solution_effectiveness_score) * 1000) / 1000 AS effectiveness_score,
  confirmations
ORDER BY effectiveness_score DESC
LIMIT 10

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORING WEIGHTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User Expertise: expert=2.0, intermediate=1.5, novice=1.0, unknown=0.8
Certainty Level: high=2.0, medium=1.5, low=1.0
Post-Fix Outcome: resolved=1.0, improved=0.7, no_change=0.3, worse=0.0
Solution Type: permanent=1.2, workaround=0.8, partial=0.6

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL CYPHER RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Use WHERE after WITH (NOT HAVING - Neo4j doesn't support it)
✅ All WITH expressions need AS aliases
✅ Use count(DISTINCT x) to avoid duplicates
✅ Use toLower() + CONTAINS for fuzzy matching
✅ Include ORDER BY score DESC and LIMIT for rankings
✅ Use confidence_score >= 0.4 as minimum threshold
✅ Round scores: round(value * 1000) / 1000

• WITH drops variables - carry forward everything you need in later clauses
• If RETURN uses a variable, it must be in the last WITH clause

⚠️ NEVER query Issue.affected_models directly (comma-separated string). ALWAYS use (Issue)-[:AFFECTS]->(Product) for product filtering
❌ Never use HAVING clause
❌ Don't return raw nodes without scoring (RETURN r is invalid for rankings)
❌ Don't invent properties not in schema
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
  console.log("🔍 Loading Neo4j schema...");
  const schema = await getSchema();
  console.log(`✅ Schema loaded: ${schema.nodes.length} node types, ${schema.relationships.length} relationship types`);
  console.log("📦 Products:", schema.products.map(p => p.name).join(", "));
  console.log("🎯 Categories:", schema.categories.join(", "));
}

export function closeDriver() {
  return driver.close();
}