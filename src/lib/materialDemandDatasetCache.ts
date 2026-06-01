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

export function getCachedMaterialDemandDataset<T>(
  filters: MaterialDemandFilters,
  loader: () => Promise<T>
): Promise<T> {
  const key = materialDemandFiltersCacheKey(filters);
  const hit = datasetCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return Promise.resolve(hit.data as T);
  }
  return loader().then((data) => {
    datasetCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
    return data;
  });
}

export function clearMaterialDemandDatasetCache(): void {
  datasetCache.clear();
}

/** @internal test helper */
export function materialDemandDatasetCacheSize(): number {
  return datasetCache.size;
}
