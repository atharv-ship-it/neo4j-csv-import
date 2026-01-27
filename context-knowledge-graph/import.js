import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

// ===============================
// NEO4J AURA IMPORT SCRIPT (CORRECTED)
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
    // STEP 1: CREATE CONSTRAINTS
    // ===============================
    console.log("\n🔒 Creating uniqueness constraints...");

    const constraints = [
      "CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.source_id IS UNIQUE",
      "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.user_id IS UNIQUE",
      "CREATE CONSTRAINT issue_id IF NOT EXISTS FOR (i:Issue) REQUIRE i.issue_id IS UNIQUE",
      "CREATE CONSTRAINT solution_id IF NOT EXISTS FOR (s:Solution) REQUIRE s.solution_id IS UNIQUE",
      "CREATE CONSTRAINT report_id IF NOT EXISTS FOR (r:Report) REQUIRE r.report_id IS UNIQUE",
      "CREATE CONSTRAINT product_name IF NOT EXISTS FOR (p:Product) REQUIRE p.name IS UNIQUE"
    ];

    for (const q of constraints) {
      await runQuery(driver, q);
    }
    console.log(" ✓ Constraints created");

    // ===============================
    // STEP 2: IMPORT NODES
    // ===============================
    console.log("\n📦 Importing nodes...");

    // Sources
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/sources.csv'
      AS row
      MERGE (s:Source {source_id: row.source_id})
      SET s.source_name = row.source_name,
          s.source_url = row.source_url,
          s.source_type = row.source_type,
          s.independence_weight = toFloat(row.independence_weight)
      `
    );
    console.log(" ✓ Sources imported");

    // Users
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/users.csv'
      AS row
      MERGE (u:User {user_id: row.user_id})
      SET u.username = row.username,
          u.user_expertise_level = row.user_expertise_level
      `
    );
    console.log(" ✓ Users imported");

    // Issues
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/issues.csv'
      AS row
      MERGE (i:Issue {issue_id: row.issue_id})
      SET i.issue_title = row.issue_title,
          i.issue_description = row.issue_description,
          i.category = row.category,
          i.affected_models = row.affected_models,
          i.first_seen_timestamp = datetime(replace(row.first_seen_timestamp, ' ', 'T')),
          i.last_seen_timestamp = datetime(replace(row.last_seen_timestamp, ' ', 'T'))
      `
    );
    console.log(" ✓ Issues imported");

    // Solutions
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/solutions.csv'
      AS row
      MERGE (s:Solution {solution_id: row.solution_id})
      SET s.solution_title = row.solution_title,
          s.solution_description = row.solution_description,
          s.solution_effectiveness_score = toFloat(row.solution_effectiveness_score),
          s.solution_type = row.solution_type,
          s.category = row.category
      `
    );
    console.log(" ✓ Solutions imported");

    // Reports
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/reports.csv'
      AS row
      MERGE (r:Report {report_id: row.report_id})
      SET r.report_content = row.report_content,
          r.report_title = row.report_title,
          r.timestamp = datetime(replace(row.timestamp, ' ', 'T')),
          r.confidence_score = toFloat(row.confidence_score),
          r.issue_context = row.issue_context
      `
    );
    console.log(" ✓ Reports imported");

    // ===============================
    // STEP 3: CREATE PRODUCT NODES
    // ===============================
    console.log("\n🏷️  Creating Product nodes...");

    // Extract unique products from issues.affected_models
    await runQuery(
      driver,
      `
      MATCH (i:Issue)
      WITH i, split(i.affected_models, ',') AS models
      UNWIND models AS model
      WITH DISTINCT trim(model) AS product_name
      WHERE product_name <> ''
      MERGE (p:Product {name: product_name})
      `
    );

    // Categorize products
    await runQuery(
      driver,
      `
      MATCH (p:Product)
      WHERE p.name CONTAINS 'XPS' OR p.name CONTAINS 'Inspiron' OR
            p.name CONTAINS 'Latitude' OR p.name CONTAINS 'G15' OR
            p.name CONTAINS 'Alienware' OR p.name CONTAINS 'Precision' OR
            p.name CONTAINS 'Vostro'
      SET p.category = 'Laptop'
      `
    );

    await runQuery(
      driver,
      `
      MATCH (p:Product)
      WHERE p.name CONTAINS 'OptiPlex' OR p.name CONTAINS 'Aurora'
      SET p.category = 'Desktop'
      `
    );

    await runQuery(
      driver,
      `
      MATCH (p:Product)
      WHERE p.name CONTAINS 'UltraSharp' OR p.name CONTAINS 'Monitor'
      SET p.category = 'Monitor'
      `
    );

    console.log(" ✓ Products created and categorized");

    // ===============================
    // STEP 4: CREATE RELATIONSHIPS
    // ===============================
    console.log("\n🔗 Creating relationships...");

    // User → Report (AUTHORED)
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
    console.log(" ✓ AUTHORED relationships created");

    // Report → Issue (MENTIONS)
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_mentions_issue_merged.csv'
      AS row
      MATCH (r:Report {report_id: row.report_id})
      MATCH (i:Issue {issue_id: row.issue_id})
      MERGE (r)-[m:MENTIONS]->(i)
      SET m.evidence_strength = toFloat(row.evidence_strength),
          m.certainty_level = row.certainty_level
      `
    );
    console.log(" ✓ MENTIONS relationships created");

    // Report → Source (PUBLISHED_VIA)
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_published_via_source_merged.csv'
      AS row
      MATCH (r:Report {report_id: row.report_id})
      MATCH (s:Source {source_id: row.source_id})
      MERGE (r)-[p:PUBLISHED_VIA]->(s)
      SET p.source_reliability_score = toFloat(row.source_reliability_score)
      `
    );
    console.log(" ✓ PUBLISHED_VIA relationships created");

    // Report → Solution (SUGGESTS)
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_suggests_solution.csv'
      AS row
      MATCH (r:Report {report_id: row.report_id})
      MATCH (s:Solution {solution_id: row.solution_id})
      MERGE (r)-[sg:SUGGESTS]->(s)
      SET sg.suggestion_confidence = toFloat(row.suggestion_confidence),
          sg.is_experimental = toBoolean(row.is_experimental)
      `
    );
    console.log(" ✓ SUGGESTS relationships created");

    // Report → Solution (CONFIRMS)
    await runQuery(
      driver,
      `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/report_confirms_solution_merged.csv'
      AS row
      MATCH (r:Report {report_id: row.report_id})
      MATCH (s:Solution {solution_id: row.solution_id})
      MERGE (r)-[c:CONFIRMS]->(s)
      SET c.confirmation_strength = toFloat(row.confirmation_strength),
          c.post_fix_outcome = row.post_fix_outcome,
          c.confirmed_at_timestamp = datetime(replace(row.confirmed_at_timestamp, ' ', 'T'))
      `
    );
    console.log(" ✓ CONFIRMS relationships created");

    // Issue → Product (AFFECTS)
    await runQuery(
      driver,
      `
      MATCH (i:Issue)
      WITH i, split(i.affected_models, ',') AS models
      UNWIND models AS model
      WITH i, trim(model) AS product_name
      MATCH (p:Product {name: product_name})
      MERGE (i)-[:AFFECTS]->(p)
      `
    );
    console.log(" ✓ AFFECTS relationships created");

    // Report → Product (ABOUT_PRODUCT)
    await runQuery(
      driver,
      `
      MATCH (r:Report)-[:MENTIONS]->(i:Issue)-[:AFFECTS]->(p:Product)
      WITH r, p, count(DISTINCT i) AS issue_count
      MERGE (r)-[a:ABOUT_PRODUCT]->(p)
      SET a.issue_count = issue_count
      `
    );
    console.log(" ✓ ABOUT_PRODUCT relationships created");

    // ===============================
    // STEP 5: CREATE INDEXES
    // ===============================
    console.log("\n🧠 Creating performance indexes...");

    await runQuery(driver, "CREATE INDEX report_timestamp IF NOT EXISTS FOR (r:Report) ON (r.timestamp)");
    await runQuery(driver, "CREATE INDEX issue_first_seen IF NOT EXISTS FOR (i:Issue) ON (i.first_seen_timestamp)");
    await runQuery(driver, "CREATE INDEX issue_last_seen IF NOT EXISTS FOR (i:Issue) ON (i.last_seen_timestamp)");
    await runQuery(driver, "CREATE INDEX report_confidence IF NOT EXISTS FOR (r:Report) ON (r.confidence_score)");
    await runQuery(driver, "CREATE INDEX solution_effectiveness IF NOT EXISTS FOR (s:Solution) ON (s.solution_effectiveness_score)");

    console.log(" ✓ Indexes created");

    // ===============================
    // STEP 6: VALIDATION
    // ===============================
    console.log("\n✅ Running validation checks...");

    const stats = await runQuery(driver, `
      MATCH (r:Report) WITH count(r) AS reports
      MATCH (i:Issue) WITH reports, count(i) AS issues
      MATCH (s:Solution) WITH reports, issues, count(s) AS solutions
      MATCH (u:User) WITH reports, issues, solutions, count(u) AS users
      MATCH (src:Source) WITH reports, issues, solutions, users, count(src) AS sources
      MATCH (p:Product) WITH reports, issues, solutions, users, sources, count(p) AS products
      RETURN reports, issues, solutions, users, sources, products
    `);

    const counts = stats.records[0].toObject();
    console.log("\n📊 Node Statistics:");
    console.log(`   • Reports: ${counts.reports}`);
    console.log(`   • Issues: ${counts.issues}`);
    console.log(`   • Solutions: ${counts.solutions}`);
    console.log(`   • Users: ${counts.users}`);
    console.log(`   • Sources: ${counts.sources}`);
    console.log(`   • Products: ${counts.products}`);
    console.log(`   • TOTAL: ${counts.reports + counts.issues + counts.solutions + counts.users + counts.sources + counts.products}`);

    const relStats = await runQuery(driver, `
      MATCH ()-[r:MENTIONS]->() WITH count(r) AS mentions
      MATCH ()-[r:SUGGESTS]->() WITH mentions, count(r) AS suggests
      MATCH ()-[r:CONFIRMS]->() WITH mentions, suggests, count(r) AS confirms
      MATCH ()-[r:AUTHORED]->() WITH mentions, suggests, confirms, count(r) AS authored
      MATCH ()-[r:PUBLISHED_VIA]->() WITH mentions, suggests, confirms, authored, count(r) AS published
      MATCH ()-[r:ABOUT_PRODUCT]->() WITH mentions, suggests, confirms, authored, published, count(r) AS about
      MATCH ()-[r:AFFECTS]->() WITH mentions, suggests, confirms, authored, published, about, count(r) AS affects
      RETURN mentions, suggests, confirms, authored, published, about, affects
    `);

    const relCounts = relStats.records[0].toObject();
    console.log("\n🔗 Relationship Statistics:");
    console.log(`   • AUTHORED: ${relCounts.authored}`);
    console.log(`   • PUBLISHED_VIA: ${relCounts.published}`);
    console.log(`   • MENTIONS: ${relCounts.mentions}`);
    console.log(`   • CONFIRMS: ${relCounts.confirms}`);
    console.log(`   • SUGGESTS: ${relCounts.suggests}`);
    console.log(`   • AFFECTS: ${relCounts.affects}`);
    console.log(`   • ABOUT_PRODUCT: ${relCounts.about}`);
    console.log(`   • TOTAL: ${relCounts.authored + relCounts.published + relCounts.mentions + relCounts.confirms + relCounts.suggests + relCounts.affects + relCounts.about}`);

    console.log("\n🎉 Import completed successfully!");
    console.log("\n🧠 Knowledge Graph Intelligence Features:");
    console.log("   ✓ Temporal tracking (first_seen, last_seen, confirmed_at)");
    console.log("   ✓ Confidence scoring (report credibility from source + expertise)");
    console.log("   ✓ Solution effectiveness tracking (scores + outcomes)");
    console.log("   ✓ Source credibility (reliability, independence weights)");
    console.log("   ✓ User expertise modeling (novice → expert)");
    console.log("   ✓ Multi-hop intelligence paths for complex queries");

  } catch (err) {
    console.error("❌ Import failed:", err);
    throw err;
  } finally {
    await driver.close();
  }
}

// ===============================
// HELPER FUNCTION
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