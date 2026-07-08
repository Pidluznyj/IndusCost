export const BRENT_YAHOO_SYMBOL = "BZ=F" as const;
export const BRENT_DEFAULT_SOURCE = "yahoo-finance" as const;

export type BrentQuoteFetchResult = {
  priceUSD: number;
  quoteDate: string;
  source: string;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
      };
    }>;
    error?: { description?: string };
  };
};

function roundBrentDecimal(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toIsoDateFromUnixSeconds(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) {
    return new Date().toISOString().slice(0, 10);
  }
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function parseBrentQuoteDateIso(dateIso: string): Date {
  return new Date(`${dateIso}T12:00:00.000Z`);
}

/** Variação percentual vs snapshot anterior bem-sucedido. */
export function calculateBrentVariationFromPrevious(
  currentPriceUSD: number,
  previousPriceUSD: number
): number | null {
  if (
    !Number.isFinite(currentPriceUSD) ||
    !Number.isFinite(previousPriceUSD) ||
    previousPriceUSD <= 0
  ) {
    return null;
  }
  const pct = ((currentPriceUSD - previousPriceUSD) / previousPriceUSD) * 100;
  return roundBrentDecimal(pct);
}

export async function fetchBrentQuoteFromYahoo(
  fetchImpl: typeof fetch = fetch
): Promise<BrentQuoteFetchResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(BRENT_YAHOO_SYMBOL)}?interval=1d&range=1d`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha de rede ao consultar Brent.";
    throw new Error(`Brent API indisponível: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`Brent API retornou HTTP ${response.status}.`);
  }

  let payload: YahooChartResponse;
  try {
    payload = (await response.json()) as YahooChartResponse;
  } catch {
    throw new Error("Brent API retornou JSON inválido.");
  }

  const chartError = payload.chart?.error?.description?.trim();
  if (chartError) {
    throw new Error(`Brent API: ${chartError}`);
  }

  const meta = payload.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (price == null || !Number.isFinite(price) || price <= 0) {
    throw new Error("Brent API não retornou preço válido.");
  }

  return {
    priceUSD: roundBrentDecimal(price),
    source: BRENT_DEFAULT_SOURCE,
    quoteDate: toIsoDateFromUnixSeconds(meta?.regularMarketTime),
  };
}
