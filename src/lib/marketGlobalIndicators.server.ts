import { prisma } from "@/src/lib/prisma.js";
import {
  mapMarketGlobalIndicators,
  type MarketGlobalIndicatorsDto,
} from "@/src/lib/marketGlobalIndicators.js";

export async function loadMarketGlobalIndicators(): Promise<MarketGlobalIndicatorsDto> {
  const [ptax, brent] = await Promise.all([
    prisma.ptaxSnapshot.findFirst({
      where: { status: "SUCCESS" },
      orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }],
    }),
    prisma.commoditySnapshot.findFirst({
      where: { commodityType: "BRENT", status: "SUCCESS" },
      orderBy: [{ quoteDate: "desc" }, { collectedAt: "desc" }],
    }),
  ]);

  return mapMarketGlobalIndicators({ ptax, brent });
}
