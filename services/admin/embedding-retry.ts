import { generateEmbedding } from "@/lib/gemini";

const DEFAULT_MIN_CALL_GAP_MS = 300;
const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const CIRCUIT_RECOVERY_MS = 60_000;
const JITTER_MS = 250;

let nextEmbeddingCallAt = 0;

interface EmbeddingRetryOptions {
  label?: string;
  maxAttempts?: number;
  minCallGapMs?: number;
}

export async function generateEmbeddingWithRetry(
  text: string,
  opts: EmbeddingRetryOptions = {},
): Promise<number[]> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const minCallGapMs = opts.minCallGapMs ?? DEFAULT_MIN_CALL_GAP_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitForEmbeddingSlot(minCallGapMs);
    try {
      return await generateEmbedding(text);
    } catch (err) {
      if (!isRetryableEmbeddingError(err) || attempt === maxAttempts) throw err;

      const retryDelayMs = isCircuitOpenError(err)
        ? CIRCUIT_RECOVERY_MS
        : retryInfoDelay(err) ?? exponentialBackoff(attempt);
      const jitterMs = Math.floor(Math.random() * JITTER_MS);
      const waitMs = Math.min(retryDelayMs + jitterMs, MAX_BACKOFF_MS);
      const label = opts.label ? ` for ${opts.label}` : "";
      const reason = isCircuitOpenError(err) ? "circuit open" : "429";
      console.warn(
        `[embedding] ${reason}${label}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxAttempts})`,
      );
      await sleep(waitMs);
    }
  }

  throw new Error("Embedding retry loop exhausted unexpectedly");
}

async function waitForEmbeddingSlot(minCallGapMs: number): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, nextEmbeddingCallAt - now);
  if (waitMs > 0) await sleep(waitMs);
  nextEmbeddingCallAt = Math.max(Date.now(), nextEmbeddingCallAt) + minCallGapMs;
}

function exponentialBackoff(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

function isRetryableEmbeddingError(err: unknown): boolean {
  return isRateLimitError(err) || isCircuitOpenError(err);
}

function isRateLimitError(err: unknown): boolean {
  const record = asRecord(err);
  if (record?.status === 429 || record?.code === 429) return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('"code":429') || message.includes("RESOURCE_EXHAUSTED");
}

function isCircuitOpenError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("circuit breaker is OPEN");
}

function retryInfoDelay(err: unknown): number | null {
  const candidates: unknown[] = [err];
  const message = err instanceof Error ? err.message : null;
  if (message) {
    try {
      candidates.push(JSON.parse(message));
    } catch {
      // Not every SDK error message is JSON.
    }
  }

  for (const candidate of candidates) {
    const delay = findRetryDelay(candidate);
    if (delay != null) return delay;
  }
  return null;
}

function findRetryDelay(value: unknown, depth = 0): number | null {
  if (depth > 5) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const delay = findRetryDelay(item, depth + 1);
      if (delay != null) return delay;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  const type = typeof record["@type"] === "string" ? record["@type"] : "";
  if (type.includes("RetryInfo") && "retryDelay" in record) {
    return parseRetryDelay(record.retryDelay);
  }

  if ("retryInfo" in record) {
    const delay = findRetryDelay(record.retryInfo, depth + 1);
    if (delay != null) return delay;
  }

  if ("retryDelay" in record) {
    const delay = parseRetryDelay(record.retryDelay);
    if (delay != null) return delay;
  }

  for (const item of Object.values(record)) {
    const delay = findRetryDelay(item, depth + 1);
    if (delay != null) return delay;
  }
  return null;
}

function parseRetryDelay(value: unknown): number | null {
  if (typeof value === "string") {
    const match = value.match(/^(\d+(?:\.\d+)?)s$/);
    return match ? Math.ceil(Number(match[1]) * 1_000) : null;
  }

  const record = asRecord(value);
  if (!record) return null;

  const seconds = numericValue(record.seconds);
  const nanos = numericValue(record.nanos);
  if (seconds == null && nanos == null) return null;
  return Math.ceil((seconds ?? 0) * 1_000 + (nanos ?? 0) / 1_000_000);
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
