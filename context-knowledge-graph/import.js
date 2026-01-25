import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

// ===============================
// MAIN
// ===============================
async function main() {
  const URI = process.env.NEO4J_URI;
  const USER = process.env.NEO4J_USER;
  const PASSWORD = process.env.NEO4J_PASSWORD;

  const driver = neo4j.driver(
    URI,
    neo4j.auth.basic(USER, PASSWORD),
    { disableLosslessIntegers: true }
  );

  try {
    await driver.getServerInfo();
    console.log("✅ Connected to Neo4j Aura");

    // ===============================
    // CONSTRAINTS
    // ===============================
    const constraints = [
      "CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.source_id IS UNIQUE",
      "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.user_id IS UNIQUE",
      "CREATE CONSTRAINT issue_id IF NOT EXISTS FOR (i:Issue) REQUIRE i.issue_id IS UNIQUE",
      "CREATE CONSTRAINT solution_id IF NOT EXISTS FOR (s:Solution) REQUIRE s.solution_id IS UNIQUE",
      "CREATE CONSTRAINT report_id IF NOT EXISTS FOR (r:Report) REQUIRE r.report_id IS UNIQUE",
    ];

    for (const q of constraints) {
      await runQuery(driver, q);
    }
    console.log("✅ Constraints created");

    // ===============================
    // NODES
    // ===============================
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/sources.csv'
      AS row
      MERGE (s:Source {source_id: row.source_id})
      SET s.platform = row.platform,
          s.base_url = row.base_url
      `
    );

    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/users.csv'
      AS row
      MERGE (u:User {user_id: row.user_id})
      SET u.username = row.username,
          u.platform = row.platform
      `
    );

    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/issues.csv'
      AS row
      MERGE (i:Issue {issue_id: row.issue_id})
      SET i.type = row.type,
          i.severity = row.severity,
          i.description = row.description
      `
    );

    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/solutions.csv'
      AS row
      MERGE (s:Solution {solution_id: row.solution_id})
      SET s.type = row.type,
          s.description = row.description
      `
    );

    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/reports.csv'
      AS row
      MERGE (r:Report {report_id: row.report_id})
      SET r.product = row.product,
          r.text = row.text,
          r.platform = row.platform,
          r.sentiment_score = toFloat(row.sentiment_score)
      `
    );

    console.log("✅ Nodes imported");


    // ===============================
    // PRODUCT NODES + LINKS
    // ===============================

    // 1) Create one Product node per distinct product name
    await runQuery(
      driver,
      `
      MATCH (r:Report)
      WITH DISTINCT r.product AS product
      MERGE (p:Product {name: product})
      `
    );

    // 2) Assign categories (Laptop / Desktop / Monitor)
    await runQuery(
      driver,
      `
      MATCH (p:Product)
      WHERE p.name IN [
        "XPS 13", "XPS 13 Plus", "XPS 15", "XPS 17",
        "Alienware m16", "Alienware m18", "Alienware x14",
        "G15", "G16",
        "Inspiron 14", "Inspiron 15", "Inspiron 15 3520", "Inspiron 16",
        "Latitude 5430", "Latitude 7440", "Latitude 9440", "Latitude E7440",
        "Precision 5570", "Precision 7780",
        "Vostro 3501", "Vostro 3520"
      ]
      SET p.category = "Laptop"
      `
    );

    await runQuery(
      driver,
      `
      MATCH (p:Product)
      WHERE p.name IN ["OptiPlex", "OptiPlex 7050", "OptiPlex 7450", "Alienware Aurora"]
      SET p.category = "Desktop"
      `
    );

    await runQuery(
      driver,
      `
      MATCH (p:Product)
      WHERE p.name IN ["UltraSharp U3223QE"]
      SET p.category = "Monitor"
      `
    );

    // 3) Link Reports to their Product
    await runQuery(
      driver,
      `
      MATCH (r:Report)
      MATCH (p:Product {name: r.product})
      MERGE (r)-[:ABOUT_PRODUCT]->(p)
      `
    );

    console.log("✅ Product nodes created, categorized, and linked");

    // ===============================
    // RELATIONSHIPS
    // ===============================
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_authored_by_user_merged.csv'
      AS row
      MATCH (u:User {user_id: row.user_id})
      MATCH (r:Report {report_id: row.report_id})
      MERGE (u)-[:AUTHORED]->(r)
      `
    );

    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_mentions_issue_merged.csv'
      AS row
      MATCH (r:Report {report_id: row.report_id})
      MATCH (i:Issue {issue_id: row.issue_id})
      MERGE (r)-[:MENTIONS]->(i)
      `
    );

    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_published_via_source_merged.csv'
      AS row
      MATCH (r:Report {report_id: row.report_id})
      MATCH (s:Source {source_id: row.source_id})
      MERGE (r)-[:PUBLISHED_VIA]->(s)
      `
    );

    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_suggests_solution.csv'
      AS row
      MATCH (r:Report {report_id: row.report_id})
      MATCH (s:Solution {solution_id: row.solution_id})
      MERGE (r)-[:SUGGESTS]->(s)
      `
    );

    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_confirms_solution_merged.csv'
      AS row
      MATCH (r:Report {report_id: row.report_id})
      MATCH (s:Solution {solution_id: row.solution_id})
      MERGE (r)-[:CONFIRMS]->(s)
      `
    );

    console.log("✅ Relationships imported");
    console.log("🎉 Import completed successfully");

  } catch (err) {
    console.error("❌ Import failed:", err);
  } finally {
    await driver.close();
  }
}

// ===============================
// HELPERS
// ===============================
async function runQuery(driver, query, params = {}) {
  const session = driver.session();
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
}

main();