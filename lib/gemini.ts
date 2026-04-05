import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return _client;
}

const MODEL = "gemini-2.0-flash";

/**
 * Call Gemini with a system prompt and user message, expecting a JSON response.
 * Returns the parsed object or throws on failure.
 */
export async function generateJson<T>(
  systemPrompt: string,
  userMessage: string
): Promise<T> {
  const client = getClient();
  console.log(`[gemini] calling ${MODEL} with JSON output...`);
  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    console.log(`[gemini] raw response length: ${text?.length ?? 0}`);
    if (!text) throw new Error("Gemini returned empty response");

    return JSON.parse(text) as T;
  } catch (err) {
    console.error(`[gemini] API call failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * Call Gemini with a system prompt and user message, expecting a plain text response.
 */
export async function generateText(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const client = getClient();

  const response = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    config: { systemInstruction: systemPrompt },
  });

  return response.text ?? "";
}
