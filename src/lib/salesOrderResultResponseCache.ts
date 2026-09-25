/**
 * Cache curto em memória das respostas da tela Resultado de Pedidos de Venda
 * (dashboard e projeção) + formatação do cabeçalho Server-Timing.
 * Só desempenho: nenhum número muda — a resposta é a mesma do motor oficial.
 *
 * - Chave: tipo + parâmetros da consulta como vieram (ordenados por nome) + dia
 *   corrente + carimbo de atualização dos pedidos (último sync/alteração). Sync
 *   novo ⇒ carimbo novo ⇒ chave nova ⇒ recalcula na hora.
 * - Sem carimbo (falha na leitura ou base vazia) ⇒ sem cache (calcula direto).
 * - TTL curto: alterações fora dos pedidos (custo, tabela de preço, imposto)
 *   aparecem em até `ttlMs`.
 * - Requisições idênticas simultâneas compartilham o mesmo cálculo (in-flight).
 * - Erro não é cacheado. Tamanho limitado: descarta a entrada usada há mais tempo.
 */

export type SalesOrderResultCacheStatus = "hit" | "miss" | "shared" | "bypass";

export type SalesOrderResultResponseCache<T> = {
  getOrCompute(
    key: string | null,
    compute: () => Promise<T>
  ): Promise<{ value: T; status: SalesOrderResultCacheStatus }>;
  clear(): void;
  size(): number;
};

export function createSalesOrderResultResponseCache<T>(options: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}): SalesOrderResultResponseCache<T> {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();

  const prune = () => {
    const at = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(key);
    }
    while (entries.size > options.maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  };

  return {
    async getOrCompute(key, compute) {
      if (key == null) return { value: await compute(), status: "bypass" };

      const cached = entries.get(key);
      if (cached && cached.expiresAt > now()) {
        // Reinsere: a ordem do Map vira "usada há mais tempo primeiro".
        entries.delete(key);
        entries.set(key, cached);
        return { value: cached.value, status: "hit" };
      }
      if (cached) entries.delete(key);

      const pending = inFlight.get(key);
      if (pending) return { value: await pending, status: "shared" };

      const promise = Promise.resolve().then(compute);
      inFlight.set(key, promise);
      try {
        const value = await promise;
        entries.set(key, { value, expiresAt: now() + options.ttlMs });
        prune();
        return { value, status: "miss" };
      } finally {
        inFlight.delete(key);
      }
    },
    clear() {
      entries.clear();
      inFlight.clear();
    },
    size() {
      return entries.size;
    },
  };
}

/**
 * Chave do cache. Os parâmetros entram exatamente como vieram (sem trim/descartes):
 * consultas diferentes nunca compartilham resposta. `null` quando não há carimbo.
 */
export function buildSalesOrderResultCacheKey(
  kind: string,
  query: Record<string, unknown>,
  context: { versionStamp: string | null; day: string }
): string | null {
  if (!context.versionStamp) return null;
  const params = Object.keys(query)
    .sort()
    .map((name) => [name, query[name] ?? null]);
  return JSON.stringify([kind, context.day, context.versionStamp, params]);
}

/** Dia civil local e UTC — o motor usa os dois como padrão de ano/data de referência. */
export function formatSalesOrderResultCacheDay(now: Date): string {
  const local = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `${local}|${now.toISOString().slice(0, 10)}`;
}

/** Cabeçalho Server-Timing (`fase;dur=ms, …`) — visível no DevTools (aba Rede). */
export function formatSalesOrderResultServerTiming(timings: Record<string, number>): string {
  return Object.entries(timings)
    .filter(([name, ms]) => /^[A-Za-z0-9_-]+$/.test(name) && Number.isFinite(ms))
    .map(([name, ms]) => `${name};dur=${Math.max(0, Math.round(ms))}`)
    .join(", ");
}
