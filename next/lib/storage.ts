import { kv } from '@vercel/kv';

export type StoredItem = {
  key: string;
  srcLang: string;
  tgtLang: string;
  title: string;
  oldDom: string;
  newDom: string;
  curFrom: string;
  curTo: string;
  curLbl: string;
  removeConvertBlocks: boolean;
  runQa: boolean;
  htmlIn: string;
  htmlOut: string;
  qaReport: string;
  createdAt: string;
};

export function computeKey(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = (hash >>> 0) * 0x01000193;
  }
  return ('0000000' + (hash >>> 0).toString(16)).slice(-8);
}

export async function save(item: StoredItem) {
  if (hasKV()) {
    await kv.hset(`tr:${item.key}`, item as any);
    await kv.zadd('tr_index', { score: Date.parse(item.createdAt), member: item.key });
    return;
  }
  memSave(item);
}

export async function getByKey(key: string) {
  if (hasKV()) {
    const res = await kv.hgetall<Record<string, string>>(`tr:${key}`);
    if (!res) return null;
    return res;
  }
  return memGet(key);
}

export async function listRecent(limit = 50) {
  if (hasKV()) {
    const keys = (await kv.zrange('tr_index', 0, limit - 1, { rev: true })) as unknown as string[];
    const items: { key: string; tgt: string; src: string; title: string; createdAt: string }[] = [];
    for (const key of keys) {
      const it = (await kv.hgetall(`tr:${key}`)) as unknown as Record<string, unknown> | null;
      if (it) items.push({ key, tgt: String(it.tgtLang as unknown as string), src: String(it.srcLang as unknown as string), title: String(it.title as unknown as string || ''), createdAt: String(it.createdAt as unknown as string) });
    }
    return items;
  }
  return memList(limit);
}

export async function removeByKey(key: string) {
  if (hasKV()) {
    await kv.del(`tr:${key}`);
    // @vercel/kv supports zrem
    try { await kv.zrem('tr_index', key as any); } catch {}
    return;
  }
  // memory
  memDelete(key);
}

// ─────────── Local in-memory fallback for dev ───────────
function hasKV() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

const memStore = new Map<string, StoredItem>();
const memIndex: { key: string; score: number }[] = [];

function memSave(item: StoredItem) {
  memStore.set(item.key, item);
  const score = Date.parse(item.createdAt);
  const existingIdx = memIndex.findIndex((e) => e.key === item.key);
  if (existingIdx >= 0) memIndex.splice(existingIdx, 1);
  memIndex.push({ key: item.key, score });
}

function memGet(key: string) {
  const it = memStore.get(key);
  if (!it) return null;
  return it as unknown as Record<string, string>;
}

function memList(limit: number) {
  const sorted = [...memIndex].sort((a, b) => b.score - a.score).slice(0, limit);
  const items: { key: string; tgt: string; src: string; title: string; createdAt: string }[] = [];
  for (const { key } of sorted) {
    const it = memStore.get(key);
    if (it) items.push({ key, tgt: it.tgtLang, src: it.srcLang, title: it.title, createdAt: it.createdAt });
  }
  return items;
}

function memDelete(key: string) {
  memStore.delete(key);
  const idx = memIndex.findIndex(e => e.key === key);
  if (idx >= 0) memIndex.splice(idx, 1);
}

