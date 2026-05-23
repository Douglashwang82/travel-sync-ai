/**
 * Voice IO for LINE — transcribe inbound audio messages so the rest of the
 * pipeline (parsing, private-chat, slash commands) can treat them as text.
 *
 * Wiring (still TODO in event-processor):
 *   - app/api/line/webhook/route.ts already persists every event including
 *     audio messages (message.type === "audio"). It just doesn't pull the
 *     audio content yet.
 *   - services/event-processor.ts handleMessage() currently bails when
 *     `messageText` is empty. Extend handleMessage to:
 *       1. Detect `message.type === "audio"` from the stored payload
 *       2. Call fetchLineAudio(messageId) → ArrayBuffer
 *       3. Call transcribeAudio(buffer) → string
 *       4. Reuse the transcript as `messageText` from then on
 *
 * This file owns steps 2 and 3 (LINE content fetch + Gemini STT). Step 1
 * and step 4 belong in event-processor.ts — left as a TODO so this scaffold
 * doesn't change webhook behavior until the product is ready to ship voice.
 *
 * Cost note: Gemini 2.5 Flash transcribes audio at the standard input rate
 * but in audio tokens. A 60s LINE voice memo ≈ 1500 audio tokens ≈ $0.0001.
 * Cheap enough to enable globally once tested.
 */

import { GoogleGenAI } from "@google/genai";
import { getModel } from "@/lib/gemini";
import { recordLlmCall } from "@/lib/llm-telemetry";
import { captureError } from "@/lib/monitoring";

const LINE_CONTENT_BASE = "https://api-data.line.me/v2/bot/message";

/**
 * Fetch the binary content of a LINE message (audio, image, video, file).
 * The same access token used to send replies authorizes this download.
 */
export async function fetchLineMessageContent(messageId: string): Promise<{
  buffer: ArrayBuffer;
  mimeType: string;
}> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN not set");

  const res = await fetch(`${LINE_CONTENT_BASE}/${encodeURIComponent(messageId)}/content`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`LINE content fetch failed: ${res.status} ${res.statusText}`);
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  return { buffer: await res.arrayBuffer(), mimeType };
}

/**
 * Transcribe an audio buffer to text using Gemini.
 * Returns the trimmed transcript, or null if Gemini returned nothing usable.
 */
export async function transcribeAudio(
  buffer: ArrayBuffer,
  mimeType: string,
  opts?: { tripId?: string },
): Promise<string | null> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const model = getModel();
  const started = Date.now();
  try {
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: "Transcribe this audio exactly as spoken. No commentary, no formatting." },
            { inlineData: { mimeType, data: Buffer.from(buffer).toString("base64") } },
          ],
        },
      ],
    });
    const text = (response.text ?? "").trim();
    const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: "other",
      tokensIn: usage?.promptTokenCount,
      tokensOut: usage?.candidatesTokenCount,
      latencyMs: Date.now() - started,
      status: "ok",
      tripId: opts?.tripId,
      metadata: { role: "audio_transcription", mime_type: mimeType, bytes: buffer.byteLength },
    });
    return text || null;
  } catch (err) {
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: "other",
      latencyMs: Date.now() - started,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      tripId: opts?.tripId,
      metadata: { role: "audio_transcription", mime_type: mimeType, bytes: buffer.byteLength },
    });
    captureError(err, { context: "transcribe_audio", mime_type: mimeType });
    return null;
  }
}

/**
 * Convenience: LINE messageId → transcript.
 * Returns null on any failure (fetch, transcription, empty result) so
 * callers can fall back to a "couldn't hear that, please type it" reply.
 */
export async function transcribeLineAudio(
  messageId: string,
  opts?: { tripId?: string },
): Promise<string | null> {
  try {
    const { buffer, mimeType } = await fetchLineMessageContent(messageId);
    return await transcribeAudio(buffer, mimeType, opts);
  } catch (err) {
    captureError(err, { context: "transcribe_line_audio", messageId });
    return null;
  }
}
