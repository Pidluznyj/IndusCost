import {
  materialDemandFiltersCacheKey,
  type MaterialDemandFilters,
} from "./materialDemandFilters.js";

const CACHE_TTL_MS = 3 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
};

const datasetCache = new Map<string, CacheEntry<unknown>>();
/** In-flight loaders — evita stampede quando /summary e /rows disparam juntos. */
const inflight = new Map<string, Promise<unknown>>();

export function getCachedMaterialDemandDataset<T>(
  filters: MaterialDemandFilters,
  loader: () => Promise<T>
): Promise<T> {
  const key = materialDemandFiltersCacheKey(filters);
  const hit = datasetCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return Promise.resolve(hit.data as T);
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = loader()
    .then((data) => {
      datasetCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise as Promise<T>;
}

export function clearMaterialDemandDatasetCache(): void {
  datasetCache.clear();
  inflight.clear();
}

/** @internal test helper */
export function materialDemandDatasetCacheSize(): number {
  return datasetCache.size;
}

/** @internal test helper */
export function materialDemandDatasetInflightSize(): number {
  return inflight.size;
}
