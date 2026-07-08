/**
 * Carrega dados read-only para simulação de mercado por matéria-prima.
 */
import type { PrismaClient } from "@prisma/client";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import {
  buildMaterialMarketSimulationResponse,
  parseMaterialMarketSimulationRequest,
  resolveCurrentMaterialPriceBRL,
  resolveSimulatedMaterialPriceBRL,
  type MaterialMarketSimulationRequest,
  type MaterialMarketSimulationResponse,
} from "./materialMarketSimulation.js";
import { buildMaterialProductFinancialImpactForApi } from "./materialProductFinancialImpact.server.js";

export type { MaterialMarketSimulationRequest, MaterialMarketSimulationResponse };

export { parseMaterialMarketSimulationRequest };

export function createPrismaMaterialMarketSimulationLoader(
  prisma: PrismaClient,
  getProductCostAnalysis: (productId: string) => Promise<unknown>
) {
  return {
    getProductCostAnalysis,
    prisma,
  };
}

export async function buildMaterialMarketSimulationForMaterial(
  prisma: PrismaClient,
  engine: ProductCostAnalysisEngine,
  materialId: string,
  request: MaterialMarketSimulationRequest
): Promise<MaterialMarketSimulationResponse | { error: string; status: number }> {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    include: {
      MaterialMarketQuote: {
        orderBy: [{ quoteDate: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  if (!material) {
    return { error: "Material não encontrado.", status: 404 };
  }

  const currentPrice = resolveCurrentMaterialPriceBRL({
    currentCost: material.currentCost,
    quotes: material.MaterialMarketQuote,
    manualUsd: request.manualUsd,
  });

  if (currentPrice == null || currentPrice <= 0) {
    return { error: "Preço atual indisponível para simulação.", status: 400 };
  }

  const simulated = resolveSimulatedMaterialPriceBRL({
    mode: request.mode,
    value: request.value,
    currentPriceBRL: currentPrice,
    quotes: material.MaterialMarketQuote,
    manualUsd: request.manualUsd,
  });

  const financial = await buildMaterialProductFinancialImpactForApi(prisma, {
    materialId: material.id,
    currentCost: material.currentCost,
    quotes: material.MaterialMarketQuote,
    baselineMaterialPriceBRL: currentPrice,
    simulatedMaterialPriceBRL: simulated.price,
  });

  return buildMaterialMarketSimulationResponse({
    currentPrice,
    simulatedPrice: simulated.price,
    simulationLabel: simulated.label,
    brentContextNote:
      request.manualBrent != null && Number.isFinite(request.manualBrent)
        ? `Brent informado (${request.manualBrent}) é apenas contextual nesta versão — não altera o preço simulado automaticamente.`
        : request.mode === "MANUAL_BRENT"
          ? "Modo Brent é informativo; o preço simulado segue o preço base até existir correlação de produto."
          : null,
    financial,
  });
}
