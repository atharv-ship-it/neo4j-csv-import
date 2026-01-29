import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
    { disableLosslessIntegers: true }
  );

  try {
    await driver.getServerInfo();
    console.log("✅ Connected to Neo4j");

    /* ===============================
       1. CONSTRAINTS
    =============================== */
    const constraints = [
      "CREATE CONSTRAINT user_unique IF NOT EXISTS FOR (u:User) REQUIRE (u.username, u.source) IS UNIQUE",
      "CREATE CONSTRAINT thread_unique IF NOT EXISTS FOR (t:Thread) REQUIRE t.thread_url IS UNIQUE",
      "CREATE CONSTRAINT source_unique IF NOT EXISTS FOR (s:Source) REQUIRE s.name IS UNIQUE"
    ];

    console.log("Constraints are created..")

    for (const q of constraints) {
      await run(driver, q);
    }

    /* ===============================
       2. SOURCES
    =============================== */
    await run(driver, `
      MERGE (:Source {name: 'dell_forums'})
      MERGE (:Source {name: 'anandtech'})
    `);

    console.log("Sources are created")


    // ===============================
    // USERS — DELL FORUM
    // ===============================
    await run(driver, `
  LOAD CSV WITH HEADERS FROM
  'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/users_dell_forum.csv'
  AS row
  MERGE (u:User {
    username: row.username,
    source: 'dell_forums'
  })
`);
  console.log("Dell Forum users are created")

    // ===============================
    // USERS — ANANDTECH FORUM
    // ===============================
    await run(driver, `
  LOAD CSV WITH HEADERS FROM
  'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/anandtech_users.csv'
  AS row
  MERGE (u:User {
    username: row.username,
    source: 'anandtech'
  })
`);
  console.log("AnandTech users are created")
    // =============
    // THREADS
    // =============

    // DELL THREADS
    await run(driver, `
  LOAD CSV WITH HEADERS FROM
  'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/threads_dell_forum.csv'
  AS row
  MERGE (t:Thread {thread_url: row.thread_url})
  SET t.title = row.thread_title,
      t.type = coalesce(row.thread_type, 'discussion'),
      t.source = 'dell_forums'
`);
  
  console.log("Dell Forum threads are created")

    // ANANDTECH THREADS
    await run(driver, `
  LOAD CSV WITH HEADERS FROM
  'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/anandtech_threads.csv'
  AS row
  MERGE (t:Thread {thread_url: row.thread_url})
  SET t.title = row.thread_title,
      t.type = coalesce(row.thread_type, 'discussion'),
      t.source = 'anandtech'
`);

  console.log("AnandTech threads are created")

    // ==============================
    //  5. POSTS (ORIGINAL POSTS)
    // ==============================

    // DELL FORUM
    await run(driver, `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/posts_dell_forum.csv'
      AS row
      MATCH (u:User {username: row.author, source: 'dell_forums'})
      MATCH (t:Thread {thread_url: row.thread_url})
      CREATE (p:Post {
        text: row.text,
        source: 'dell_forums'
      })
      MERGE (u)-[:AUTHORED]->(p)
      MERGE (p)-[:IN_THREAD]->(t)
    `);
    console.log("Dell Forum posts are created")

    // ANANDTECH
    await run(driver, `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/anandtech_posts.csv'
      AS row
      MATCH (u:User {username: row.author, source: 'anandtech'})
      MATCH (t:Thread {thread_url: row.thread_url})
      CREATE (p:Post {
        text: row.text,
        source: 'anandtech'
      })
      MERGE (u)-[:AUTHORED]->(p)
      MERGE (p)-[:IN_THREAD]->(t)
    `);

    console.log("AnandTech posts are created")

    // ====================
    //  6. COMMENTS
    // ====================

    // DELL FORUM
    await run(driver, `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/comments_dell_forum.csv'
      AS row
      MATCH (u:User {username: row.comment_author, source: 'dell_forums'})
      MATCH (t:Thread {thread_url: row.thread_url})
      CREATE (c:Comment {
        text: row.comment_text,
        source: 'dell_forums'
      })
      MERGE (u)-[:AUTHORED]->(c)
      MERGE (c)-[:IN_THREAD]->(t)
    `);

    console.log("Dell Forum comments are created")

    // ANANDTECH
    await run(driver, `
      LOAD CSV WITH HEADERS FROM
      'https://raw.githubusercontent.com/atharv-ship-it/neo4j-csv-import/refs/heads/main/csv/anandtech_comments.csv'
      AS row
      MATCH (u:User {username: row.comment_author, source: 'anandtech'})
      MATCH (t:Thread {thread_url: row.thread_url})
      CREATE (c:Comment {
        text: row.comment_text,
        source: 'anandtech'
      })
      MERGE (u)-[:AUTHORED]->(c)
      MERGE (c)-[:IN_THREAD]->(t)
    `);
    console.log("AnandTech comments are created")
    /* ===============================
       7. THREAD → SOURCE
    =============================== */
    await run(driver, `
      MATCH (t:Thread)
      MATCH (s:Source {name: t.source})
      MERGE (t)-[:FROM_SOURCE]->(s)
    `);

    console.log("🎉 Raw ingestion complete");

  } catch (err) {
    console.error("❌ Import failed:", err);
  } finally {
    await driver.close();
  }
}

async function run(driver, query) {
  const session = driver.session();
  try {
    return await session.run(query);
  } finally {
    await session.close();
  }
}

main();