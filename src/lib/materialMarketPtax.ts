/**
 * Cotação PTAX USD/BRL (BCB) para conversão de cotações em dólar e snapshots globais.
 */

export const PTAX_BCB_SOURCE = "BCB PTAX" as const;
export const PTAX_BCB_API_BASE =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata" as const;

export type PtaxBcbRates = {
  quoteDate: string;
  buyRate: number;
  sellRate: number;
};

const ptaxSellCache = new Map<string, number | null>();
const ptaxRatesCache = new Map<string, PtaxBcbRates | null>();

export function toBcbDateParam(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${m}-${d}-${y}`;
}

export function previousIsoDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseBcbRate(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type BcbPtaxRow = {
  cotacaoCompra?: unknown;
  cotacaoVenda?: unknown;
};

export function parseBcbPtaxDayResponse(
  isoDate: string,
  data: { value?: BcbPtaxRow[] } | null | undefined
): PtaxBcbRates | null {
  const row = data?.value?.[0];
  if (!row) return null;
  const buyRate = parseBcbRate(row.cotacaoCompra);
  const sellRate = parseBcbRate(row.cotacaoVenda);
  if (buyRate == null || sellRate == null) return null;
  return { quoteDate: isoDate, buyRate, sellRate };
}

export function buildBcbPtaxDayUrl(isoDate: string): string {
  const bcbDate = toBcbDateParam(isoDate);
  return (
    `${PTAX_BCB_API_BASE}/` +
    `CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${bcbDate}'&$format=json`
  );
}

/** Busca PTAX compra/venda do BCB para uma data ISO (sem fallback). */
export async function fetchPtaxBcbRatesForDate(
  isoDate: string,
  fetchImpl: typeof fetch = fetch
): Promise<PtaxBcbRates | null> {
  const url = buildBcbPtaxDayUrl(isoDate);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { value?: BcbPtaxRow[] };
  return parseBcbPtaxDayResponse(isoDate, data);
}

/**
 * Busca PTAX compra/venda; tenta dias anteriores se não houver cotação na data pedida.
 * Retorna a data efetiva da cotação encontrada.
 */
export async function resolvePtaxBcbRates(
  isoDate: string,
  fetchImpl: typeof fetch = fetch
): Promise<PtaxBcbRates | null> {
  const cached = ptaxRatesCache.get(isoDate);
  if (cached !== undefined) return cached;

  let cursor = isoDate;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const hit = ptaxRatesCache.get(cursor);
    if (hit !== undefined) {
      ptaxRatesCache.set(isoDate, hit);
      return hit;
    }

    try {
      const rates = await fetchPtaxBcbRatesForDate(cursor, fetchImpl);
      if (rates != null) {
        ptaxRatesCache.set(cursor, rates);
        ptaxRatesCache.set(isoDate, rates);
        ptaxSellCache.set(cursor, rates.sellRate);
        ptaxSellCache.set(isoDate, rates.sellRate);
        return rates;
      }
    } catch {
      // tenta dia anterior
    }

    cursor = previousIsoDate(cursor);
  }

  ptaxRatesCache.set(isoDate, null);
  ptaxSellCache.set(isoDate, null);
  return null;
}

/** Busca PTAX venda para a data; tenta dias úteis anteriores se não houver cotação. */
export async function resolvePtaxUsdSellRate(isoDate: string): Promise<number | null> {
  const cached = ptaxSellCache.get(isoDate);
  if (cached !== undefined) return cached;

  const rates = await resolvePtaxBcbRates(isoDate);
  return rates?.sellRate ?? null;
}

export async function resolvePtaxRatesByDate(
  dates: string[]
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  await Promise.all(
    dates.map(async (date) => {
      map.set(date, await resolvePtaxUsdSellRate(date));
    })
  );
  return map;
}

/** Limpa cache — útil em testes. */
export function clearMaterialMarketPtaxCache(): void {
  ptaxSellCache.clear();
  ptaxRatesCache.clear();
}
