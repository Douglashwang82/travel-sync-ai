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

function matchFilter(row: Row, op: string, col: string, val: unknown): boolean {
  if (op === "eq") return row[col] === val;
  if (op === "neq") return row[col] !== val;
  if (op === "in") return (val as unknown[]).includes(row[col]);
  if (op === "is") {
    if (val === null) return row[col] == null;
    return row[col] === val;
  }
  if (op === "lte") {
    return String(row[col] ?? "") <= String(val ?? "");
  }
  if (op === "ilike") {
    const rowVal = String(row[col] ?? "").toLowerCase();
    const pattern = String(val ?? "").toLowerCase();
    return rowVal === pattern;
  }
  if (op === "like") {
    // Convert SQL LIKE pattern (% wildcard) to a RegExp anchored at both ends.
    const pattern = String(val ?? "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
    return new RegExp(`^${pattern}$`).test(String(row[col] ?? ""));
  }
  return true;
}

function applyFilters(rows: Row[], filters: Array<{ col: string; op: string; val: unknown }>): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.op.startsWith("not.")) {
        const innerOp = f.op.slice("not.".length);
        return !matchFilter(row, innerOp, f.col, f.val);
      }
      return matchFilter(row, f.op, f.col, f.val);
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

  select(_cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    void _cols;
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

  neq(col: string, val: unknown) {
    this._filters.push({ col, op: "neq", val });
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

  lte(col: string, val: unknown) {
    this._filters.push({ col, op: "lte", val });
    return this;
  }

  private _orderBy: { col: string; ascending: boolean } | null = null;

  order(col: string, opts?: { ascending?: boolean }) {
    this._orderBy = { col, ascending: opts?.ascending !== false };
    return this;
  }

  not(col: string, op: string, val: unknown) {
    this._filters.push({ col, op: `not.${op}`, val });
    return this;
  }

  limit(_n: number) {
    void _n;
    // Limit is ignored in the mock - test data sets should be small
    return this;
  }

  maybeSingle() {
    this._single = true;
    return this._execute().then((result) => {
      if ((result.error as { code?: string } | null)?.code === "PGRST116") {
        return { data: null, error: null };
      }
      return result;
    });
  }

  ilike(col: string, val: unknown) {
    // Case-insensitive LIKE - for tests, use exact string match (sufficient for dedup checks)
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

    if (this._op === "select") {
      let rows = applyFilters(table, this._filters);

      if (this._orderBy) {
        const { col, ascending } = this._orderBy;
        rows = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (av < bv) return ascending ? -1 : 1;
          return ascending ? 1 : -1;
        });
      }

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

    if (this._op === "update") {
      const toUpdate = applyFilters(table, this._filters);
      if (toUpdate.length === 0 && this._single) {
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

    if (this._op === "delete") {
      const toDelete = applyFilters(table, this._filters);
      const deleteIds = new Set(toDelete.map((r) => r.id));
      this.tables.set(this.tableName, table.filter((r) => !deleteIds.has(r.id as string)));
      return { data: toDelete, error: null };
    }

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
  _tables: Map<string, Row[]>;
}

export function createMockDb(
  initialData: Record<string, Row[]> = {},
  errorOverrides: Record<string, { message: string; code?: string }> = {}
): MockDb {
  const tables = new Map<string, Row[]>();
  for (const [tbl, rows] of Object.entries(initialData)) {
    tables.set(tbl, rows.map((r) => ({ ...r })));
  }

  const overrideMap = new Map(Object.entries(errorOverrides));

  return {
    from: (tableName: string) => new QueryBuilder(tables, tableName, overrideMap),
    _tables: tables,
  };
}
