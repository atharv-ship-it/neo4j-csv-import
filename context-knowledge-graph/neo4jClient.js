// neo4jClient.js
import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

// Basic env validation (warning only, won't crash)
["NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD"].forEach((key) => {
  if (!process.env[key]) {
    console.warn(`⚠️ Missing env var ${key} for Neo4j connection`);
  }
});

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(
    process.env.NEO4J_USER,
    process.env.NEO4J_PASSWORD
  ),
  { disableLosslessIntegers: true }
);

/**
 * Convert JavaScript types to Neo4j types
 */
function convertToNeo4jTypes(params) {
  const converted = {};
  
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' && Number.isInteger(value)) {
      // Convert integers to Neo4j int type
      converted[key] = neo4j.int(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively convert nested objects
      converted[key] = convertToNeo4jTypes(value);
    } else {
      converted[key] = value;
    }
  }
  
  return converted;
}

/**
 * Run a read/write Cypher query
 */
export async function runCypher(query, params = {}) {
  const session = driver.session();
  try {
    // Convert params to Neo4j types
    const neo4jParams = convertToNeo4jTypes(params);
    
    const result = await session.run(query, neo4jParams);
    return result.records.map((record) => record.toObject());
  } finally {
    await session.close();
  }
}

/**
 * Run a read‑only Cypher query
 */
export async function runCypherReadOnly(query, params = {}) {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    // Convert params to Neo4j types
    const neo4jParams = convertToNeo4jTypes(params);
    
    const result = await session.executeRead((tx) => tx.run(query, neo4jParams));
    return result.records.map((record) => record.toObject());
  } finally {
    await session.close();
  }
}

/**
 * Close the Neo4j driver (for graceful shutdown)
 */
export async function closeDriver() {
  await driver.close();
}
