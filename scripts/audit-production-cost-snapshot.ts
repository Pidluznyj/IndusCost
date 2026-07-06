#!/usr/bin/env npx tsx
/**
 * Auditoria read-only do calculationSnapshot de um item publicado de custo de produção.
 *
 * Uso:
 *   npx tsx scripts/audit-production-cost-snapshot.ts --sku=PA-001 --versionCode=2026-06 --revision=1
 *   npx tsx scripts/audit-production-cost-snapshot.ts --productId=<uuid> --json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { createProductCostAnalysisEngine } from "../src/lib/productCostAnalysisEngine.server.ts";
import { evaluateProductEngineeringCost } from "../src/lib/productEngineeringCostSnapshot.server.ts";
import {
  productionCostSnapshotHasBomAuditStructure,
  PRODUCTION_COST_SNAPSHOT_KIND,
  PRODUCTION_COST_SNAPSHOT_LIVE_BOM_NOTICE,
} from "../src/lib/productionCostCalculationSnapshotAudit.ts";
import { parseArg, hasFlag, requireDatabaseUrl, warnTraceLegacyMode } from "./commission-audit-args.ts";

type SnapshotRecord = Record<string, unknown>;

function readSnapshot(value: unknown): SnapshotRecord {
  if (!value || typeof value !== "object") return {};
  return value as SnapshotRecord;
}

async function main(): Promise<void> {
  warnTraceLegacyMode(
    "audit-production-cost-snapshot",
    "scripts/audit-product-cost-trace.ts e GET /api/audit/product-cost-trace"
  );
  requireDatabaseUrl();
  const json = hasFlag("json");
  const sku = parseArg("sku")?.trim() || null;
  const productIdArg = parseArg("productId")?.trim() || null;
  const versionCode = parseArg("versionCode")?.trim() || null;
  const revisionRaw = parseArg("revision")?.trim() || null;
  const revision = revisionRaw != null ? Number(revisionRaw) : null;

  if (!sku && !productIdArg) {
    console.error("Informe --sku ou --productId.");
    process.exit(1);
  }

  await prisma.$connect();

  const product = productIdArg
    ? await prisma.product.findUnique({
        where: { id: productIdArg },
        select: { id: true, sku: true, name: true, type: true },
      })
    : await prisma.product.findUnique({
        where: { sku: sku! },
        select: { id: true, sku: true, name: true, type: true },
      });

  if (!product) {
    console.error("Produto não encontrado.");
    process.exit(1);
  }

  const item = await prisma.productionCostTableItem.findFirst({
    where: {
      productId: product.id,
      costTableVersion: {
        ...(versionCode ? { code: versionCode } : {}),
        ...(revision != null && Number.isFinite(revision) ? { revision } : {}),
      },
    },
    orderBy: [
      { costTableVersion: { effectiveDate: "desc" } },
      { costTableVersion: { revision: "desc" } },
      { costTableVersion: { publishedAt: "desc" } },
    ],
    include: { costTableVersion: true },
  });

  if (!item) {
    console.error("Versão/item de custo não encontrado para os filtros informados.");
    process.exit(1);
  }

  const version = item.costTableVersion;
  const snapshot = readSnapshot(item.calculationSnapshot);
  const breakdown = readSnapshot(snapshot.breakdown);
  const bomStructure = readSnapshot(snapshot.bomStructure);
  const bomLines = Array.isArray(bomStructure.lines) ? bomStructure.lines : [];
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];

  const engine = createProductCostAnalysisEngine(prisma);
  const live = await evaluateProductEngineeringCost(prisma, engine, product.id);

  const payload = {
    evidence: {
      snapshotKind: snapshot.snapshotKind ?? null,
      isFrozenSnapshot: snapshot.snapshotKind === PRODUCTION_COST_SNAPSHOT_KIND,
      liveBomNotice: snapshot.liveBomNotice ?? PRODUCTION_COST_SNAPSHOT_LIVE_BOM_NOTICE,
      hasBomAuditStructure: productionCostSnapshotHasBomAuditStructure(snapshot),
      storedHash: item.calculationHash,
      liveHashNow: live.calculationHash,
      hashMatchesLiveEngine: item.calculationHash === live.calculationHash,
      liveEngineDiffersFromPublished:
        live.calculable && item.calculationHash !== live.calculationHash,
    },
    version: {
      id: version.id,
      code: version.code,
      name: version.name,
      status: version.status,
      revision: version.revision,
      effectiveDate: version.effectiveDate,
      publishedAt: version.publishedAt,
    },
    item: {
      id: item.id,
      productId: item.productId,
      productCodeSnapshot: item.productCodeSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      unitProductionCost: Number(item.unitProductionCost),
      materialCost: Number(item.materialCost),
      laborCost: Number(item.laborCost),
      machineCost: Number(item.machineCost),
      overheadCost: Number(item.overheadCost),
      calculationHash: item.calculationHash,
      calculatedAt: snapshot.calculatedAt ?? null,
    },
    snapshotSummary: {
      productType: snapshot.productType ?? null,
      finalUnitCost: snapshot.finalUnitCost ?? null,
      costAnalysisPartial: snapshot.costAnalysisPartial ?? null,
      breakdown,
      bomLineCount: bomLines.length,
      warningsCount: warnings.length,
    },
    bomStructure: bomStructure,
    warnings,
    excludedBomLines: Array.isArray(bomStructure.excludedBomLines)
      ? bomStructure.excludedBomLines
      : [],
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("=== Auditoria — calculationSnapshot (custo de produção) ===\n");
  console.log(`Produto: [${product.sku}] ${product.name} (${product.type})`);
  console.log(
    `Versão: ${version.code} rev.${version.revision} [${version.status}] vigência ${String(version.effectiveDate).slice(0, 10)}`
  );
  console.log(`Item publicado: ${item.productCodeSnapshot} — R$ ${Number(item.unitProductionCost).toFixed(6)}`);
  console.log(`Hash armazenado: ${item.calculationHash ?? "—"}`);
  console.log(`Calculado em: ${String(snapshot.calculatedAt ?? "—")}`);
  console.log(`\nEvidência snapshot congelado:`);
  console.log(`  snapshotKind: ${String(snapshot.snapshotKind ?? "LEGACY")}`);
  console.log(`  ${String(snapshot.liveBomNotice ?? PRODUCTION_COST_SNAPSHOT_LIVE_BOM_NOTICE)}`);
  console.log(
    `  Hash motor vivo agora: ${live.calculationHash ?? "—"} (${payload.evidence.hashMatchesLiveEngine ? "igual ao publicado" : "DIFERENTE — BOM/custos vivos mudaram"})`
  );

  console.log(`\nBreakdown MP/HH/HM:`);
  console.log(`  MP: R$ ${Number(breakdown.materialCost ?? item.materialCost).toFixed(6)}`);
  console.log(`  HH: R$ ${Number(breakdown.laborCost ?? item.laborCost).toFixed(6)}`);
  console.log(`  HM: R$ ${Number(breakdown.machineCost ?? item.machineCost).toFixed(6)}`);
  console.log(`  Overhead: R$ ${Number(breakdown.overheadCost ?? item.overheadCost).toFixed(6)}`);

  console.log(`\nEstrutura BOM/material no snapshot (${bomLines.length} linha(s)):`);
  for (const line of bomLines.slice(0, 30)) {
    const row = readSnapshot(line);
    const label = `[${String(row.lineType ?? "?")}] ${String(row.sku ?? "—")} ${String(row.name ?? row.description ?? "")}`;
    console.log(
      `  ${label.trim()} qty=${String(row.requiredQty ?? row.quantity ?? "—")} unitCost=${String(row.unitCostUsed ?? "—")} total=${String(row.lineTotalCost ?? row.unitCost ?? "—")}`
    );
  }
  if (bomLines.length > 30) {
    console.log(`  ... +${bomLines.length - 30} linha(s)`);
  }

  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const warning of warnings.slice(0, 20)) {
      const row = readSnapshot(warning);
      console.log(`  [${String(row.code ?? "WARN")}] ${String(row.message ?? "")}`);
    }
  }

  console.log("\n--- JSON ---");
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error("[audit-production-cost-snapshot]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
