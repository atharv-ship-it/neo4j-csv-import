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
    const { question } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        error: "Invalid request. Please provide a question.",
      });
    }

    console.log(`[${new Date().toISOString()}] Query: "${question}"`);
    const result = await answerUserQuery(question);

    if (result.error) {
      return res.status(400).json(result);
    }

    res.json({
      answer: result.answer,
      cypher: result.cypher,
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
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 API endpoint: http://localhost:${PORT}/api/query`);

  await initializeSchemaCache();
  isServerReady = true;
  console.log(`🚀 Server ready to accept queries`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Shutting down server...");
  await closeDriver();
  process.exit(0);
});
