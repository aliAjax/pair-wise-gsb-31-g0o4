import assert from 'node:assert/strict';

import { exchangeApi } from '../src/api/exchangeApi';
import { settlementApi } from '../src/api/settlementApi';
import { ExchangeStatus } from '../src/constants/exchange';

// 复用 settlement 测试同款内存桩（import 其副作用不便，最小内联）。
const install = () => {
  const local: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => local[k] ?? null,
    setItem: (k: string, v: string) => { local[k] = v; },
    removeItem: (k: string) => { delete local[k]; },
  };
  const data = new Map<string, unknown>();
  class R<T = unknown> {
    result: T | undefined; error: Error | null = null; source = null; transaction: T2 | null = null;
    onsuccess: ((e: { target: R<T> }) => void) | null = null; onerror: (() => void) | null = null;
    constructor(exec: () => T) { queueMicrotask(() => { this.result = exec(); this.onsuccess?.({ target: this }); }); }
    addEventListener() {}
  }
  class T2 {
    oncomplete: (() => void) | null = null; onabort = null; onerror = null; error = null;
    settle() { queueMicrotask(() => this.oncomplete?.()); }
    addEventListener() {}
  }
  const storeOf = (tx: T2) => ({
    get: (key: string) => Object.assign(new R(() => (data.has(key) ? structuredClone(data.get(key)) : undefined)), { transaction: tx }),
    put: (v: unknown, key: string) => { data.set(key, structuredClone(v)); tx.settle(); return Object.assign(new R(() => key), { transaction: tx }); },
    delete: (key: string) => { data.delete(key); tx.settle(); return Object.assign(new R(() => undefined), { transaction: tx }); },
    transaction: tx,
  });
  const db = { objectStoreNames: { contains: (n: string) => n === 'keyval' }, transaction() { const tx = new T2(); return { objectStore: () => storeOf(tx) }; }, close() {} };
  const ls: Record<string, Array<(e?: unknown) => void>> = { success: [] };
  const openReq = {
    result: db, error: null,
    set onsuccess(fn: ((e?: unknown) => void) | null) { if (fn) ls.success = [fn]; },
    get onsuccess() { return ls.success[0] ?? null; },
    onupgradeneeded: null,
    addEventListener: (t: string, f: (e?: unknown) => void) => { (ls[t] ??= []).push(f); },
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { queueMicrotask(() => ls.success.forEach((f) => f({ target: openReq }))); return openReq; } };
};

const main = async () => {
  install();
  const exchanges = await exchangeApi.list();
  const pending = exchanges.find((e) => e.status === ExchangeStatus.PENDING)!;
  await exchangeApi.transition(pending.id, ExchangeStatus.ACCEPTED);

  // 并发双击
  const [a, b] = await Promise.all([
    settlementApi.completeExchange(pending.id),
    settlementApi.completeExchange(pending.id),
  ]);
  assert.equal(a.settlement.id, b.settlement.id, '并发返回同一张交割单');
  assert.ok(!a.replayed || !b.replayed, '至少一次被识别为复用在途结果');

  const receipts = await settlementApi.list();
  assert.equal(receipts.filter((r) => r.exchange_id === pending.id).length, 1, '只有一张交割单');
  console.log('concurrency checks passed');
};

main().catch((error) => { console.error(error); process.exit(1); });
