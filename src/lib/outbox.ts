import { supabase } from "@/integrations/supabase/client";
import { generateCode } from "./code";

const DB_NAME = "laqta-outbox";
const STORE = "submissions";

export interface OutboxEntry {
  id: string;            // guest id
  eventSlug: string;
  eventId: string;
  code: string;
  payload: {
    form_data: Record<string, string>;
    consent: boolean;
    source: string;
  };
  state: "queued" | "synced";
  attempts: number;
  createdAt: number;
  lastTriedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const res = fn(store);
    t.oncomplete = () => {
      if (res instanceof IDBRequest) resolve(res.result as T);
    };
    t.onerror = () => reject(t.error);
    if (!(res instanceof IDBRequest)) {
      Promise.resolve(res).then(resolve, reject);
    }
  });
}

export async function addOutbox(entry: OutboxEntry): Promise<void> {
  await tx("readwrite", (s) => s.put(entry));
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  return tx("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
}

export async function updateOutbox(entry: OutboxEntry): Promise<void> {
  await tx("readwrite", (s) => s.put(entry));
}

export async function removeOutbox(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function markSynced(id: string): Promise<void> {
  const all = await listOutbox();
  const found = all.find((e) => e.id === id);
  if (found) {
    found.state = "synced";
    await updateOutbox(found);
    // also remove to keep store small
    await removeOutbox(id);
  }
}

function fetchWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function attemptSubmit(entry: OutboxEntry): Promise<{ ok: true } | { ok: false; collision: boolean }> {
  try {
    const insertPromise: Promise<{ error: { code?: string; message?: string } | null }> = Promise.resolve(
      supabase.from("guests").insert({
        id: entry.id,
        event_id: entry.eventId,
        code: entry.code,
        form_data: entry.payload.form_data,
        consent: entry.payload.consent,
        source: entry.payload.source,
      }),
    );
    const { error } = await fetchWithTimeout(insertPromise, 8000);
    if (!error) return { ok: true };
    const code = error.code;
    const msg = (error.message || "").toLowerCase();
    if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
      if (msg.includes("guests_pkey") || msg.includes("(id)")) return { ok: true };
      if (msg.includes("code")) return { ok: false, collision: true };
      return { ok: true };
    }
    return { ok: false, collision: false };
  } catch {
    return { ok: false, collision: false };
  }
}

let syncing = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export async function trySync(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const entries = (await listOutbox()).filter((e) => e.state === "queued").sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of entries) {
      const now = Date.now();
      const backoff = Math.min(20_000 * Math.max(entry.attempts, 1), 5 * 60_000);
      const jitter = backoff * (0.8 + Math.random() * 0.4);
      if (entry.attempts > 0 && now - entry.lastTriedAt < jitter) continue;
      entry.attempts += 1;
      entry.lastTriedAt = now;
      let res = await attemptSubmit(entry);
      if (!res.ok && !res.collision) {
        // one immediate retry
        res = await attemptSubmit(entry);
      }
      if (res.ok) {
        await markSynced(entry.id);
      } else if (res.collision) {
        entry.code = generateCode();
        await updateOutbox(entry);
      } else {
        await updateOutbox(entry);
      }
    }
  } finally {
    syncing = false;
  }
}

export function startSyncEngine(): () => void {
  if (typeof window === "undefined") return () => {};
  const handleOnline = () => trySync();
  const handleVis = () => { if (document.visibilityState === "visible") trySync(); };
  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVis);
  trySync();
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(async () => {
    const all = await listOutbox();
    if (all.some((e) => e.state === "queued")) trySync();
  }, 20_000);
  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVis);
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
  };
}

export async function queueState(): Promise<{ pending: number; oldestAgeMs: number }> {
  const entries = (await listOutbox()).filter((e) => e.state === "queued");
  if (entries.length === 0) return { pending: 0, oldestAgeMs: 0 };
  const oldest = entries.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
  return { pending: entries.length, oldestAgeMs: Date.now() - oldest.createdAt };
}
