/**
 * Cache de sessão (memória) para GETs de UI — PERFORMANCE 03.
 * Chave deve incluir escopo completo (URL+query). TTL curto para não
 * manter números financeiros obsoletos. Não compartilha entre abas do browser.
 */

import { fetchJsonOk, type AppRequestInit } from "@/src/lib/http";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const store = new Map<string, CacheEntry>();

export const UI_SESSION_GET_CACHE_DEFAULT_TTL_MS = 60_000;

export function readUiSessionGetCache<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function writeUiSessionGetCache(
  key: string,
  value: unknown,
  ttlMs: number = UI_SESSION_GET_CACHE_DEFAULT_TTL_MS
): void {
  store.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
}

/** Invalida tudo ou só chaves que começam com o prefixo. */
export function invalidateUiSessionGetCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function uiSessionGetCacheSizeForTests(): number {
  return store.size;
}

export function clearUiSessionGetCacheForTests(): void {
  store.clear();
}

export type FetchUiSessionCachedJsonOptions = AppRequestInit & {
  ttlMs?: number;
  /** Ignora leitura do cache (ex.: botão Atualizar). Ainda grava o resultado. */
  skipCache?: boolean;
  /** Override da chave (default = URL completa). */
  cacheKey?: string;
};

/**
 * GET JSON com cache de sessão + respeito a AbortSignal.
 * A chave padrão é a URL (path+query); não compartilha escopos diferentes.
 */
export async function fetchUiSessionCachedJson<T>(
  url: string,
  options: FetchUiSessionCachedJsonOptions = {}
): Promise<T> {
  const {
    ttlMs = UI_SESSION_GET_CACHE_DEFAULT_TTL_MS,
    skipCache = false,
    cacheKey = url,
    ...init
  } = options;

  if (!skipCache) {
    const hit = readUiSessionGetCache<T>(cacheKey);
    if (hit != null) return hit;
  }

  const data = await fetchJsonOk<T>(url, init);
  if (!init.signal?.aborted) {
    writeUiSessionGetCache(cacheKey, data, ttlMs);
  }
  return data;
}
