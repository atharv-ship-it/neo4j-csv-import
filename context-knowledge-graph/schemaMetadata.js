// schemaMetadata.js (V1)
// PURPOSE: Expose the ACTUAL Neo4j schema to the LLM
// GUARANTEE: Nothing here assumes data that does not exist

import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
  { disableLosslessIntegers: true }
);

let schemaCache = null;

export async function getSchema() {
  if (schemaCache) return schemaCache;

  try {
    const [nodeResult, relResult, sourcesResult, productsResult] =
      await Promise.all([
        // Node labels + properties
        driver.session().run(`
          CALL db.schema.nodeTypeProperties()
          YIELD nodeType, propertyName, propertyTypes
          RETURN nodeType, collect({
            property: propertyName,
            types: propertyTypes
          }) AS properties
        `),

        // Relationship types + properties
        driver.session().run(`
          CALL db.schema.relTypeProperties()
          YIELD relType, propertyName, propertyTypes
          RETURN relType, collect({
            property: propertyName,
            types: propertyTypes
          }) AS properties
        `),

        // Sources actually present
        driver.session().run(`
          MATCH (s:Source)
          RETURN DISTINCT s.name AS source
          ORDER BY source
        `),

        // Products inferred so far
        driver.session().run(`
          MATCH (p:Product)
          RETURN DISTINCT p.name AS name
          ORDER BY name
        `),
      ]);

    const nodes = nodeResult.records.map(r => ({
      label: r.get("nodeType").replace(/[`:\s]/g, ""),
      properties: (r.get("properties") || []).map(p => ({
        property: p.property,
        types: p.types
      }))
    }));

    const relationships = relResult.records.map(r => ({
      type: r.get("relType").replace(/[`:\s]/g, ""),
      properties: (r.get("properties") || []).map(p => ({
        property: p.property,
        types: p.types
      }))
    }));

    const sources = sourcesResult.records.map(r => r.get("source"));
    const products = productsResult.records.map(r => r.get("name"));

    const schema = {
      nodes,
      relationships,
      sources,
      products,

      // ===============================
      // DOMAIN GUIDANCE (V1 ONLY)
      // ===============================
      domainGuidance: `
THIS IS A V1 KNOWLEDGE GRAPH.

ONLY USE STRUCTURE THAT EXISTS.
DO NOT ASSUME SENTIMENT, CONFIDENCE SCORES, EXPERTISE LEVELS, OR CATEGORIES.

AVAILABLE NODE TYPES:
- User
- Thread
- Post
- Comment
- Report
- Issue
- Solution
- Product
- Source

AVAILABLE RELATIONSHIPS:
- (User)-[:AUTHORED]->(Post|Comment)
- (Post|Comment)-[:IN_THREAD]->(Thread)
- (Thread)-[:FROM_SOURCE]->(Source)
- (Post)-[:AS_REPORT]->(Report)
- (Report)-[:MENTIONS]->(Issue)
- (Comment)-[:PROPOSES]->(Solution)
- (Report)-[:ABOUT_PRODUCT]->(Product)

SUPPORTED QUESTION TYPES:
- "most discussed issues" → count(Report → Issue)
- "threads with most activity" → count(Post/Comment per Thread)
- "products being talked about" → count(Report → Product)
- "solutions proposed" → count(Comment → Solution)
- "compare Dell vs AnandTech" → filter by source

IMPORTANT RULES FOR CYPHER:
- Never assume numeric scores unless they exist
- Use COUNT(), DISTINCT, ORDER BY for ranking
- Use toLower() + CONTAINS for fuzzy matching
- Return aggregates, not raw nodes, for rankings
- If requested data is not in schema, return empty results

IF USER ASKS FOR NON-EXISTENT DATA (e.g. sentiment, severity, trust):
Return:
{
  "cypher": "RETURN 'not_tracked' AS status",
  "expectsResults": false
}
`.trim()
    };

    schemaCache = schema;
    return schema;

  } catch (error) {
    console.error("❌ Error loading schema:", error);
    throw error;
  }
}

export async function initializeSchemaCache() {
  console.log("🔍 Loading Neo4j schema (v1)...");
  const schema = await getSchema();
  console.log(`✅ Schema loaded`);
  console.log(`• Node types: ${schema.nodes.length}`);
  console.log(`• Relationship types: ${schema.relationships.length}`);
  console.log(`• Sources: ${schema.sources.join(", ") || "none"}`);
  console.log(`• Products: ${schema.products.join(", ") || "none"}`);
}

export function closeDriver() {
  return driver.close();
}