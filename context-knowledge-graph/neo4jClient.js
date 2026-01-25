// neo4jClient.js
import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

// Basic env validation (warning only, won’t crash)
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
 * Run a read/write Cypher query
 */
export async function runCypher(query, params = {}) {
  const session = driver.session();
  try {
    const result = await session.run(query, params);
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
    const result = await session.executeRead((tx) => tx.run(query, params));
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
