import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

function run(modelName: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  ai.models.generateContent({
    model: modelName,
    contents: "Hello",
  }).then(res => {
    console.log(modelName, "Success 2:", res.text);
  }).catch(err => {
    console.error(modelName, "Error 2:", err.message);
  });
}
run("gemini-3.1-pro-preview");
run("gemini-3.0-pro-preview");
run("gemini-1.5-pro");
run("gemini-2.5-pro");
