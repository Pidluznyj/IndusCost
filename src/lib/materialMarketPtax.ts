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

/**
 * O BCB só publica a PTAX de fechamento do dia por volta das 13h. Antes disso a
 * consulta do próprio dia volta vazia e caímos no dia anterior — uma resposta
 * **provisória**, que muda assim que o BCB publica.
 *
 * Por isso o cache é dividido: o que o BCB publicou para uma data exata é fato
 * imutável e vale para sempre; tudo que veio de fallback (ou de uma ausência de
 * cotação) é provisório e expira. Misturar os dois congelava a cotação: a
 * resposta provisória da coleta das 09:00 virava permanente e contaminava todos
 * os dias seguintes, que caíam nela ao recuar um dia.
 *
 * A memória do provisório existe só para deduplicar rajadas de consultas (uma
 * página que resolve dezenas de datas de uma vez). Por isso vive segundos, não
 * minutos: nunca pode atravessar duas coletas nem dois cliques em "Atualizar".
 */
const PTAX_PROVISIONAL_TTL_MS = 60_000;

/** Cotações que o BCB publicou para a data exata — fato histórico imutável. */
const ptaxPublishedCache = new Map<string, PtaxBcbRates>();
/** Datas em que o BCB respondeu "sem cotação" — provisório enquanto o dia corre. */
const ptaxAbsenceMemo = new Map<string, number>();
/** Resolução por fallback de uma data pedida — provisória por definição. */
const ptaxResolutionMemo = new Map<string, { value: PtaxBcbRates | null; expiresAt: number }>();

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
 * Guarda a resolução de `isoDate`. Só é definitiva quando o próprio BCB
 * publicou `isoDate` — aí ela já está em `ptaxPublishedCache`. Resolução vinda
 * de fallback fica com prazo de validade para não congelar a cotação.
 */
function rememberResolution(
  isoDate: string,
  resolvedDate: string,
  rates: PtaxBcbRates,
  now: number
): PtaxBcbRates {
  if (resolvedDate !== isoDate) {
    ptaxResolutionMemo.set(isoDate, {
      value: rates,
      expiresAt: now + PTAX_PROVISIONAL_TTL_MS,
    });
  }
  return rates;
}

function readValidMemo<T>(memo: Map<string, { value: T; expiresAt: number }>, key: string, now: number) {
  const entry = memo.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    memo.delete(key);
    return null;
  }
  return entry;
}

function hasFreshAbsence(isoDate: string, now: number): boolean {
  const expiresAt = ptaxAbsenceMemo.get(isoDate);
  if (expiresAt == null) return false;
  if (expiresAt <= now) {
    ptaxAbsenceMemo.delete(isoDate);
    return false;
  }
  return true;
}

/**
 * Busca PTAX compra/venda; tenta dias anteriores se não houver cotação na data pedida.
 * Retorna a data efetiva da cotação encontrada.
 */
export async function resolvePtaxBcbRates(
  isoDate: string,
  fetchImpl: typeof fetch = fetch
): Promise<PtaxBcbRates | null> {
  const published = ptaxPublishedCache.get(isoDate);
  if (published) return published;

  const now = Date.now();
  const memo = readValidMemo(ptaxResolutionMemo, isoDate, now);
  if (memo) return memo.value;

  let cursor = isoDate;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const cachedForCursor = ptaxPublishedCache.get(cursor);
    if (cachedForCursor) return rememberResolution(isoDate, cursor, cachedForCursor, now);

    if (!hasFreshAbsence(cursor, now)) {
      try {
        const rates = await fetchPtaxBcbRatesForDate(cursor, fetchImpl);
        if (rates != null) {
          ptaxPublishedCache.set(cursor, rates);
          return rememberResolution(isoDate, cursor, rates, now);
        }
        ptaxAbsenceMemo.set(cursor, now + PTAX_PROVISIONAL_TTL_MS);
      } catch {
        // erro de rede: não memoriza nada e tenta o dia anterior
      }
    }

    cursor = previousIsoDate(cursor);
  }

  ptaxResolutionMemo.set(isoDate, { value: null, expiresAt: now + PTAX_PROVISIONAL_TTL_MS });
  return null;
}

/** Busca PTAX venda para a data; tenta dias úteis anteriores se não houver cotação. */
export async function resolvePtaxUsdSellRate(isoDate: string): Promise<number | null> {
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

/**
 * Descarta só o que é provisório, preservando o histórico já publicado pelo
 * BCB. Usado pela coleta manual para que o botão "Atualizar" sempre consulte a
 * fonte de verdade em vez de repetir a resposta memorizada.
 */
export function invalidateProvisionalPtaxCache(): void {
  ptaxAbsenceMemo.clear();
  ptaxResolutionMemo.clear();
}

/** Limpa cache — útil em testes. */
export function clearMaterialMarketPtaxCache(): void {
  ptaxPublishedCache.clear();
  ptaxAbsenceMemo.clear();
  ptaxResolutionMemo.clear();
}
