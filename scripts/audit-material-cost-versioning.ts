#!/usr/bin/env npx tsx
/**
 * Auditoria read-only da tabela oficial versionada de custo de matéria-prima.
 *
 * Uso:
 *   npx tsx scripts/audit-material-cost-versioning.ts
 *   npx tsx scripts/audit-material-cost-versioning.ts --date=2026-07-01
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { civilDateToLocalDate, toCivilDateKey } from "../src/lib/financeCivilDate.ts";
import { computeMaterialLandedCost } from "../src/lib/materialCostPublication.ts";
import {
  getEffectiveMaterialCost,
  MATERIAL_COST_TABLE_IMMUTABLE_STATUSES,
} from "../src/lib/materialCostTables.server.ts";

type AuditStatus = "OK" | "ALERTA" | "BLOQUEANTE";

type Finding = {
  area: string;
  status: AuditStatus;
  message: string;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function assertDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente — auditoria requer PostgreSQL.");
    process.exit(1);
  }
}

function isValidLandedCost(currentCost: unknown, freight: unknown): boolean {
  const current = Number(currentCost);
  const fr = Number(freight ?? 0);
  const landed = computeMaterialLandedCost({
    currentCost: Number.isFinite(current) ? current : 0,
    freight: Number.isFinite(fr) ? fr : 0,
  });
  return Number.isFinite(landed) && landed > 0;
}

async function main(): Promise<void> {
  assertDatabaseUrl();
  const dateRaw = parseArg("date")?.trim() || toCivilDateKey(new Date());
  const referenceDate = dateRaw ? civilDateToLocalDate(dateRaw) : new Date();
  if (Number.isNaN(referenceDate.getTime())) {
    console.error(`--date inválida: ${dateRaw}`);
    process.exit(1);
  }

  await prisma.$connect();

  const findings: Finding[] = [];

  const activeMaterials = await prisma.material.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      currentCost: true,
      freight: true,
    },
    orderBy: { code: "asc" },
  });

  const withValidCost = activeMaterials.filter((m) => isValidLandedCost(m.currentCost, m.freight));
  const withoutCost = activeMaterials.filter((m) => !isValidLandedCost(m.currentCost, m.freight));

  const [totalVersions, statusGroups, latestPublished, itemCount, draftCount] = await Promise.all([
    prisma.materialCostTableVersion.count(),
    prisma.materialCostTableVersion.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.materialCostTableVersion.findMany({
      where: { status: { in: ["PUBLISHED", "SUPERSEDED"] } },
      orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { publishedAt: "desc" }],
      take: 10,
      include: { _count: { select: { items: true } } },
    }),
    prisma.materialCostTableItem.count(),
    prisma.materialCostTableVersion.count({ where: { status: "DRAFT" } }),
  ]);

  const publishedVersions = await prisma.materialCostTableVersion.findMany({
    where: { status: "PUBLISHED", publishedAt: { not: null } },
    select: { id: true, code: true, revision: true, publishedAt: true, updatedAt: true },
  });

  for (const row of publishedVersions) {
    if (!row.publishedAt) continue;
    if (row.updatedAt.getTime() > row.publishedAt.getTime() + 1_000) {
      findings.push({
        area: "immutability",
        status: "BLOQUEANTE",
        message: `Versão PUBLISHED ${row.code} v${row.revision} possui updatedAt posterior a publishedAt.`,
      });
    }
  }

  const latestPublishedItemByMaterial = await prisma.materialCostTableItem.findMany({
    where: {
      materialCostTableVersion: { status: { in: ["PUBLISHED", "SUPERSEDED"] } },
    },
    orderBy: [
      { materialCostTableVersion: { effectiveDate: "desc" } },
      { materialCostTableVersion: { revision: "desc" } },
    ],
    distinct: ["materialId"],
    select: {
      materialId: true,
      materialCodeSnapshot: true,
      landedCostSnapshot: true,
      currentCostSnapshot: true,
      materialCostTableVersion: {
        select: { code: true, revision: true, status: true, effectiveDate: true },
      },
    },
    take: 5000,
  });

  type DivergenceRow = {
    materialCode: string;
    liveLanded: number;
    publishedLanded: number;
    delta: number;
    versionCode: string;
    versionRevision: number;
  };

  const divergences: DivergenceRow[] = [];
  const publishedByMaterialId = new Map(
    latestPublishedItemByMaterial.map((row) => [row.materialId, row])
  );

  for (const material of activeMaterials.slice(0, 200)) {
    const published = publishedByMaterialId.get(material.id);
    if (!published) continue;
    const liveLanded = computeMaterialLandedCost({
      currentCost: Number(material.currentCost),
      freight: Number(material.freight ?? 0),
    });
    const publishedLanded = Number(published.landedCostSnapshot);
    if (!Number.isFinite(publishedLanded)) continue;
    const delta = Math.round((liveLanded - publishedLanded) * 1_000_000) / 1_000_000;
    if (Math.abs(delta) > 0.000001) {
      divergences.push({
        materialCode: material.code,
        liveLanded,
        publishedLanded,
        delta,
        versionCode: published.materialCostTableVersion.code,
        versionRevision: published.materialCostTableVersion.revision,
      });
    }
  }

  divergences.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  let resolverSample: Awaited<ReturnType<typeof getEffectiveMaterialCost>> | null = null;
  const sampleMaterial = withValidCost[0] ?? activeMaterials[0] ?? null;
  if (sampleMaterial) {
    resolverSample = await getEffectiveMaterialCost(prisma, sampleMaterial.id, referenceDate);
    if (resolverSample.status === "SEM_CUSTO" && itemCount > 0) {
      findings.push({
        area: "coverage",
        status: "ALERTA",
        message: "Existem itens publicados, mas amostra de matéria-prima retornou SEM_CUSTO na data informada.",
      });
    }
  }

  if (withoutCost.length > 0) {
    findings.push({
      area: "pending-cost",
      status: "ALERTA",
      message: `${withoutCost.length} matéria(s)-prima ativa(s) sem custo landed válido no cadastro.`,
    });
  }

  if (totalVersions === 0) {
    findings.push({
      area: "data",
      status: "ALERTA",
      message: "Nenhuma versão de custo de matéria-prima cadastrada ainda.",
    });
  }

  console.log("=== Auditoria — Tabela oficial de custo de matéria-prima ===\n");
  console.log(`Data de referência: ${toCivilDateKey(referenceDate)}`);
  console.log(`Matérias-primas ACTIVE: ${activeMaterials.length}`);
  console.log(`  Com custo landed válido: ${withValidCost.length}`);
  console.log(`  Sem custo (pendência): ${withoutCost.length}`);
  console.log(`Total versões: ${totalVersions}`);
  console.log(`Total itens publicados/rascunho: ${itemCount}`);
  console.log(`DRAFTs: ${draftCount}`);

  console.log("\n--- Versões por status ---");
  for (const row of statusGroups) {
    console.log(`  ${row.status}: ${row._count._all}`);
  }

  console.log("\n--- Últimas versões publicadas/supersedidas (top 10) ---");
  for (const v of latestPublished) {
    console.log(
      `  ${v.code} v${v.revision} [${v.status}] vigência=${toCivilDateKey(v.effectiveDate)} itens=${v._count.items}`
    );
  }

  if (withoutCost.length > 0) {
    console.log("\n--- Matérias-primas sem custo (até 20) ---");
    for (const m of withoutCost.slice(0, 20)) {
      console.log(`  ${m.code} — ${m.description}`);
    }
  }

  console.log("\n--- Divergência cadastro vivo vs última versão publicada (top 15) ---");
  if (divergences.length === 0) {
    console.log("  Nenhuma divergência na amostra ou sem itens publicados.");
  } else {
    for (const d of divergences.slice(0, 15)) {
      console.log(
        `  ${d.materialCode}: vivo=${d.liveLanded} publicado=${d.publishedLanded} (Δ ${d.delta}) [${d.versionCode} v${d.versionRevision}]`
      );
    }
  }

  if (resolverSample && sampleMaterial) {
    console.log("\n--- Exemplo de resolução ---");
    console.log(
      JSON.stringify(
        {
          materialCode: sampleMaterial.code,
          referenceDate: toCivilDateKey(referenceDate),
          resolver: resolverSample,
        },
        null,
        2
      )
    );
  }

  console.log("\n--- Imutabilidade ---");
  console.log(`  Status imutáveis: ${MATERIAL_COST_TABLE_IMMUTABLE_STATUSES.join(", ")}`);

  console.log("\n--- Achados ---");
  if (findings.length === 0) {
    console.log("  OK — nenhum achado bloqueante ou alerta.");
  } else {
    for (const f of findings) {
      console.log(`  [${f.status}] ${f.area}: ${f.message}`);
    }
  }

  const blocking = findings.filter((f) => f.status === "BLOQUEANTE").length;
  console.log("\n--- JSON ---");
  console.log(
    JSON.stringify(
      {
        referenceDate: toCivilDateKey(referenceDate),
        materials: {
          active: activeMaterials.length,
          withValidCost: withValidCost.length,
          withoutCost: withoutCost.length,
        },
        totals: {
          versions: totalVersions,
          items: itemCount,
          drafts: draftCount,
          publishedItemsDistinctMaterials: latestPublishedItemByMaterial.length,
        },
        statusGroups,
        divergencesTop: divergences.slice(0, 15),
        resolverSample,
        findings,
        blocking,
      },
      null,
      2
    )
  );

  if (blocking > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[audit-material-cost-versioning] erro:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
