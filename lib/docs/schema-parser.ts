import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";

export interface SchemaColumn {
  name: string;
  type: string;
  modifiers: string[];
  /** Migration filename that introduced (or last touched) this column. */
  introducedIn: string;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  /** Migration that originally created the table. */
  createdIn: string;
}

const TABLE_LEVEL_KEYWORDS = new Set([
  "primary",
  "unique",
  "foreign",
  "check",
  "constraint",
  "exclude",
  "like",
]);

/** Split a parenthesised CREATE TABLE body into top-level comma-delimited clauses. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

function parseColumn(clause: string, sourceFile: string): SchemaColumn | null {
  const trimmed = clause.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  if (TABLE_LEVEL_KEYWORDS.has(firstWord)) return null;

  // Column: name TYPE rest...
  // TYPE may include parens: numeric(10, 2), varchar(255)
  const tokens = trimmed.split(" ");
  const name = tokens[0].replace(/^"|"$/g, "");
  let i = 1;
  let type = tokens[i] ?? "";
  i++;
  // If type ends with `(` opener and isn't balanced, keep absorbing tokens.
  let openParens = (type.match(/\(/g) ?? []).length - (type.match(/\)/g) ?? []).length;
  while (openParens > 0 && i < tokens.length) {
    type += " " + tokens[i];
    openParens += (tokens[i].match(/\(/g) ?? []).length - (tokens[i].match(/\)/g) ?? []).length;
    i++;
  }
  const rest = tokens.slice(i).join(" ");
  const modifiers: string[] = [];
  const restLower = rest.toLowerCase();
  if (/\bprimary key\b/.test(restLower)) modifiers.push("PK");
  if (/\bnot null\b/.test(restLower)) modifiers.push("NOT NULL");
  if (/\bunique\b/.test(restLower)) modifiers.push("UNIQUE");
  const refMatch = rest.match(/references\s+([a-zA-Z_][\w]*)/i);
  if (refMatch) modifiers.push(`→ ${refMatch[1]}`);
  const defaultMatch = rest.match(/default\s+(.+?)(?=(?:\s+(?:not null|unique|references|check)\b)|$)/i);
  if (defaultMatch) modifiers.push(`default ${defaultMatch[1].trim()}`);
  return { name, type, modifiers, introducedIn: sourceFile };
}

function findCreateTables(sql: string, sourceFile: string, tables: Map<string, SchemaTable>): void {
  // Match: create table [if not exists] [public.]name ( ... );
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(?:"?)([a-zA-Z_][\w]*)(?:"?)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const tableName = match[1];
    // Find balanced parens starting at the next char after the matched `(`.
    let depth = 1;
    const start = re.lastIndex; // position right after the `(`
    let i = start;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    if (depth !== 0) continue;
    const body = sql.slice(start, i - 1); // exclude the closing `)`
    const columns: SchemaColumn[] = [];
    for (const clause of splitTopLevel(body)) {
      const col = parseColumn(clause, sourceFile);
      if (col) columns.push(col);
    }
    if (!tables.has(tableName)) {
      tables.set(tableName, { name: tableName, columns, createdIn: sourceFile });
    } else {
      // Merge: later CREATE for the same name (rare) appends missing columns.
      const existing = tables.get(tableName)!;
      const existingNames = new Set(existing.columns.map((c) => c.name));
      for (const c of columns) {
        if (!existingNames.has(c.name)) existing.columns.push(c);
      }
    }
  }
}

function findAlterAddColumns(sql: string, sourceFile: string, tables: Map<string, SchemaTable>): void {
  // alter table [if exists] [public.]name add column [if not exists] colname rest;
  const re =
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(?:"?)([a-zA-Z_][\w]*)(?:"?)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(?:"?)([a-zA-Z_][\w]*)(?:"?)\s+([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const [, tableName, colName, restRaw] = match;
    const clause = `${colName} ${restRaw}`.replace(/\s+/g, " ").trim();
    const col = parseColumn(clause, sourceFile);
    if (!col) continue;
    let table = tables.get(tableName);
    if (!table) {
      table = { name: tableName, columns: [], createdIn: sourceFile };
      tables.set(tableName, table);
    }
    if (!table.columns.find((c) => c.name === col.name)) {
      table.columns.push(col);
    }
  }
}

export const loadSchema = cache(async (): Promise<SchemaTable[]> => {
  const repoRoot = process.cwd();
  const migrationsDir = path.join(repoRoot, "supabase", "migrations");

  let files: string[];
  try {
    files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return [];
  }

  const tables = new Map<string, SchemaTable>();
  for (const file of files) {
    let sql: string;
    try {
      sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    } catch {
      continue;
    }
    const cleaned = stripLineComments(sql);
    findCreateTables(cleaned, file, tables);
    findAlterAddColumns(cleaned, file, tables);
  }

  return Array.from(tables.values()).sort((a, z) => a.name.localeCompare(z.name));
});
