/**
 * Cotação PTAX USD/BRL (BCB) para conversão de cotações em dólar.
 */

const ptaxCache = new Map<string, number | null>();

function toBcbDateParam(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${m}-${d}-${y}`;
}

async function fetchPtaxForDate(isoDate: string): Promise<number | null> {
  const bcbDate = toBcbDateParam(isoDate);
  const url =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
    `CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${bcbDate}'&$format=json`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;

  const data = (await res.json()) as { value?: Array<{ cotacaoVenda?: number }> };
  const rate = data.value?.[0]?.cotacaoVenda;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

function previousIsoDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Busca PTAX venda para a data; tenta dias úteis anteriores se não houver cotação. */
export async function resolvePtaxUsdSellRate(isoDate: string): Promise<number | null> {
  const cached = ptaxCache.get(isoDate);
  if (cached !== undefined) return cached;

  let cursor = isoDate;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const hit = ptaxCache.get(cursor);
    if (hit !== undefined) {
      ptaxCache.set(isoDate, hit);
      return hit;
    }

    try {
      const rate = await fetchPtaxForDate(cursor);
      if (rate != null) {
        ptaxCache.set(cursor, rate);
        ptaxCache.set(isoDate, rate);
        return rate;
      }
    } catch {
      // tenta dia anterior
    }

    cursor = previousIsoDate(cursor);
  }

  ptaxCache.set(isoDate, null);
  return null;
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
  ptaxCache.clear();
}
