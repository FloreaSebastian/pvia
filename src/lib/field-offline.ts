/**
 * Minimal IndexedDB-backed queue for field-mode mutations that fail while offline.
 * Stores serializable operations and replays them when the browser is back online.
 */

export type FieldOp =
  | { id: string; createdAt: number; type: "photo"; pvId: string; dataUrl: string; kind: string; caption?: string | null }
  | { id: string; createdAt: number; type: "reserve"; pvId: string; description: string; severity: "mineure" | "majeure" | "bloquante" }
  | { id: string; createdAt: number; type: "save"; pvId: string; patch: Record<string, unknown> };

const DB_NAME = "pvia-field";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type FieldOpInput = DistOmit<FieldOp, "id" | "createdAt">;

export async function enqueue(op: FieldOpInput): Promise<FieldOp> {
  const full = { ...op, id: crypto.randomUUID(), createdAt: Date.now() } as FieldOp;
  await withStore("readwrite", (s) => s.add(full));
  window.dispatchEvent(new Event("pvia:queue-changed"));
  return full;
}

export async function listQueue(): Promise<FieldOp[]> {
  if (typeof indexedDB === "undefined") return [];
  return withStore("readonly", (s) => s.getAll() as IDBRequest<FieldOp[]>);
}

export async function removeOp(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
  window.dispatchEvent(new Event("pvia:queue-changed"));
}

export async function flushQueue(
  runners: {
    photo: (op: Extract<FieldOp, { type: "photo" }>) => Promise<void>;
    reserve: (op: Extract<FieldOp, { type: "reserve" }>) => Promise<void>;
    save: (op: Extract<FieldOp, { type: "save" }>) => Promise<void>;
  },
): Promise<{ done: number; failed: number }> {
  const ops = await listQueue();
  let done = 0;
  let failed = 0;
  for (const op of ops) {
    try {
      if (op.type === "photo") await runners.photo(op);
      else if (op.type === "reserve") await runners.reserve(op);
      else await runners.save(op);
      await removeOp(op.id);
      done++;
    } catch (e) {
      console.warn("[field-offline] flush failed for op", op.id, e);
      failed++;
    }
  }
  return { done, failed };
}
