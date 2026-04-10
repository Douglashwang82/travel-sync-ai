/**
 * In-memory Supabase mock factory.
 *
 * Usage:
 *   const mockDb = createMockDb({ trips: [{ id: "t1", ... }] })
 *   vi.mocked(createAdminClient).mockReturnValue(mockDb as any)
 *
 * Supports: select, insert, update, delete, upsert, eq, in, is, single, order.
 * Mutations (insert/update/upsert) chain .select() to return data.
 */

export type Row = Record<string, unknown>;

function applyFilters(rows: Row[], filters: Array<{ col: string; op: string; val: unknown }>): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.op === "eq") return row[f.col] === f.val;
      if (f.op === "neq") return row[f.col] !== f.val;
      if (f.op === "in") return (f.val as unknown[]).includes(row[f.col]);
      if (f.op === "is") {
        if (f.val === null) return row[f.col] == null;
        return row[f.col] === f.val;
      }
      if (f.op === "ilike") {
        const rowVal = String(row[f.col] ?? "").toLowerCase();
        const pattern = String(f.val ?? "").toLowerCase();
        return rowVal === pattern;
      }
      return true;
    })
  );
}

let _idCounter = 1;
function newId(): string {
  return `mock-id-${_idCounter++}`;
}
export function resetIdCounter() {
  _idCounter = 1;
}

type Op = "select" | "insert" | "update" | "delete" | "upsert" | "noop";

class QueryBuilder {
  private _op: Op = "noop";
  private _filters: Array<{ col: string; op: string; val: unknown }> = [];
  private _single = false;
  private _head = false;
  private _countMode: "exact" | null = null;
  private _insertData: Row | Row[] | null = null;
  private _updatePatch: Row | null = null;
  private _upsertData: Row | Row[] | null = null;
  private _upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private _selectAfterMutation = false;
  private _forceError: { message: string; code?: string } | null = null;

