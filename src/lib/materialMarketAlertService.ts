/**
 * Persistência de alertas de mercado — integração Prisma.
 */

import type { PrismaClient } from "@prisma/client";
import {
  dedupeMaterialMarketAlertProposals,
  evaluateMaterialMarketAlerts,
  MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS,
  resolveAutoResolvableAlertTypes,
  shouldUpdateOpenMaterialMarketAlert,
  type MaterialMarketAlertProposal,
} from "./materialMarketAlertEngine.js";
import { toEngineThresholdsFromEffectiveConfig } from "./materialMarketAlertConfig.js";
import { loadEffectiveMaterialMarketAlertConfig } from "./materialMarketAlertConfig.server.js";
import { buildMaterialMarketSavingsOpportunityFromRows } from "./materialMarketSavingsOpportunity.js";

type DbClient = Pick<
  PrismaClient,
  | "material"
  | "materialMarketQuote"
  | "materialMarketAlert"
  | "materialMarketAlertGlobalConfig"
  | "materialMarketAlertConfig"
  | "materialMarketAlertConfigAudit"
>;

export async function loadMaterialMarketAlertEvaluationContext(
  db: DbClient,
  materialId: string
) {
  const material = await db.material.findUnique({
    where: { id: materialId },
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      currentCost: true,
      isMarketMonitored: true,
      marketMonitoringFrequencyDays: true,
    },
  });

  if (!material) return null;

  const quotes = await db.materialMarketQuote.findMany({
    where: { materialId },
    orderBy: [{ quoteDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      quoteDate: true,
      netPrice: true,
      supplierName: true,
      status: true,
    },
  });

  return { material, quotes };
}

export async function persistMaterialMarketAlertProposals(
  db: DbClient,
  proposals: MaterialMarketAlertProposal[]
): Promise<{ created: number; updated: number; resolved: number }> {
  const deduped = dedupeMaterialMarketAlertProposals(proposals);
  if (deduped.length === 0) {
    return { created: 0, updated: 0, resolved: 0 };
  }

  const materialId = deduped[0]!.materialId;
  const openAlerts = await db.materialMarketAlert.findMany({
    where: { materialId, status: { in: ["OPEN", "READ"] } },
  });

  let created = 0;
  let updated = 0;

  for (const proposal of deduped) {
    const existing = openAlerts.find((a) => a.alertType === proposal.alertType);
    if (existing) {
      if (
        shouldUpdateOpenMaterialMarketAlert(
          {
            title: existing.title,
            message: existing.message,
            metadata: existing.metadata,
          },
          proposal
        )
      ) {
        await db.materialMarketAlert.update({
          where: { id: existing.id },
          data: {
            title: proposal.title,
            message: proposal.message,
            severity: proposal.severity,
            metadata: proposal.metadata,
            triggeredAt: proposal.triggeredAt,
            status: existing.status === "READ" ? "READ" : "OPEN",
          },
        });
        updated += 1;
      }
      continue;
    }

    await db.materialMarketAlert.create({
      data: {
        materialId: proposal.materialId,
        alertType: proposal.alertType,
        title: proposal.title,
        message: proposal.message,
        severity: proposal.severity,
        metadata: proposal.metadata,
        triggeredAt: proposal.triggeredAt,
        status: "OPEN",
      },
    });
    created += 1;
  }

  const autoResolveTypes = resolveAutoResolvableAlertTypes(deduped);
  let resolved = 0;
  if (autoResolveTypes.length > 0) {
    const result = await db.materialMarketAlert.updateMany({
      where: {
        materialId,
        alertType: { in: autoResolveTypes },
        status: { in: ["OPEN", "READ"] },
      },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });
    resolved = result.count;
  }

  return { created, updated, resolved };
}

