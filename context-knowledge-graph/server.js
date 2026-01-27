// server.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { answerUserQuery } from "./queryUnderstanding.js";
import { initializeSchemaCache } from "./schemaMetadata.js";
import { closeDriver } from "./neo4jClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Track initialization state
let isServerReady = false;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Readiness check endpoint
app.get("/api/ready", (req, res) => {
  res.json({ ready: isServerReady });
});

// API endpoint
app.post("/api/query", async (req, res) => {
  if (!isServerReady) {
    return res.status(503).json({
      error: "Server is still initializing. Please wait a moment.",
    });
  }
  
  try {
    const { question, conversationHistory = [] } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        error: "Invalid request. Please provide a question.",
      });
    }

    // Trim history to last 10 messages and sanitize
    const trimmedHistory = conversationHistory
      .slice(-10)
      .filter(msg => msg.role && msg.content)
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: String(msg.content).slice(0, 500) // Cap each message to 500 chars
      }));

    console.log(`[${new Date().toISOString()}] Query: "${question}" (history: ${trimmedHistory.length} msgs)`);
    const result = await answerUserQuery(question, trimmedHistory);

    if (result.error) {
      return res.status(400).json(result);
    }

    res.json({
      answer: result.answer,
      cypher: result.cypher,
      intent: result.intent,
      method: result.method,
      confidence: result.confidence,
      rowCount: result.data?.length ?? 0,
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      error: "An unexpected error occurred. Please try again later.",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    ready: isServerReady
  });
});

// Serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 API endpoint: http://localhost:${PORT}/api/query`);
  console.log(`\n🔄 Initializing knowledge graph...`);

  try {
    await initializeSchemaCache();
    isServerReady = true;
    console.log(`\n🚀 Server ready to accept queries`);
    console.log(`\n🧠 Intelligence Features:`);
    console.log(`  • Multi-hop graph traversal`);
    console.log(`  • Confidence-weighted scoring`);
    console.log(`  • Evidence strength tracking`);
    console.log(`  • Solution outcome verification`);
    console.log(`  • Temporal trend analysis`);
    console.log(`  • Source credibility weighting`);
    console.log(`  • User expertise modeling`);
  } catch (error) {
    console.error("❌ Failed to initialize schema:", error);
    console.error("Server will not accept queries until this is resolved.");
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");
  await closeDriver();
  process.exit(0);
});