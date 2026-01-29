import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
    { disableLosslessIntegers: true }
  );

  const session = driver.session();

  try {
    console.log("🧠 Building dynamic KG intelligence (v1)");

    /* ======================================================
       1. POSTS → REPORTS
       Any sufficiently long post becomes a report
    ====================================================== */
    await session.run(`
      MATCH (p:Post)
      WHERE size(p.text) > 150
      MERGE (r:Report {id: 'rep_' + id(p)})
      SET r.content = p.text,
          r.source = p.source
      MERGE (p)-[:AS_REPORT]->(r)
    `);

    /* ======================================================
       2. ISSUE CREATION (FREQUENCY-BASED)
       If multiple reports occur in the same thread,
       they represent the same underlying issue
    ====================================================== */
    await session.run(`
      MATCH (t:Thread)<-[:IN_THREAD]-(p:Post)-[:AS_REPORT]->(r:Report)
      WITH t, collect(r) AS reports
      WHERE size(reports) >= 2
      MERGE (i:Issue {id: 'iss_' + id(t)})
      SET i.source = t.source,
          i.report_count = size(reports)
      FOREACH (rep IN reports |
        MERGE (rep)-[:MENTIONS]->(i)
      )
    `);

    /* ======================================================
       3. SOLUTION CREATION (REPLY-DERIVED)
       Any comment replying in a thread with an issue
       is treated as a candidate solution
    ====================================================== */
    await session.run(`
      MATCH (i:Issue)<-[:MENTIONS]-(:Report)<-[:AS_REPORT]-(p:Post)-[:IN_THREAD]->(t:Thread)
      MATCH (c:Comment)-[:IN_THREAD]->(t)
      MERGE (s:Solution {id: 'sol_' + id(c)})
      SET s.content = c.text,
          s.source = c.source
      MERGE (c)-[:PROPOSES]->(s)
    `);

    /* ======================================================
       4. CONFIRMATIONS (PURELY STRUCTURAL)
       Multiple comments proposing the same solution
       → higher confidence
    ====================================================== */
    await session.run(`
      MATCH (s:Solution)<-[:PROPOSES]-(:Comment)
      WITH s, count(*) AS confirmations
      SET s.confirmation_count = confirmations
    `);

    /* ======================================================
       5. PRODUCT INFERENCE (CO-OCCURRENCE, NOT NAMES)
       Threads that repeatedly share vocabulary
       form a product/context node
    ====================================================== */
    await session.run(`
      MATCH (t:Thread)<-[:IN_THREAD]-(p:Post)
      WITH t, count(p) AS activity
      WHERE activity >= 3
      MERGE (pr:Product {id: 'prod_' + id(t)})
      SET pr.source = t.source,
          pr.activity = activity
      MERGE (t)-[:ABOUT_PRODUCT]->(pr)
    `);

    /* ======================================================
       6. USER EXPERTISE (GRAPH-BASED)
       Expertise emerges from participation + solutions
    ====================================================== */
    await session.run(`
      MATCH (u:User)-[:AUTHORED]->(n)
      OPTIONAL MATCH (n)-[:PROPOSES]->(:Solution)
      WITH u, count(n) AS contributions, count(*) AS solutions
      SET u.expertise_score = contributions + solutions * 2
    `);

    console.log("✅ Dynamic KG intelligence built successfully");

  } catch (err) {
    console.error("❌ KG build failed:", err);
  } finally {
    await session.close();
    await driver.close();
  }
}

main();