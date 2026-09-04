type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export function createTtlMemoryCache<T>(ttlMs: number) {
  const store = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();

  function get(key: string, now = Date.now()): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(key: string, value: T, now = Date.now()): T {
    store.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }

  async function getOrLoad(key: string, loader: () => Promise<T>, now = Date.now()): Promise<T> {
    const cached = get(key, now);
    if (cached != null) return cached;
    const pending = inflight.get(key);
    if (pending) return pending;
    const promise = loader()
      .then((value) => set(key, value, Date.now()))
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  function deleteKey(key: string): void {
    store.delete(key);
    inflight.delete(key);
  }

  function clear(): void {
    store.clear();
    inflight.clear();
  }

  function size(): number {
    return store.size;
  }

  return { get, set, getOrLoad, deleteKey, clear, size };
}
