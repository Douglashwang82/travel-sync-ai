import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return _client;
}

const MODEL = "gemini-2.0-flash";

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
// Prevents hammering a degraded Gemini API. State resets on cold start, which
// is acceptable — the worst case is one extra API call per new serverless
// instance when the circuit is open.

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const FAILURE_THRESHOLD = 3;    // consecutive failures before opening
const RECOVERY_TIMEOUT_MS = 60_000; // 60s before trying again

const circuit = {
  state: "CLOSED" as CircuitState,
  failureCount: 0,
  lastFailureAt: 0,
};

function recordSuccess(): void {
  circuit.state = "CLOSED";
  circuit.failureCount = 0;
}

function recordFailure(): void {
  circuit.failureCount++;
  circuit.lastFailureAt = Date.now();
  if (circuit.failureCount >= FAILURE_THRESHOLD) {
    circuit.state = "OPEN";
    console.warn(`[gemini] Circuit OPEN after ${circuit.failureCount} consecutive failures`);
  }
}

function isCircuitAllowing(): boolean {
  if (circuit.state === "CLOSED") return true;

  if (circuit.state === "OPEN") {
    const elapsed = Date.now() - circuit.lastFailureAt;
    if (elapsed >= RECOVERY_TIMEOUT_MS) {
      circuit.state = "HALF_OPEN";
      console.info("[gemini] Circuit HALF_OPEN — allowing one probe request");
      return true;
    }
    return false;
  }

  // HALF_OPEN: allow the single probe through
  return true;
}

// ─── Exported error class ─────────────────────────────────────────────────────

export class GeminiUnavailableError extends Error {
  constructor(message = "Gemini API is temporarily unavailable") {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

// ─── API wrappers ─────────────────────────────────────────────────────────────

/**
 * Call Gemini with a system prompt and user message, expecting a JSON response.
 * Returns the parsed object or throws on failure.
 * Throws GeminiUnavailableError when the circuit breaker is open.
 */
export async function generateJson<T>(
  systemPrompt: string,
  userMessage: string
): Promise<T> {
  if (!isCircuitAllowing()) {
    throw new GeminiUnavailableError(
      `Gemini circuit breaker is OPEN — skipping call (retry in ${Math.ceil((RECOVERY_TIMEOUT_MS - (Date.now() - circuit.lastFailureAt)) / 1000)}s)`
    );
  }

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

    const parsed = JSON.parse(text) as T;
    recordSuccess();
    return parsed;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) throw err;
    recordFailure();
    console.error(`[gemini] API call failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * Call Gemini with a system prompt and user message, expecting a plain text response.
 * Throws GeminiUnavailableError when the circuit breaker is open.
 */
export async function generateText(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  if (!isCircuitAllowing()) {
    throw new GeminiUnavailableError(
      `Gemini circuit breaker is OPEN — skipping call`
    );
  }

  const client = getClient();
  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      config: { systemInstruction: systemPrompt },
    });
    const text = response.text ?? "";
    recordSuccess();
    return text;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) throw err;
    recordFailure();
    console.error(`[gemini] text API call failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

export type ConversationMessage = { role: "user" | "agent"; content: string };

/**
 * Call Gemini with a full conversation history for multi-turn chat.
 * Maps 'agent' role to 'model' for the Gemini API.
 * Throws GeminiUnavailableError when the circuit breaker is open.
 */
export async function generateConversation(
  systemPrompt: string,
  history: ConversationMessage[],
  newMessage: string
): Promise<string> {
  if (!isCircuitAllowing()) {
    throw new GeminiUnavailableError(
      `Gemini circuit breaker is OPEN — skipping call`
    );
  }

  const client = getClient();
  const contents = [
    ...history.map((msg) => ({
      role: msg.role === "agent" ? "model" : "user",
      parts: [{ text: msg.content }],
    })),
    { role: "user", parts: [{ text: newMessage }] },
  ];

  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents,
      config: { systemInstruction: systemPrompt },
    });
    const text = response.text ?? "";
    recordSuccess();
    return text;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) throw err;
    recordFailure();
    console.error(`[gemini] conversation API call failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
