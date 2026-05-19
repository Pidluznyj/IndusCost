/**
 * Smoke test read-only da Manutenção Nomus (sem alterar ProductBOM).
 *
 * Uso: npm run test:nomus:maintenance-smoke -- --parentCode=610.73BA
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildEffectivePricingBomForParentCode } from "../src/lib/nomusEffectivePricingBom.ts";
import { buildNomusEffectiveBomCostImpact } from "../src/lib/nomusEffectiveBomCostImpact.ts";
import { buildNomusBomApplyPlansReport } from "../src/lib/nomusBomApplyPlanLoad.ts";
import { getPricingOptionalStatusForParent } from "../src/lib/nomusOptionalPricingSelection.ts";

const prisma = new PrismaClient();

function parseParentCode(): string | null {
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--parentCode=(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

async function main(): Promise<void> {
  const parentCode = parseParentCode();
  if (!parentCode) {
    console.error("[nomus-maintenance-smoke] --parentCode é obrigatório.");
    process.exitCode = 1;
    return;
  }

  console.warn(`[nomus-maintenance-smoke] parentCode=${parentCode}`);

  const productBomCount = await prisma.productBOM.count();
  console.warn(`[nomus-maintenance-smoke] ProductBOM count=${productBomCount}`);

  const optionalStatus = await getPricingOptionalStatusForParent(parentCode);
  console.warn(`[nomus-maintenance-smoke] optionalStatus=${optionalStatus}`);

  const effectiveBom = await buildEffectivePricingBomForParentCode(parentCode);
  console.warn(
    `[nomus-maintenance-smoke] effectiveBom status=${effectiveBom.status} included=${effectiveBom.summary?.includedLinesCount ?? 0} localPending=${effectiveBom.summary?.localReviewPendingCount ?? 0}`
  );

  const localIncluded = (effectiveBom.directLines ?? []).filter(
    (l) => l.source === "LOCAL_ONLY_INCLUDED_BY_REVIEW"
  );
  for (const line of localIncluded) {
    console.warn(
      `[nomus-maintenance-smoke] local included: ${line.componentCode} qty=${line.quantity ?? "—"}`
    );
  }

  const costImpact = await buildNomusEffectiveBomCostImpact(parentCode);
  console.warn(
    `[nomus-maintenance-smoke] costImpact status=${costImpact.status} delta=${costImpact.delta?.totalCost ?? "—"}`
  );
  const assemblyLine = (costImpact.lines ?? []).find((l) =>
    l.componentCode.startsWith("800.")
  );
  if (assemblyLine) {
    console.warn(
      `[nomus-maintenance-smoke] assembly line ${assemblyLine.componentCode}: current=${assemblyLine.currentCost} effective=${assemblyLine.effectiveCost} status=${assemblyLine.status}`
    );
  }

  const applyPlan = await buildNomusBomApplyPlansReport({
    parentCode,
    limit: 1,
    offset: 0,
  });
  const plan = applyPlan.plans?.[0];
  console.warn(
    `[nomus-maintenance-smoke] applyPlan plans=${applyPlan.plans?.length ?? 0} actionClass=${plan?.classification?.actionClass ?? "—"}`
  );

  console.warn("[nomus-maintenance-smoke] OK");
}

main()
  .catch((err) => {
    console.error("[nomus-maintenance-smoke] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
