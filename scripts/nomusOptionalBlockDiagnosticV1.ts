/**
 * Diagnóstico read-only — opcionais bloqueando produtos (ex.: 309.71AA / 114.02).
 * Uso: tsx scripts/nomusOptionalBlockDiagnosticV1.ts [parentCode] [--sample=N]
 * Requer DATABASE_URL. Não altera dados.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { chooseEffectiveNomusList } from "../src/lib/nomusBomComparison";
import { loadNomusStageLinesForParent } from "../src/lib/nomusBomComparisonLoad";
import {
  computeUnassignedOptionalItems,
  getEffectiveNomusContext,
  loadGroupsForParent,
  buildOptionalSelectionStatus,
} from "../src/lib/nomusOptionalPricingSelection";
import { buildEffectivePricingBomForParentCode } from "../src/lib/nomusEffectivePricingBom";
import { buildControlledApplyPreview } from "../src/lib/nomusBomControlledApply";

const parentArg = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
const parentCode = parentArg ?? "309.71AA";
const sampleMatch = process.argv.find((a) => a.startsWith("--sample="));
const sampleSize = sampleMatch ? Number.parseInt(sampleMatch.split("=")[1] ?? "10", 10) : 10;

async function diagnoseParent(code: string) {
  const stageRows = await prisma.nomusBomComponentStage.findMany({
    where: { parentCode: { equals: code, mode: "insensitive" } },
    orderBy: [{ componentCode: "asc" }, { updatedAt: "desc" }],
    select: {
      externalLineId: true,
      componentCode: true,
      componentDescription: true,
      opcional: true,
      alternativo: true,
      preferencial: true,
      listaMateriaisId: true,
      listaMateriaisNome: true,
      listaMateriaisAtivo: true,
      listaMateriaisPadrao: true,
      isActiveDefault: true,
      runId: true,
      fetchedAt: true,
      syncedAt: true,
      updatedAt: true,
    },
  });

  const component114 = stageRows.filter((r) => r.componentCode === "114.02");
  const allLines = await loadNomusStageLinesForParent(code);
  const listSelection = chooseEffectiveNomusList(allLines);
  const effectiveCodes = new Set(listSelection.selectedLines.map((l) => l.componentCode));
  const optionalInEffective = listSelection.selectedLines.filter(
    (l) => l.opcional === true || l.alternativo === true
  );

  const ctx = await getEffectiveNomusContext(code);
  const groups = await loadGroupsForParent(code);
  const unassigned = ctx ? computeUnassignedOptionalItems(ctx.optionalItems, groups) : [];
  const optStatus = ctx
    ? buildOptionalSelectionStatus({
        optionalItems: ctx.optionalItems,
        unassignedOptionalItems: unassigned,
        groups,
      })
    : null;

  const optionalGroups = await prisma.nomusOptionalPricingGroup.findMany({
    where: { parentCode: { equals: code, mode: "insensitive" } },
    include: { choices: true },
    orderBy: { updatedAt: "desc" },
  });

  const effectiveBom = await buildEffectivePricingBomForParentCode(code).catch(() => null);
  const preview = await buildControlledApplyPreview(code).catch((e) => ({ error: String(e) }));

  const latestBomRun = await prisma.integrationRun.findFirst({
    where: { target: "bom-components", success: true, finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
  });
  const latestFinishedAt = latestBomRun?.finishedAt ?? null;

  const runIdsInStage = [...new Set(stageRows.map((r) => r.runId).filter(Boolean))];
  const staleBySyncTime = stageRows.filter(
    (r) =>
      latestFinishedAt &&
      r.syncedAt < latestFinishedAt &&
      (r.opcional === true || r.alternativo === true)
  );

  return {
    parentCode: code,
    stageRowCount: stageRows.length,
    component11402InStage: component114,
    component11402InEffectiveList: effectiveCodes.has("114.02"),
    selectedList: listSelection.selectedList,
    ignoredLists: listSelection.ignoredLists,
    optionalInEffectiveList: optionalInEffective.map((l) => ({
      componentCode: l.componentCode,
      opcional: l.opcional,
      alternativo: l.alternativo,
      listaMateriaisId: l.listaMateriaisId,
      listaMateriaisNome: l.listaMateriaisNome,
    })),
    optionalItemsFromContext: ctx?.optionalItems ?? [],
    unassignedOptionalItems: unassigned,
    optionalPricingStatus: optStatus,
    optionalGroups: optionalGroups.map((g) => ({
      id: g.id,
      groupName: g.groupName,
      isActive: g.isActive,
      selectedNone: g.selectedNone,
      updatedAt: g.updatedAt,
      choices: g.choices.map((c) => ({
        componentCode: c.componentCode,
        isActive: c.isActive,
        isSelectedForPricing: c.isSelectedForPricing,
        nomusSourceLineIds: c.nomusSourceLineIds,
      })),
    })),
    effectiveBom: effectiveBom
      ? {
          status: effectiveBom.status,
          optionalPricingStatus: effectiveBom.optionalPricingStatus,
          warnings: effectiveBom.warnings,
          blockedDirect: effectiveBom.directLines.filter((l) => l.decision === "BLOCKED"),
        }
      : null,
    preview:
      "error" in preview
        ? preview
        : {
            canApply: preview.canApply,
            blockingReasons: preview.blockingReasons,
            blockingDetails: preview.blockingDetails?.slice(0, 5),
          },
    distinctRunIdsInStage: runIdsInStage,
    optionalRowsNotResyncedSinceLatestBomApply: staleBySyncTime.map((r) => ({
      componentCode: r.componentCode,
      syncedAt: r.syncedAt,
      runId: r.runId,
      listaMateriaisNome: r.listaMateriaisNome,
    })),
    latestBomComponentsRun: latestBomRun
      ? {
          id: latestBomRun.id,
          status: latestBomRun.status,
          success: latestBomRun.success,
          startedAt: latestBomRun.startedAt,
          finishedAt: latestBomRun.finishedAt,
          blockedCount: latestBomRun.blockedCount,
          updatedCount: latestBomRun.updatedCount,
          logFile: latestBomRun.logFile,
        }
      : null,
  };
}

async function sampleOptionalBlocked(sampleN: number) {
  const blockedProducts = await prisma.nomusBomComponentStage.findMany({
    where: {
      parentCode: { not: "" },
      OR: [{ opcional: true }, { alternativo: true }],
    },
    distinct: ["parentCode"],
    take: 500,
    select: { parentCode: true },
  });

  const results: Array<{
    parentCode: string;
    optionalPricingStatus: string | null;
    unassignedCount: number;
    unassignedCodes: string[];
    staleInStageNotInLatestRun: string[];
  }> = [];

  const latestRun = await prisma.integrationRun.findFirst({
    where: { target: "bom-components", success: true, finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  const latestFinishedAt = latestRun?.finishedAt ?? null;

  for (const { parentCode } of blockedProducts.slice(0, sampleN * 3)) {
    const ctx = await getEffectiveNomusContext(parentCode);
    if (!ctx || ctx.optionalItems.length === 0) continue;
    const groups = await loadGroupsForParent(parentCode);
    const unassigned = computeUnassignedOptionalItems(ctx.optionalItems, groups);
    const status = buildOptionalSelectionStatus({
      optionalItems: ctx.optionalItems,
      unassignedOptionalItems: unassigned,
      groups,
    });
    if (status !== "PENDING" && status !== "STALE") continue;

    const staleCodes: string[] = [];
    if (latestFinishedAt) {
      for (const item of unassigned) {
        const rows = await prisma.nomusBomComponentStage.findMany({
          where: {
            parentCode: { equals: parentCode, mode: "insensitive" },
            componentCode: item.componentCode,
          },
          select: { syncedAt: true, runId: true },
        });
        const refreshedSinceLatest = rows.some((r) => r.syncedAt >= latestFinishedAt);
        if (!refreshedSinceLatest) staleCodes.push(item.componentCode);
      }
    }

    results.push({
      parentCode,
      optionalPricingStatus: status,
      unassignedCount: unassigned.length,
      unassignedCodes: unassigned.map((u) => u.componentCode),
      staleInStageNotInLatestRun: staleCodes,
    });
    if (results.length >= sampleN) break;
  }

  return { latestBomComponentsFinishedAt: latestFinishedAt, sample: results };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL ausente — configure .env ou variável de ambiente.");
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ focus: await diagnoseParent(parentCode) }, null, 2));

  if (process.argv.includes("--sample")) {
    console.log("\n--- AMOSTRA OPCIONAIS PENDENTES ---\n");
    console.log(JSON.stringify(await sampleOptionalBlocked(sampleSize), null, 2));
  }

  const recentRuns = await prisma.integrationRun.findMany({
    where: {
      OR: [
        { target: { in: ["products", "bom-components", "proposals", "customers"] } },
        { sourceSystem: { contains: "nomus", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      createdAt: true,
      target: true,
      mode: true,
      status: true,
      success: true,
      exitCode: true,
      startedAt: true,
      finishedAt: true,
      blockedCount: true,
      updatedCount: true,
      logFile: true,
      runnerLogFile: true,
    },
  });

  console.log("\n--- INTEGRATION RUNS RECENTES ---\n");
  console.log(JSON.stringify(recentRuns, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
