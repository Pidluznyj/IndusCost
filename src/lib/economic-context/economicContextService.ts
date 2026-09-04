import { createTtlMemoryCache } from "@/src/lib/company-intelligence/memoryCache.js";
import { resolvePtaxBcbRates } from "@/src/lib/materialMarketPtax.js";
import {
  BCB_SGS_IPCA_12M,
  BCB_SGS_SELIC_TARGET,
  fetchBcbSgsLatest,
} from "./bcbSgs.js";
import { EUR_PTAX_NAME, resolveEurPtaxSellRate } from "./bcbPtaxEur.js";
import {
  ECONOMIC_CONTEXT_DISCLAIMER,
  type EconomicContextPayload,
  type EconomicIndicatorView,
} from "./economicContextTypes.js";

export const ECONOMIC_CONTEXT_TTL_MS = 60 * 60 * 1000;
export const ECONOMIC_CONTEXT_CACHE_KEY = "br-macro";

const economicCache = createTtlMemoryCache<EconomicContextPayload>(ECONOMIC_CONTEXT_TTL_MS);

export function resetEconomicContextCache(): void {
  economicCache.clear();
}

function saoPauloIsoDate(at = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatPercent(value: number, digits = 2): string {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function unavailableIndicator(
  code: EconomicIndicatorView["code"],
  name: string,
  unit: string
): EconomicIndicatorView {
  return {
    code,
    name,
    value: null,
    unit,
    referenceDate: null,
    displayValue: "—",
    status: "unavailable",
    source: "Banco Central do Brasil",
  };
}

async function loadEconomicContext(fetchImpl?: typeof fetch): Promise<EconomicContextPayload> {
  const todayIso = saoPauloIsoDate();
  const fetchedAt = new Date().toISOString();

  const [selic, ipca, usd, eur] = await Promise.allSettled([
    fetchBcbSgsLatest(BCB_SGS_SELIC_TARGET.code, { fetchImpl, todayIso, lastN: 5, rangeDays: 40 }),
    fetchBcbSgsLatest(BCB_SGS_IPCA_12M.code, { fetchImpl, todayIso, lastN: 6, rangeDays: 400 }),
    resolvePtaxBcbRates(todayIso, fetchImpl),
    resolveEurPtaxSellRate(todayIso, fetchImpl),
  ]);

  const indicators: EconomicIndicatorView[] = [
    selic.status === "fulfilled" && selic.value
      ? {
          code: "SELIC_TARGET",
          name: BCB_SGS_SELIC_TARGET.name,
          value: selic.value.value,
          unit: BCB_SGS_SELIC_TARGET.unit,
          referenceDate: selic.value.referenceDate,
          displayValue: `${formatPercent(selic.value.value)} a.a.`,
          status: "ok",
          source: "BCB SGS 432",
        }
      : unavailableIndicator("SELIC_TARGET", BCB_SGS_SELIC_TARGET.name, BCB_SGS_SELIC_TARGET.unit),
    ipca.status === "fulfilled" && ipca.value
      ? {
          code: "IPCA_12M",
          name: BCB_SGS_IPCA_12M.name,
          value: ipca.value.value,
          unit: BCB_SGS_IPCA_12M.unit,
          referenceDate: ipca.value.referenceDate,
          displayValue: formatPercent(ipca.value.value),
          status: "ok",
          source: "BCB SGS 13522",
        }
      : unavailableIndicator("IPCA_12M", BCB_SGS_IPCA_12M.name, BCB_SGS_IPCA_12M.unit),
    usd.status === "fulfilled" && usd.value
      ? {
          code: "USD_PTAX_SELL",
          name: "USD / PTAX — cotação de venda",
          value: usd.value.sellRate,
          unit: "BRL por USD",
          referenceDate: usd.value.quoteDate,
          displayValue: formatMoney(usd.value.sellRate),
          status: "ok",
          source: "BCB PTAX (Olinda CotacaoDolarDia)",
        }
      : unavailableIndicator("USD_PTAX_SELL", "USD / PTAX — cotação de venda", "BRL por USD"),
    eur.status === "fulfilled" && eur.value
      ? {
          code: "EUR_PTAX_SELL",
          name: EUR_PTAX_NAME,
          value: eur.value.sellRate,
          unit: "BRL por EUR",
          referenceDate: eur.value.quoteDate,
          displayValue: formatMoney(eur.value.sellRate),
          status: "ok",
          source: "BCB PTAX (Olinda CotacaoMoedaDia, Fechamento)",
        }
      : unavailableIndicator("EUR_PTAX_SELL", EUR_PTAX_NAME, "BRL por EUR"),
  ];

  const okCount = indicators.filter((row) => row.status === "ok").length;
  const status = okCount === 0 ? "unavailable" : okCount === indicators.length ? "ok" : "partial";

  console.info(
    `[economic-context] source=BCB status=${status} ok=${okCount}/${indicators.length}`
  );

  return {
    status,
    fetchedAt,
    fromCache: false,
    sourceLabel: "Banco Central do Brasil",
    disclaimer: ECONOMIC_CONTEXT_DISCLAIMER,
    indicators,
  };
}

export async function getEconomicContext(options?: {
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
}): Promise<EconomicContextPayload> {
  if (options?.forceRefresh) {
    economicCache.deleteKey(ECONOMIC_CONTEXT_CACHE_KEY);
  }
  const cached = economicCache.get(ECONOMIC_CONTEXT_CACHE_KEY);
  if (cached) {
    return { ...cached, fromCache: true };
  }
  return economicCache.getOrLoad(ECONOMIC_CONTEXT_CACHE_KEY, () =>
    loadEconomicContext(options?.fetchImpl)
  );
}

export async function getEconomicContextSafe(options?: {
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
}): Promise<EconomicContextPayload> {
  try {
    return await getEconomicContext(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha";
    console.info(`[economic-context] unavailable reason=${message}`);
    return {
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      sourceLabel: "Banco Central do Brasil",
      disclaimer: ECONOMIC_CONTEXT_DISCLAIMER,
      indicators: [
        unavailableIndicator("SELIC_TARGET", BCB_SGS_SELIC_TARGET.name, BCB_SGS_SELIC_TARGET.unit),
        unavailableIndicator("IPCA_12M", BCB_SGS_IPCA_12M.name, BCB_SGS_IPCA_12M.unit),
        unavailableIndicator("USD_PTAX_SELL", "USD / PTAX — cotação de venda", "BRL por USD"),
        unavailableIndicator("EUR_PTAX_SELL", EUR_PTAX_NAME, "BRL por EUR"),
      ],
    };
  }
}
