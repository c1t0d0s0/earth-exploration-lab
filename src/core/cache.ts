/** 容量制限付きのメモリキャッシュ（最近使ったものを残す） */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error("capacity must be >= 1");
  }
  get size(): number {
    return this.map.size;
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }
  delete(key: K): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

/** 地点値などの数値キー。座標は約100m単位に丸めて同一条件を共有する */
export function pointKey(datasetKey: string, dateKey: string, lon: number, lat: number): string {
  return `pt|${datasetKey}|${dateKey}|${lon.toFixed(3)}|${lat.toFixed(3)}`;
}

interface Entry<V> {
  v: V;
  exp: number;
}

const DB_NAME = "earth-exploration-lab";
const STORE = "kv";

/**
 * IndexedDB を使った永続キャッシュ（API アクセスを減らすため）。
 * IndexedDB が使えない環境（プライベートモード等）ではメモリのみで動作する。
 */
export class PersistentCache<V> {
  private mem = new LruCache<string, Entry<V>>(2000);
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly idb: IDBFactory | undefined = globalThis.indexedDB,
  ) {}

  private db(): Promise<IDBDatabase | null> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        try {
          if (!this.idb) return resolve(null);
          const req = this.idb.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }

  async get(key: string): Promise<V | undefined> {
    const m = this.mem.get(key);
    if (m) {
      if (m.exp > this.now()) return m.v;
      this.mem.delete(key);
    }
    const db = await this.db();
    if (!db) return undefined;
    const entry = await new Promise<Entry<V> | undefined>((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as Entry<V> | undefined);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    if (!entry || entry.exp <= this.now()) return undefined;
    this.mem.set(key, entry);
    return entry.v;
  }

  async set(key: string, v: V, ttlMs = this.ttlMs): Promise<void> {
    const entry = { v, exp: this.now() + ttlMs };
    this.mem.set(key, entry);
    const db = await this.db();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(entry, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
