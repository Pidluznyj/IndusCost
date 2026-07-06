#!/usr/bin/env npx tsx
/**
 * Auditoria read-only — impacto de performance (ciclo/cavidades) em novo DRAFT vs publicado.
 *
 * Modo simulação (sem banco):
 *   npx tsx scripts/audit-component-performance-cost-impact.ts \
 *     --before-cycle=64 --after-cycle=90 --before-cavities=24 --after-cavities=16
 *
 * Modo banco (compara campos vivos, snapshot publicado e preview):
 *   npx tsx scripts/audit-component-performance-cost-impact.ts --sku=309.86AA --json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { createProductCostAnalysisEngine } from "../src/lib/productCostAnalysisEngine.server.ts";
import { evaluateProductEngineeringCost } from "../src/lib/productEngineeringCostSnapshot.server.ts";
import { computeStandardProcessUnitCosts } from "../src/lib/componentStandardProcessCost.ts";
import {
  extractProductionCostProcessPerformanceFromAnalysis,
  PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE,
} from "../src/lib/productionCostCalculationSnapshotAudit.ts";
import { parseArg, hasFlag, requireDatabaseUrl } from "./commission-audit-args.ts";

const DEFAULT_HH = 25;
const DEFAULT_HM = 50000 / 220;

function readNumberArg(name: string): number | null {
  const raw = parseArg(name)?.trim();
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function simulateProcessCost(cycle: number, cavities: number) {
  const result = computeStandardProcessUnitCosts({
    cycleTimeSeconds: cycle,
    cavities,
    efficiencyExpectedPercent: 100,
    setupTimeMin: 0,
    lotSize: 1,
    globalHhCostPerHour: DEFAULT_HH,
    machineHourCostPerHour: DEFAULT_HM,
  });
  if (!result.ok) {
    return { ok: false as const, errorCode: result.errorCode, message: result.message };
  }
  return {
    ok: true as const,
    cycleTimeSeconds: cycle,
    cavities,
    totalHH_Unit: result.totalHH_Unit,
    totalHM_Unit: result.totalHM_Unit,
    totalProcessCost: result.totalHH_Unit + result.totalHM_Unit,
    netPiecesPerHour: result.netPph,
  };
}

async function main(): Promise<void> {
  const json = hasFlag("json");
  const sku = parseArg("sku")?.trim() || null;
  const productIdArg = parseArg("productId")?.trim() || null;
  const beforeCycle = readNumberArg("before-cycle");
  const afterCycle = readNumberArg("after-cycle");
  const beforeCavities = readNumberArg("before-cavities");
  const afterCavities = readNumberArg("after-cavities");

  const hasSimulation =
    beforeCycle != null ||
    afterCycle != null ||
    beforeCavities != null ||
    afterCavities != null;

  const simulation = hasSimulation
    ? {
        before: simulateProcessCost(beforeCycle ?? 64, beforeCavities ?? 24),
        after: simulateProcessCost(afterCycle ?? 90, afterCavities ?? 16),
      }
    : null;

  let dbPayload: Record<string, unknown> | null = null;

  if (sku || productIdArg) {
    requireDatabaseUrl();
    await prisma.$connect();

    const product = productIdArg
      ? await prisma.product.findUnique({
          where: { id: productIdArg },
          select: {
            id: true,
            sku: true,
            name: true,
            type: true,
            cycleTimeSeconds: true,
            cavities: true,
            efficiencyExpected: true,
            setupTimeMin: true,
          },
        })
      : await prisma.product.findUnique({
          where: { sku: sku! },
          select: {
            id: true,
            sku: true,
            name: true,
            type: true,
            cycleTimeSeconds: true,
            cavities: true,
            efficiencyExpected: true,
            setupTimeMin: true,
          },
        });

    if (!product) {
      console.error("Produto não encontrado.");
      process.exit(1);
    }

    const publishedItem = await prisma.productionCostTableItem.findFirst({
      where: {
        productId: product.id,
        costTableVersion: { status: "PUBLISHED" },
      },
      orderBy: [
        { costTableVersion: { effectiveDate: "desc" } },
        { costTableVersion: { revision: "desc" } },
      ],
      include: { costTableVersion: true },
    });

    const engine = createProductCostAnalysisEngine(prisma);
    const live = await evaluateProductEngineeringCost(prisma, engine, product.id);
    const livePerformance = live.analysis
      ? extractProductionCostProcessPerformanceFromAnalysis(live.analysis)
      : null;
    const publishedSnapshot = readSnapshot(publishedItem?.calculationSnapshot);
    const publishedPerformance = readSnapshot(publishedSnapshot.processPerformance);

    dbPayload = {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        type: product.type,
        liveFields: {
          cycleTimeSeconds: product.cycleTimeSeconds,
          cavities: product.cavities,
          efficiencyExpected: product.efficiencyExpected,
          setupTimeMin: product.setupTimeMin,
        },
      },
      published: publishedItem
        ? {
            versionCode: publishedItem.costTableVersion.code,
            revision: publishedItem.costTableVersion.revision,
            status: publishedItem.costTableVersion.status,
            unitProductionCost: Number(publishedItem.unitProductionCost),
            calculationHash: publishedItem.calculationHash,
            calculatedAt: publishedSnapshot.calculatedAt ?? null,
            processPerformance: publishedPerformance,
          }
        : null,
      liveEngineNow: {
        calculable: live.calculable,
        unitProductionCost: live.resolved.ok ? live.resolved.finalUnitCost : null,
        calculationHash: live.calculationHash,
        processPerformance: livePerformance,
        differsFromPublished:
          publishedItem != null &&
          live.calculationHash != null &&
          publishedItem.calculationHash !== live.calculationHash,
      },
      notice: PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE,
    };
  }

  const payload = {
    mode: dbPayload ? (simulation ? "simulation+database" : "database") : "simulation",
    readOnly: true,
    notice: PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE,
    simulation: simulation
      ? {
          before: simulation.before,
          after: simulation.after,
          delta:
            simulation.before.ok && simulation.after.ok
              ? {
                  totalProcessCost:
                    simulation.after.totalProcessCost - simulation.before.totalProcessCost,
                  totalHH_Unit: simulation.after.totalHH_Unit - simulation.before.totalHH_Unit,
                  totalHM_Unit: simulation.after.totalHM_Unit - simulation.before.totalHM_Unit,
                }
              : null,
        }
      : null,
    database: dbPayload,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("=== Auditoria — performance operacional × custo de produção ===\n");
  console.log(PRODUCTION_COST_PROCESS_PERFORMANCE_LIVE_NOTICE);
  console.log("Modo: somente leitura — nenhum dado de produção é alterado.\n");

  if (simulation) {
    console.log("Simulação HH/HM (helper oficial, HH=25 HM≈227.27):");
    if (simulation.before.ok) {
      console.log(
        `  Antes: ciclo=${simulation.before.cycleTimeSeconds}s cavidades=${simulation.before.cavities} → HH+HM=${simulation.before.totalProcessCost.toFixed(6)}`
      );
    } else {
      console.log(`  Antes: erro ${simulation.before.errorCode} — ${simulation.before.message}`);
    }
    if (simulation.after.ok) {
      console.log(
        `  Depois: ciclo=${simulation.after.cycleTimeSeconds}s cavidades=${simulation.after.cavities} → HH+HM=${simulation.after.totalProcessCost.toFixed(6)}`
      );
    } else {
      console.log(`  Depois: erro ${simulation.after.errorCode} — ${simulation.after.message}`);
    }
    if (simulation.before.ok && simulation.after.ok && payload.simulation?.delta) {
      const delta = payload.simulation.delta;
      console.log(
        `  Δ processo: ${delta.totalProcessCost >= 0 ? "+" : ""}${delta.totalProcessCost.toFixed(6)} (HH ${delta.totalHH_Unit.toFixed(6)}, HM ${delta.totalHM_Unit.toFixed(6)})`
      );
    }
    console.log("");
  }

  if (dbPayload) {
    const p = dbPayload.product as Record<string, unknown>;
    const liveFields = p.liveFields as Record<string, unknown>;
    console.log(`Produto: [${p.sku}] ${p.name} (${p.type})`);
    console.log(
      `Campos vivos: ciclo=${String(liveFields.cycleTimeSeconds ?? "—")} cavidades=${String(liveFields.cavities ?? "—")}`
    );
    const published = dbPayload.published as Record<string, unknown> | null;
    if (published) {
      const perf = readSnapshot(published.processPerformance);
      console.log(
        `Publicado ${published.versionCode} rev.${published.revision}: R$ ${Number(published.unitProductionCost).toFixed(6)} hash=${published.calculationHash}`
      );
      console.log(
        `  Snapshot congelado: ciclo=${String(perf.cycleTimeSeconds ?? "—")} cavidades=${String(perf.cavities ?? "—")} em ${String(published.calculatedAt ?? "—")}`
      );
    } else {
      console.log("Nenhum item publicado encontrado.");
    }
    const liveNow = dbPayload.liveEngineNow as Record<string, unknown>;
    const livePerf = readSnapshot(liveNow.processPerformance);
    console.log(
      `Motor vivo agora: calculável=${String(liveNow.calculable)} custo=${liveNow.unitProductionCost ?? "—"} hash=${liveNow.calculationHash ?? "—"}`
    );
    console.log(
      `  Performance viva: ciclo=${String(livePerf.cycleTimeSeconds ?? "—")} cavidades=${String(livePerf.cavities ?? "—")}`
    );
    console.log(
      `  Difere do publicado: ${liveNow.differsFromPublished === true ? "SIM (novo DRAFT refletiria mudança)" : "não"}`
    );
  } else if (!simulation) {
    console.error(
      "Informe --sku/--productId (banco) ou parâmetros --before-cycle/--after-cycle para simulação."
    );
    process.exit(1);
  }

  console.log("\n--- JSON ---");
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error("[audit-component-performance-cost-impact]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
