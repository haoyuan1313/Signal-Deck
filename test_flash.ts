import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
ai.models.generateContent({
  model: "gemini-2.0-flash", // fall back to standard if needed, or check 3-flash
  contents: "Hello",
}).then(res => console.log("Success:", res.text))
  .catch(err => console.error("Error:", JSON.stringify(err, null, 2)));