  constructor(
    private tables: Map<string, Row[]>,
    private tableName: string,
    private _errorOverrides?: Map<string, { message: string; code?: string }>
  ) {
    if (!tables.has(tableName)) tables.set(tableName, []);
    const override = _errorOverrides?.get(tableName);
    if (override) this._forceError = override;
  }

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this._op === "insert" || this._op === "update" || this._op === "upsert" || this._op === "delete") {
      this._selectAfterMutation = true;
    } else {
      this._op = "select";
    }
    if (opts?.count) this._countMode = opts.count;
    if (opts?.head) this._head = opts.head;
    return this;
  }

  insert(data: Row | Row[]) {
    this._op = "insert";
    this._insertData = data;
    return this;
  }

  update(patch: Row) {
    this._op = "update";
    this._updatePatch = patch;
    return this;
  }

  delete() {
    this._op = "delete";
    return this;
  }

  upsert(data: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this._op = "upsert";
    this._upsertData = data;
    this._upsertOpts = opts;
    return this;
  }

  eq(col: string, val: unknown) {
    this._filters.push({ col, op: "eq", val });
    return this;
  }

  in(col: string, vals: unknown[]) {
    this._filters.push({ col, op: "in", val: vals });
    return this;
  }

  is(col: string, val: unknown) {
    this._filters.push({ col, op: "is", val });
    return this;
  }

  order(_col: string, _opts?: { ascending?: boolean }) {
    // Preserve insertion order by default (fine for tests)
    return this;
  }

  limit(_n: number) {
    // Limit is ignored in the mock — test data sets should be small
    return this;
  }

  neq(col: string, val: unknown) {
    this._filters.push({ col, op: "neq", val });
    return this;
  }

  ilike(col: string, val: unknown) {
    // Case-insensitive LIKE — for tests, use exact string match (sufficient for dedup checks)
    this._filters.push({ col, op: "ilike", val });
    return this;
  }

  single() {
    this._single = true;
    return this._execute();
  }

  then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
    return this._execute().then(resolve, reject);
  }

  private async _execute(): Promise<{ data: unknown; error: unknown; count?: number | null }> {
    if (this._forceError) {
      return { data: null, error: this._forceError };
    }

    const table = this.tables.get(this.tableName) ?? [];

    // ── SELECT ──────────────────────────────────────────────────────────────────
    if (this._op === "select") {
      const rows = applyFilters(table, this._filters);

      if (this._head) {
        const count = this._countMode === "exact" ? rows.length : null;
        return { data: null, error: null, count };
      }

      if (this._single) {
        if (rows.length === 0) return { data: null, error: { message: "No rows found", code: "PGRST116" } };
        return { data: rows[0], error: null };
      }

      const count = this._countMode === "exact" ? rows.length : undefined;
      return { data: rows, error: null, ...(count !== undefined && { count }) };
    }

    // ── INSERT ──────────────────────────────────────────────────────────────────
    if (this._op === "insert") {
      const newRows = (Array.isArray(this._insertData) ? this._insertData : [this._insertData!]).map(
        (r) => ({ id: newId(), created_at: new Date().toISOString(), ...r })
      );
      table.push(...newRows);
      this.tables.set(this.tableName, table);

      if (!this._selectAfterMutation) return { data: null, error: null };
      if (this._single) return { data: newRows[0] ?? null, error: null };
      return { data: newRows, error: null };
    }

    // ── UPDATE ──────────────────────────────────────────────────────────────────
    if (this._op === "update") {
      const toUpdate = applyFilters(table, this._filters);
      if (toUpdate.length === 0 && this._single) {
        // Mirror the real Supabase PostgREST error code for 0-row single queries
        return { data: null, error: { message: "No rows found", code: "PGRST116" } };
      }
      const updatedIds = new Set(toUpdate.map((r) => r.id));
      const updatedRows = toUpdate.map((r) => ({ ...r, ...this._updatePatch! }));
      const idToUpdated = new Map(updatedRows.map((r) => [r.id, r]));
      const newTable = table.map((r) => (updatedIds.has(r.id as string) ? idToUpdated.get(r.id as string)! : r));
      this.tables.set(this.tableName, newTable);

      if (!this._selectAfterMutation) return { data: null, error: null };
      if (this._single) return { data: updatedRows[0] ?? null, error: null };
      return { data: updatedRows, error: null };
    }

    // ── DELETE ──────────────────────────────────────────────────────────────────
    if (this._op === "delete") {
      const toDelete = applyFilters(table, this._filters);
      const deleteIds = new Set(toDelete.map((r) => r.id));
      this.tables.set(this.tableName, table.filter((r) => !deleteIds.has(r.id as string)));
      return { data: toDelete, error: null };
    }

    // ── UPSERT ──────────────────────────────────────────────────────────────────
    if (this._op === "upsert") {
      const newRows = Array.isArray(this._upsertData) ? this._upsertData : [this._upsertData!];
      const conflictCols = this._upsertOpts.onConflict?.split(",").map((c) => c.trim()) ?? [];
      const resultRows: Row[] = [];

      for (const row of newRows) {
        if (conflictCols.length > 0) {
          const existingIdx = table.findIndex((r) =>
            conflictCols.every((col) => r[col] === (row as Row)[col])
          );
          if (existingIdx >= 0) {
            if (this._upsertOpts.ignoreDuplicates) {
              // Existing row — signal as null result
              continue;
            }
            table[existingIdx] = { ...table[existingIdx], ...(row as Row) };
            resultRows.push(table[existingIdx]);
          } else {
            const newRow = { id: newId(), created_at: new Date().toISOString(), ...(row as Row) };
            table.push(newRow);
            resultRows.push(newRow);
          }
        } else {
          const newRow = { id: newId(), created_at: new Date().toISOString(), ...(row as Row) };
          table.push(newRow);
          resultRows.push(newRow);
        }
      }
      this.tables.set(this.tableName, table);

      if (!this._selectAfterMutation) return { data: null, error: null };
      if (this._single) return { data: resultRows[0] ?? null, error: null };
      return { data: resultRows, error: null };
    }

    return { data: null, error: { message: "Unknown operation" } };
  }
}

export interface MockDb {
  from: (table: string) => QueryBuilder;
  /** Direct table access for assertions */
  _tables: Map<string, Row[]>;
}

/**
 * Create a fresh in-memory Supabase client mock.
 *
 * @param initialData  Seed data per table name.
 * @param errorOverrides  Force an error for a specific table (for error-path testing).
 */
export function createMockDb(
  initialData: Record<string, Row[]> = {},
  errorOverrides: Record<string, { message: string; code?: string }> = {}
): MockDb {
  const tables = new Map<string, Row[]>();
  for (const [tbl, rows] of Object.entries(initialData)) {
    // Deep-copy so tests don't share state
    tables.set(tbl, rows.map((r) => ({ ...r })));
  }

  const overrideMap = new Map(Object.entries(errorOverrides));

  return {
    from: (tableName: string) => new QueryBuilder(tables, tableName, overrideMap),
    _tables: tables,
  };
}
