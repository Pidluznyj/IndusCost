/**
 * Smoke test read-only do Plano de Ação de Equalização.
 *
 * Não altera ProductBOM, Product, Material, preço, propostas ou pedidos.
 *
 * Uso:
 *   npm run test:nomus:engineering-action-plan
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildNomusEngineeringOperationsCockpit } from "../src/lib/nomusEngineeringOperationsCockpit.ts";
import { buildNomusEngineeringEqualizationActionPlan } from "../src/lib/nomusEngineeringEqualizationActionPlan.ts";

const prisma = new PrismaClient();

const PILOTS = ["611.48AA", "317.02AA"];

function log(msg: string): void {
  console.warn(`[action-plan-smoke] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[action-plan-smoke] FALHA: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function checkPilot(parentCode: string): Promise<void> {
  log(`> ${parentCode}…`);
  const plan = await buildNomusEngineeringEqualizationActionPlan({
    parentCode,
    includeCostImpact: true,
    includeApplyPreview: true,
  });

  if (plan.mode !== "READ_ONLY") {
    fail(`${parentCode}: mode esperado READ_ONLY, recebido ${plan.mode}`);
  }
  if (!Array.isArray(plan.steps)) {
    fail(`${parentCode}: steps deve ser array.`);
  }

  log(
    `${parentCode} · readiness=${plan.readiness} nextAction=${plan.nextRecommendedAction} status=${plan.operatorStatusLabel} severity=${plan.severity}`
  );
  log(
    `${parentCode} · existsInIndusCost=${plan.existsInIndusCost} existsInNomusStage=${plan.existsInNomusStage} costingMode=${plan.product.costingMode ?? "—"}`
  );
  log(`${parentCode} · summary: ${plan.summary}`);

  if (plan.localExceptionSummary.hasAssemblyLocal) {
    log(
      `${parentCode} · montagem local preservada (${plan.localExceptionSummary.assemblyLocalLines.length} linha(s) 800.xx)`
    );
  }

  if (parentCode === "611.48AA" && plan.costImpactSummary) {
    if (
      plan.costImpactSummary.hasStructuralChanges === false &&
      plan.costImpactSummary.deltaTotalCost != null &&
      Math.abs(plan.costImpactSummary.deltaTotalCost) > 0.0001
    ) {
      fail(
        `611.48AA: sem mudanças estruturais mas delta.totalCost=${plan.costImpactSummary.deltaTotalCost}.`
      );
    }
    log(
      `611.48AA · impact hasStructural=${plan.costImpactSummary.hasStructuralChanges} delta=${plan.costImpactSummary.deltaTotalCost ?? "—"}`
    );
  }

  if (parentCode === "317.02AA") {
    log(`317.02AA · costingMode=${plan.product.costingMode ?? "—"}`);
    if (plan.product.costingMode !== "FINISHING_SERVICE") {
      log(
        "317.02AA · teste manual pendente: confirmar costingMode = FINISHING_SERVICE pela UI."
      );
    }
  }

  if (plan.blockers.length > 0) {
    log(`${parentCode} · blockers: ${plan.blockers.join(" | ")}`);
  }
}

async function checkCockpitProduct(): Promise<void> {
  log("> primeira página da Central (CHANGED_ONLY, limit=10)…");
  const cockpit = await buildNomusEngineeringOperationsCockpit({
    scope: "CHANGED_ONLY",
    limit: 10,
    offset: 0,
  });
  const candidate = cockpit.rows[0];
  if (!candidate) {
    log("Central vazia para CHANGED_ONLY — sem candidato extra para validar.");
    return;
  }
  log(`> candidato cockpit: ${candidate.parentCode}`);
  const plan = await buildNomusEngineeringEqualizationActionPlan({
    parentCode: candidate.parentCode,
    includeCostImpact: false,
    includeApplyPreview: true,
  });
  if (plan.mode !== "READ_ONLY") {
    fail(`${candidate.parentCode}: mode esperado READ_ONLY, recebido ${plan.mode}`);
  }
  log(
    `${candidate.parentCode} · readiness=${plan.readiness} nextAction=${plan.nextRecommendedAction}`
  );
}

async function main(): Promise<void> {
  log("iniciando…");

  for (const sku of PILOTS) {
    try {
      await checkPilot(sku);
    } catch (err) {
      log(
        `${sku} · não foi possível executar: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  try {
    await checkCockpitProduct();
  } catch (err) {
    log(
      `cockpit candidate · não foi possível executar: ${err instanceof Error ? err.message : err}`
    );
  }

  if (process.exitCode === 1) {
    log("FINALIZADO COM FALHAS — ver mensagens acima.");
  } else {
    log("OK — smoke read-only concluído.");
  }
}

main()
  .catch((err) => {
    console.error(
      "[action-plan-smoke] erro fatal:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
