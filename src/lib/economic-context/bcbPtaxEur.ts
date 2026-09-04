import {
  BCB_HTTP_TIMEOUT_MS,
  KnownHostFetchError,
  fetchKnownHostJson,
} from "@/src/lib/company-intelligence/http.js";
import { PTAX_BCB_API_BASE, previousIsoDate, toBcbDateParam } from "@/src/lib/materialMarketPtax.js";

export const EUR_PTAX_NAME = "EUR / PTAX — cotação de venda (boletim de fechamento)";

type EurPtaxRow = {
  cotacaoCompra?: unknown;
  cotacaoVenda?: unknown;
  tipoBoletim?: unknown;
  dataHoraCotacao?: unknown;
};

function parseRate(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildEurPtaxDayUrl(isoDate: string): string {
  const bcbDate = toBcbDateParam(isoDate);
  return (
    `${PTAX_BCB_API_BASE}/` +
    `CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)` +
    `?@moeda='EUR'&@dataCotacao='${bcbDate}'&$format=json`
  );
}

export function pickEurPtaxClosingSell(
  isoDate: string,
  data: { value?: EurPtaxRow[] } | null | undefined
): { quoteDate: string; sellRate: number } | null {
  const rows = data?.value ?? [];
  if (!rows.length) return null;
  const closing =
    rows.find((row) => String(row.tipoBoletim ?? "").toLowerCase().includes("fechamento")) ??
    rows[rows.length - 1];
  if (!closing) return null;
  const sellRate = parseRate(closing.cotacaoVenda);
  if (sellRate == null) return null;
  return { quoteDate: isoDate, sellRate };
}

export async function resolveEurPtaxSellRate(
  isoDate: string,
  fetchImpl?: typeof fetch
): Promise<{ quoteDate: string; sellRate: number } | null> {
  let cursor = isoDate;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const { status, json } = await fetchKnownHostJson(buildEurPtaxDayUrl(cursor), {
        timeoutMs: BCB_HTTP_TIMEOUT_MS,
        fetchImpl,
      });
      if (status >= 200 && status < 300) {
        const parsed = pickEurPtaxClosingSell(cursor, json as { value?: EurPtaxRow[] });
        if (parsed) return parsed;
      }
    } catch (error) {
      if (error instanceof KnownHostFetchError && error.kind === "timeout") {
        return null;
      }
    }
    cursor = previousIsoDate(cursor);
  }
  return null;
}
