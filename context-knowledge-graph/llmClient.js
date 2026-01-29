// llmClient.js
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function callLLM(prompt, options = {}) {
  try {
    const response = await openai.chat.completions.create({
      model: options.model || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a Neo4j expert. Generate queries using only the provided schema. Never invent properties or relationships."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: options.temperature || 0.1,
      max_tokens: options.max_tokens || 1000,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("❌ LLM failed:", error.message);
    throw error;
  }
}
