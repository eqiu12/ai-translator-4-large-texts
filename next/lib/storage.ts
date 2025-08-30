import { kv } from '@vercel/kv';
import Redis from 'ioredis';
import crypto from 'crypto';

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
  return crypto.createHash('sha256').update(json).digest('hex');
}

export async function save(item: StoredItem) {
  if (hasKV()) {
    await kv.hset(`tr:${item.key}`, item as any);
    await kv.zadd('tr_index', { score: Date.parse(item.createdAt), member: item.key });
    return;
  }
  const redis = getRedis();
  if (redis) {
    await redis.hset(`tr:${item.key}`, item as unknown as Record<string, string>);
    await redis.zadd('tr_index', Date.parse(item.createdAt), item.key);
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
  const redis = getRedis();
  if (redis) {
    const it = await redis.hgetall(`tr:${key}`);
    if (!it || !Object.keys(it).length) return null;
    return it as unknown as Record<string, string>;
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
  const redis = getRedis();
  if (redis) {
    const keys = await redis.zrevrange('tr_index', 0, limit - 1);
    const items: { key: string; tgt: string; src: string; title: string; createdAt: string }[] = [];
    for (const key of keys) {
      const it = await redis.hgetall(`tr:${key}`);
      if (it && Object.keys(it).length) items.push({ key, tgt: String(it.tgtLang), src: String(it.srcLang), title: String(it.title || ''), createdAt: String(it.createdAt) });
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
  const redis = getRedis();
  if (redis) {
    await redis.del(`tr:${key}`);
    await redis.zrem('tr_index', key);
    return;
  }
  // memory
  memDelete(key);
}

// ─────────── Local in-memory fallback for dev ───────────
function hasKV() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getRedis(): Redis | null {
  const url = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || process.env.REDIS_TLS_URL;
  if (!url) return null;
  try {
    const client = new Redis(url, { maxRetriesPerRequest: 2, enableAutoPipelining: true });
    return client;
  } catch {
    return null;
  }
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