function appendSavingsOpportunityProposal(input: {
  material: {
    id: string;
    code: string;
    description: string;
    unit: string;
    currentCost: unknown;
  };
  quotes: Parameters<typeof buildMaterialMarketSavingsOpportunityFromRows>[0]["quotes"];
  referenceDate?: Date;
  proposals: MaterialMarketAlertProposal[];
}): MaterialMarketAlertProposal[] {
  const savings = buildMaterialMarketSavingsOpportunityFromRows({
    materialId: input.material.id,
    unit: input.material.unit,
    currentCost: input.material.currentCost as number | string,
    quotes: input.quotes,
    estimatedVolume: 1,
    period: "90d",
    referenceDate: input.referenceDate,
  });

  const threshold = MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.savingsOpportunityPercent;
  if (
    !savings.hasSavings ||
    savings.savingsPercent == null ||
    savings.savingsPercent < threshold ||
    savings.currentPrice == null ||
    savings.bestPrice == null
  ) {
    return input.proposals;
  }

  const formatBRL = (value: number) =>
    value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const savingsProposal: MaterialMarketAlertProposal = {
    materialId: input.material.id,
    alertType: "SAVINGS_OPPORTUNITY",
    title: "Oportunidade de economia",
    message: `Economia potencial de ${savings.savingsPercent.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% ao comparar ${formatBRL(savings.currentPrice)} (preço atual) com ${formatBRL(savings.bestPrice)} (${savings.recommendedSupplier ?? "melhor cotação"}).`,
    severity: "INFO",
    metadata: {
      materialCode: input.material.code,
      currentPrice: savings.currentPrice,
      bestPrice: savings.bestPrice,
      savingsPercent: savings.savingsPercent,
      recommendedSupplier: savings.recommendedSupplier,
      source: "materialMarketSavingsOpportunity",
    },
    triggeredAt: input.referenceDate ?? new Date(),
  };

  return dedupeMaterialMarketAlertProposals([...input.proposals, savingsProposal]);
}

export async function evaluateAndPersistMaterialMarketAlerts(
  db: DbClient,
  materialId: string,
  referenceDate?: Date
): Promise<{
  materialFound: boolean;
  monitored: boolean;
  proposals: MaterialMarketAlertProposal[];
  persistence: { created: number; updated: number; resolved: number };
}> {
  const context = await loadMaterialMarketAlertEvaluationContext(db, materialId);
  if (!context) {
    return {
      materialFound: false,
      monitored: false,
      proposals: [],
      persistence: { created: 0, updated: 0, resolved: 0 },
    };
  }

  const { material, quotes } = context;
  if (!material.isMarketMonitored) {
    return {
      materialFound: true,
      monitored: false,
      proposals: [],
      persistence: { created: 0, updated: 0, resolved: 0 },
    };
  }

  const effectiveConfig = await loadEffectiveMaterialMarketAlertConfig(db, materialId);
  if (!effectiveConfig.alertsEnabled) {
    return {
      materialFound: true,
      monitored: true,
      proposals: [],
      persistence: { created: 0, updated: 0, resolved: 0 },
    };
  }

  const engineThresholds = toEngineThresholdsFromEffectiveConfig(effectiveConfig);

  const proposals = appendSavingsOpportunityProposal({
    material,
    quotes,
    referenceDate,
    proposals: evaluateMaterialMarketAlerts({
      materialId: material.id,
      materialCode: material.code,
      materialDescription: material.description,
      isMarketMonitored: material.isMarketMonitored,
      alertsEnabled: effectiveConfig.alertsEnabled,
      marketMonitoringFrequencyDays: material.marketMonitoringFrequencyDays,
      quotes,
      referenceDate,
      thresholds: {
        ...engineThresholds,
        supplierAboveAvgPercent: MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.supplierAboveAvgPercent,
        savingsOpportunityPercent:
          MATERIAL_MARKET_ALERT_DEFAULT_THRESHOLDS.savingsOpportunityPercent,
      },
    }),
  });

  const persistence = await persistMaterialMarketAlertProposals(db, proposals);

  return {
    materialFound: true,
    monitored: true,
    proposals,
    persistence,
  };
}
