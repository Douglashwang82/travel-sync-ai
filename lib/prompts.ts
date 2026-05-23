/**
 * Prompt registry — loads versioned system prompts from prompts/*.md.
 *
 * Each prompt file has YAML-ish frontmatter:
 *   ---
 *   id: orchestrator.system
 *   version: 1
 *   owner: dougl
 *   task_class: orchestrator
 *   ---
 *
 * Body supports {{placeholder}} substitution via renderPrompt(). Hash is the
 * sha256 of the raw body (pre-render), captured per-call into llm_calls so a
 * prompt change is replayable.
 *
 * Loads happen synchronously at startup; prompts are cached in-process. The
 * loader is a no-op if the prompts/ directory is absent (e.g. some bundling
 * paths) — callers that opt in are responsible for handling that case.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

export interface PromptFile {
  id: string;
  version: number;
  owner?: string;
  taskClass?: string;
  body: string;
  hash: string;
  path: string;
}

let _cache: Map<string, PromptFile> | null = null;

function promptsRoot(): string {
  return join(process.cwd(), "prompts");
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const m = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+?)\s*$/i);
    if (m) meta[m[1]!] = m[2]!;
  }
  return { meta, body: (match[2] ?? "").trim() };
}

function walkMd(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    let stat;
    try {
      stat = statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkMd(p, out);
    else if (entry.endsWith(".md") && entry.toLowerCase() !== "readme.md") out.push(p);
  }
  return out;
}

function loadAll(): Map<string, PromptFile> {
  if (_cache) return _cache;
  const cache = new Map<string, PromptFile>();
  const root = promptsRoot();
  for (const file of walkMd(root)) {
    const raw = readFileSync(file, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    if (!meta.id) continue;
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    cache.set(meta.id, {
      id: meta.id,
      version: meta.version ? Number(meta.version) : 1,
      owner: meta.owner,
      taskClass: meta.task_class ?? meta.taskClass,
      body,
      hash,
      path: relative(process.cwd(), file).replace(/\\/g, "/"),
    });
  }
  _cache = cache;
  return cache;
}

export function loadPrompt(id: string): PromptFile {
  const cache = loadAll();
  const p = cache.get(id);
  if (!p) throw new Error(`Prompt not found in registry: ${id}`);
  return p;
}

export function tryLoadPrompt(id: string): PromptFile | null {
  return loadAll().get(id) ?? null;
}

export function listPrompts(): PromptFile[] {
  return Array.from(loadAll().values());
}

export function renderPrompt(prompt: PromptFile, vars: Record<string, string>): string {
  return prompt.body.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(`renderPrompt: missing placeholder "${key}" for prompt ${prompt.id}`);
    }
    return vars[key]!;
  });
}

/** Test-only: invalidate the in-process cache. */
export function _resetPromptCache(): void {
  _cache = null;
}
