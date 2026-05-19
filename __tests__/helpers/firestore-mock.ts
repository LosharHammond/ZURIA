/**
 * In-memory Firestore mock.
 *
 * Provides a deterministic, zero-latency substitute for Firebase Admin
 * Firestore in all test files. Implements the subset of the API used
 * by ZURIA: get, set, update, delete, batch, runTransaction, where, limit.
 *
 * Usage:
 *   import { createMockDb, type MockDb } from "../helpers/firestore-mock";
 *   const db = createMockDb();
 *   jest.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => db }));
 */

export type DocData = Record<string, unknown>;

interface DocRef {
  id: string;
  path: string;
}

/**
 * Simulated Firestore database backed by a plain Map.
 * Thread-safe within a single Jest worker (single-threaded Node).
 */
export class MockDb {
  // path → data  (e.g. "users/uid123" → {...})
  private store = new Map<string, DocData>();

  // ── Document reference ────────────────────────────────────────────────────

  collection(col: string) {
    return new MockCollectionRef(col, this.store);
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  async runTransaction<T>(fn: (txn: MockTransaction) => Promise<T>): Promise<T> {
    const txn = new MockTransaction(this.store);
    const result = await fn(txn);
    txn.commit();
    return result;
  }

  // ── Batched writes ────────────────────────────────────────────────────────

  batch() {
    return new MockBatch(this.store);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Seed test data directly into the mock store. */
  seed(path: string, data: DocData) {
    this.store.set(path, { ...data });
  }

  /** Read raw data at a path (for assertions). */
  read(path: string): DocData | undefined {
    return this.store.get(path);
  }

  /** Check if a path exists. */
  exists(path: string): boolean {
    return this.store.has(path);
  }

  /** Clear all data (call in beforeEach). */
  clear() {
    this.store.clear();
  }

  /** Snapshot all keys (for debugging). */
  dump(): Record<string, DocData> {
    return Object.fromEntries(this.store);
  }
}

// ─── Collection reference ─────────────────────────────────────────────────────

class MockCollectionRef {
  constructor(
    private col: string,
    private store: Map<string, DocData>,
  ) {}

  doc(id: string) {
    return new MockDocRef(`${this.col}/${id}`, this.store);
  }

  // Minimal query builder (supports .where().where().limit().get())
  where(field: string, op: string, value: unknown) {
    return new MockQuery(this.col, this.store, [{ field, op, value }]);
  }

  // Fetch all docs in collection
  async get() {
    const prefix = `${this.col}/`;
    const docs = [...this.store.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
      .map(([k, v]) => new MockDocSnap(k.split("/").pop()!, k, v, this.store));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

// ─── Document reference ───────────────────────────────────────────────────────

class MockDocRef implements DocRef {
  constructor(
    public path: string,
    private store: Map<string, DocData>,
  ) {}

  get id() { return this.path.split("/").pop()!; }

  async get(): Promise<MockDocSnap> {
    const data = this.store.get(this.path);
    return new MockDocSnap(this.id, this.path, data, this.store);
  }

  async set(data: DocData, options?: { merge?: boolean }) {
    if (options?.merge) {
      const existing = this.store.get(this.path) ?? {};
      this.store.set(this.path, { ...existing, ...data });
    } else {
      this.store.set(this.path, { ...data });
    }
  }

  async update(data: DocData) {
    const existing = this.store.get(this.path);
    if (!existing) throw new Error(`MockDb: doc not found at ${this.path}`);
    this.store.set(this.path, { ...existing, ...applyFieldValues(existing, data) });
  }

  async delete() {
    this.store.delete(this.path);
  }

  // Needed by batch/transaction:
  get ref() { return this; }
}

// ─── Document snapshot ────────────────────────────────────────────────────────

class MockDocSnap {
  constructor(
    public id: string,
    public path: string,
    private _data: DocData | undefined,
    private store?: Map<string, DocData>,
  ) {}

  get exists() { return this._data !== undefined; }

  get ref() {
    const self = this;
    return {
      path: self.path,
      id:   self.id,
      update: async (d: DocData) => {
        if (self.store) {
          const existing = self.store.get(self.path) ?? {};
          self.store.set(self.path, { ...existing, ...applyFieldValues(existing, d) });
        }
      },
    };
  }

  data(): DocData | undefined { return this._data ? { ...this._data } : undefined; }
}

// ─── Query ────────────────────────────────────────────────────────────────────

class MockQuery {
  private _limit = 10_000;

  constructor(
    private col: string,
    private store: Map<string, DocData>,
    private filters: { field: string; op: string; value: unknown }[],
  ) {}

  where(field: string, op: string, value: unknown) {
    return new MockQuery(this.col, this.store, [...this.filters, { field, op, value }]);
  }

  limit(n: number) {
    this._limit = n;
    return this;
  }

  orderBy(_field: string, _dir?: string) { return this; }

  async get() {
    const prefix = `${this.col}/`;
    let docs = [...this.store.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
      .map(([k, v]) => ({ id: k.split("/").pop()!, path: k, data: v }));

    for (const f of this.filters) {
      docs = docs.filter(({ data }) => matchFilter(data, f.field, f.op, f.value));
    }

    const sliced = docs.slice(0, this._limit);
    const snaps = sliced.map((d) => new MockDocSnap(d.id, d.path, d.data, this.store));
    return { docs: snaps, size: snaps.length, empty: snaps.length === 0 };
  }
}

// ─── Transaction ──────────────────────────────────────────────────────────────

export class MockTransaction {
  private ops: Array<() => void> = [];

  constructor(private store: Map<string, DocData>) {}

  async get(ref: MockDocRef) {
    const data = this.store.get(ref.path);
    return new MockDocSnap(ref.id, ref.path, data, this.store);
  }

  set(ref: MockDocRef, data: DocData) {
    this.ops.push(() => this.store.set(ref.path, { ...data }));
  }

  update(ref: MockDocRef, data: DocData) {
    this.ops.push(() => {
      const existing = this.store.get(ref.path) ?? {};
      this.store.set(ref.path, { ...existing, ...applyFieldValues(existing, data) });
    });
  }

  commit() {
    for (const op of this.ops) op();
  }

  /** Simulate a Firestore transaction abort (contention). */
  abort() {
    this.ops = [];
    throw new Error("MockTransaction: ABORTED (simulated contention)");
  }
}

// ─── Batch ────────────────────────────────────────────────────────────────────

class MockBatch {
  private ops: Array<() => void> = [];

  constructor(private store: Map<string, DocData>) {}

  set(ref: MockDocRef, data: DocData, options?: { merge?: boolean }) {
    this.ops.push(() => {
      if (options?.merge) {
        const existing = this.store.get(ref.path) ?? {};
        this.store.set(ref.path, { ...existing, ...data });
      } else {
        this.store.set(ref.path, { ...data });
      }
    });
    return this;
  }

  update(ref: MockDocRef, data: DocData) {
    this.ops.push(() => {
      const existing = this.store.get(ref.path) ?? {};
      this.store.set(ref.path, { ...existing, ...applyFieldValues(existing, data) });
    });
    return this;
  }

  delete(ref: MockDocRef) {
    this.ops.push(() => this.store.delete(ref.path));
    return this;
  }

  async commit() {
    for (const op of this.ops) op();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Apply FieldValue.increment() and plain field updates. */
function applyFieldValues(existing: DocData, update: DocData): DocData {
  const result: DocData = {};
  for (const [k, v] of Object.entries(update)) {
    if (v && typeof v === "object" && "_type" in v && (v as { _type: string })._type === "increment") {
      // Mock FieldValue.increment format: { _type: "increment", n }
      result[k] = ((existing[k] as number) ?? 0) + ((v as unknown as { n: number }).n);
    } else if (v && typeof v === "object" && "operand" in v && typeof (v as { operand: unknown }).operand === "number") {
      // Firebase Admin SDK FieldValue.increment format: { operand: n }
      result[k] = ((existing[k] as number) ?? 0) + (v as { operand: number }).operand;
    } else {
      result[k] = v;
    }
  }
  return result;
}

/** Filter a document against a where clause. */
function matchFilter(data: DocData, field: string, op: string, value: unknown): boolean {
  const docVal = data[field];
  switch (op) {
    case "==": return docVal === value;
    case "!=": return docVal !== value;
    case ">":  return (docVal as number) > (value as number);
    case ">=": return (docVal as number) >= (value as number);
    case "<":  return (docVal as number) < (value as number);
    case "<=": return (docVal as number) <= (value as number);
    case "in": return Array.isArray(value) && value.includes(docVal);
    default:   return true;
  }
}

/** FieldValue.increment() sentinel understood by applyFieldValues(). */
export const FieldValue = {
  increment: (n: number) => ({ _type: "increment", n }),
};

/** Create a fresh isolated mock database for one test suite. */
export function createMockDb(): MockDb {
  return new MockDb();
}
