/**
 * Ticker executivo do header — leitura leve a partir dos snapshots de Inteligência de Mercado.
 * Sem coleta externa; sem dados financeiros internos.
 */
import type { MarketGlobalIndicatorsDto } from "./marketGlobalIndicators.js";

export const MARKET_HEADER_TICKER_API = "/api/market/header-ticker" as const;

/** PTAX: cotação diária BCB — alerta após 72h sem nova coleta. */
export const MARKET_HEADER_PTAX_STALE_MS = 72 * 60 * 60 * 1000;

/** Brent: coleta 2x/dia — alerta após 36h sem nova coleta. */
export const MARKET_HEADER_BRENT_STALE_MS = 36 * 60 * 60 * 1000;

/** Atualização do ticker no header (somente leitura). */
export const MARKET_HEADER_TICKER_POLL_MS = 15 * 60 * 1000;

export type MarketHeaderTickerPtax = {
  available: boolean;
  buy?: number;
  sell?: number;
  quoteDate?: string;
  collectedAt?: string;
  source?: string;
  stale?: boolean;
};

export type MarketHeaderTickerBrent = {
  available: boolean;
  priceUsd?: number;
  changePercent?: number;
  quoteDate?: string;
  collectedAt?: string;
  source?: string;
  stale?: boolean;
};

export type MarketHeaderTickerPayload = {
  ptax: MarketHeaderTickerPtax;
  brent: MarketHeaderTickerBrent;
};

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isMarketHeaderTickerStale(
  collectedAt: string | null | undefined,
  maxAgeMs: number,
  nowMs = Date.now()
): boolean {
  const ts = parseTimestamp(collectedAt);
  if (ts == null) return true;
  return nowMs - ts > maxAgeMs;
}

export function buildMarketHeaderPtaxTooltip(ptax: MarketHeaderTickerPtax): string {
  if (!ptax.available) {
    return "Sem cotação PTAX disponível. Os dados são coletados pela Inteligência de Mercado.";
  }
  const lines = [
    `PTAX Venda: ${ptax.sell != null ? `R$ ${ptax.sell.toFixed(4)}` : "—"}`,
    `PTAX Compra: ${ptax.buy != null ? `R$ ${ptax.buy.toFixed(4)}` : "—"}`,
    ptax.quoteDate ? `Data da cotação: ${ptax.quoteDate}` : null,
    ptax.collectedAt ? `Coletado em: ${new Date(ptax.collectedAt).toLocaleString("pt-BR")}` : null,
    ptax.source ? `Fonte: ${ptax.source}` : null,
    ptax.stale ? "Atualização antiga — verifique a Inteligência de Mercado." : null,
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildMarketHeaderBrentTooltip(brent: MarketHeaderTickerBrent): string {
  if (!brent.available) {
    return "Sem cotação Brent disponível. Os dados são coletados pela Inteligência de Mercado.";
  }
  const variation =
    brent.changePercent != null && Number.isFinite(brent.changePercent)
      ? `${brent.changePercent > 0 ? "+" : ""}${brent.changePercent.toFixed(2)}%`
      : "—";
  const lines = [
    `Preço: ${brent.priceUsd != null ? `US$ ${brent.priceUsd.toFixed(2)}` : "—"}`,
    `Variação: ${variation}`,
    brent.collectedAt ? `Coletado em: ${new Date(brent.collectedAt).toLocaleString("pt-BR")}` : null,
    brent.source ? `Fonte: ${brent.source}` : null,
    brent.stale ? "Atualização antiga — verifique a Inteligência de Mercado." : null,
  ];
  return lines.filter(Boolean).join("\n");
}

export function mapMarketGlobalIndicatorsToHeaderTicker(
  indicators: MarketGlobalIndicatorsDto,
  now = new Date()
): MarketHeaderTickerPayload {
  const nowMs = now.getTime();

  const ptax = indicators.ptax;
  const brent = indicators.brent;

  return {
    ptax: ptax
      ? {
          available: true,
          buy: ptax.buyRate,
          sell: ptax.sellRate,
          quoteDate: ptax.quoteDate,
          collectedAt: ptax.lastUpdate,
          source: ptax.source,
          stale: isMarketHeaderTickerStale(ptax.lastUpdate, MARKET_HEADER_PTAX_STALE_MS, nowMs),
        }
      : { available: false },
    brent: brent
      ? {
          available: true,
          priceUsd: brent.price,
          changePercent: brent.variationFromPrevious ?? undefined,
          quoteDate: brent.lastUpdate.slice(0, 10),
          collectedAt: brent.lastUpdate,
          source: brent.source,
          stale: isMarketHeaderTickerStale(brent.lastUpdate, MARKET_HEADER_BRENT_STALE_MS, nowMs),
        }
      : { available: false },
  };
}
