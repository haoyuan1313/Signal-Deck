import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    const res = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: "Hello",
    });
    console.log("Success 1:", res.text);
  } catch (err: any) {
    console.error("Error 1:", err.message);
  }
}
run();
