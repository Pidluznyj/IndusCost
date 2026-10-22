import { prisma } from "@/src/lib/prisma.js";
import {
  buildMarketGlobalIndicatorsHistory,
  historyQuoteDateBounds,
  historyWindow,
  type MarketGlobalIndicatorsHistoryDto,
  type MarketHistoryRange,
} from "@/src/lib/marketGlobalIndicatorsHistory.js";

const ptaxSelect = {
  id: true,
  status: true,
  quoteDate: true,
  buyRate: true,
  sellRate: true,
  source: true,
  collectedAt: true,
} as const;

const brentSelect = {
  id: true,
  status: true,
  quoteDate: true,
  priceUSD: true,
  source: true,
  collectedAt: true,
} as const;

/**
 * Lê snapshots SUCCESS já gravados. A janela pede também a cotação válida
 * imediatamente anterior, só para a variação diária do primeiro ponto.
 */
export async function loadMarketGlobalIndicatorsHistory(input: {
  range: MarketHistoryRange;
  now?: Date;
}): Promise<MarketGlobalIndicatorsHistoryDto> {
  const now = input.now ?? new Date();
  const window = historyWindow(input.range, now);
  const bounds = historyQuoteDateBounds(window.start, window.end);

  const [ptaxRows, ptaxPrior, brentRows, brentPrior] = await Promise.all([
    prisma.ptaxSnapshot.findMany({
      where: { status: "SUCCESS", quoteDate: { gte: bounds.gte, lte: bounds.lte } },
      select: ptaxSelect,
    }),
    prisma.ptaxSnapshot.findFirst({
      where: { status: "SUCCESS", quoteDate: { lt: bounds.priorBefore } },
      orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }, { id: "desc" }],
      select: ptaxSelect,
    }),
    prisma.commoditySnapshot.findMany({
      where: {
        commodityType: "BRENT",
        status: "SUCCESS",
        quoteDate: { gte: bounds.gte, lte: bounds.lte },
      },
      select: brentSelect,
    }),
    prisma.commoditySnapshot.findFirst({
      where: {
        commodityType: "BRENT",
        status: "SUCCESS",
        quoteDate: { lt: bounds.priorBefore },
      },
      orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }, { id: "desc" }],
      select: brentSelect,
    }),
  ]);

  return buildMarketGlobalIndicatorsHistory({
    range: input.range,
    now,
    ptaxRows: ptaxPrior ? [ptaxPrior, ...ptaxRows] : ptaxRows,
    brentRows: brentPrior ? [brentPrior, ...brentRows] : brentRows,
  });
}
