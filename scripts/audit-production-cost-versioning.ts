#!/usr/bin/env npx tsx
/**
 * Auditoria read-only da tabela oficial versionada de custo de produção.
 *
 * Uso:
 *   npx tsx scripts/audit-production-cost-versioning.ts
 *   npx tsx scripts/audit-production-cost-versioning.ts --productCode=PA --date=2026-06-01
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { civilDateToLocalDate, toCivilDateKey } from "../src/lib/financeCivilDate.ts";
import {
  getEffectiveProductProductionCost,
  PRODUCTION_COST_TABLE_IMMUTABLE_STATUSES,
} from "../src/lib/productionCostTables.server.ts";
import { createProductCostAnalysisEngine } from "../src/lib/productCostAnalysisEngine.server.ts";
import { evaluateProductEngineeringCost } from "../src/lib/productEngineeringCostSnapshot.server.ts";

import { previewMaterialCostTableSourceForProductionDraft } from "../src/lib/materialCostEngineResolver.ts";

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

async function main(): Promise<void> {
  assertDatabaseUrl();
  const productCode = parseArg("productCode")?.trim() || null;
  const dateRaw = parseArg("date")?.trim() || toCivilDateKey(new Date());
  const referenceDate = dateRaw ? civilDateToLocalDate(dateRaw) : new Date();
  if (Number.isNaN(referenceDate.getTime())) {
    console.error(`--date inválida: ${dateRaw}`);
    process.exit(1);
  }

  await prisma.$connect();

  const findings: Finding[] = [];

  const [totalVersions, statusGroups, latestPublished, itemCount, draftCount, mpLinkStats, mpSourcePreview] =
    await Promise.all([
    prisma.productionCostTableVersion.count(),
    prisma.productionCostTableVersion.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.productionCostTableVersion.findMany({
      where: { status: { in: ["PUBLISHED", "SUPERSEDED"] } },
      orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { publishedAt: "desc" }],
      take: 10,
      include: { _count: { select: { items: true } } },
    }),
    prisma.productionCostTableItem.count(),
    prisma.productionCostTableVersion.count({ where: { status: "DRAFT" } }),
    prisma.productionCostTableVersion.groupBy({
      by: ["materialCostTableVersionId"],
      _count: { _all: true },
    }),
    previewMaterialCostTableSourceForProductionDraft(prisma, referenceDate),
  ]);

  const publishedVersions = await prisma.productionCostTableVersion.findMany({
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

  const activeProducts = await prisma.product.count({ where: { status: "ACTIVE", type: "PRODUCT" } });

  let sampleProductId: string | null = null;
  if (productCode) {
    const product = await prisma.product.findFirst({
      where: { sku: productCode },
      select: { id: true, sku: true, name: true },
    });
    sampleProductId = product?.id ?? null;
    if (!product) {
      findings.push({
        area: "resolver",
        status: "ALERTA",
        message: `Produto não encontrado para productCode=${productCode}`,
      });
    }
  } else {
    const withItem = await prisma.productionCostTableItem.findFirst({
      select: { productId: true, productCodeSnapshot: true },
      orderBy: { createdAt: "desc" },
    });
    sampleProductId = withItem?.productId ?? null;
  }

  let resolverSample: Awaited<ReturnType<typeof getEffectiveProductProductionCost>> | null = null;
  if (sampleProductId) {
    resolverSample = await getEffectiveProductProductionCost(prisma, sampleProductId, referenceDate);
    if (resolverSample.status === "SEM_CUSTO" && itemCount > 0) {
      findings.push({
        area: "coverage",
        status: "ALERTA",
        message: "Existem itens publicados, mas amostra de produto retornou SEM_CUSTO na data informada.",
      });
    }
  }

  let ciuWithFrozenGap = 0;
  const engine = createProductCostAnalysisEngine(prisma);
  const activeProductSample = await prisma.product.findMany({
    where: { status: "ACTIVE", type: "PRODUCT" },
    select: { id: true, sku: true },
    take: 30,
    orderBy: { sku: "asc" },
  });
  for (const p of activeProductSample) {
    const evaluated = await evaluateProductEngineeringCost(prisma, engine, p.id);
    const effective = await getEffectiveProductProductionCost(prisma, p.id, referenceDate);
    if (evaluated.calculable && effective.status === "SEM_CUSTO") ciuWithFrozenGap += 1;
  }
  if (ciuWithFrozenGap > 0) {
    findings.push({
      area: "engineering-gap",
      status: "ALERTA",
      message: `${ciuWithFrozenGap} produto(s) na amostra têm CIU calculável mas SEM custo congelado vigente.`,
    });
  }

  let product619: Awaited<ReturnType<typeof evaluateProductEngineeringCost>> | null = null;
  if (productCode === "619.24AA" || !productCode) {
    const p619 = await prisma.product.findFirst({
      where: { sku: "619.24AA" },
      select: { id: true },
    });
    if (p619) product619 = await evaluateProductEngineeringCost(prisma, engine, p619.id);
  }

  const productsWithPublishedItems = await prisma.productionCostTableItem.findMany({
    distinct: ["productId"],
    select: { productId: true },
    take: 5000,
  });

  let withCost = 0;
  let withoutCost = 0;
  const sampleIds = productsWithPublishedItems.slice(0, 50).map((r) => r.productId);
  for (const pid of sampleIds) {
    const resolved = await getEffectiveProductProductionCost(prisma, pid, referenceDate);
    if (resolved.status === "OK") withCost += 1;
    else withoutCost += 1;
  }

  const draftsWithoutMpLink = await prisma.productionCostTableVersion.count({
    where: { status: "DRAFT", materialCostTableVersionId: null },
  });
  const publishedWithoutMpLink = await prisma.productionCostTableVersion.count({
    where: { status: { in: ["PUBLISHED", "SUPERSEDED"] }, materialCostTableVersionId: null },
  });

  if (draftsWithoutMpLink > 0) {
    findings.push({
      area: "material-table-link",
      status: "ALERTA",
      message: `${draftsWithoutMpLink} DRAFT(s) de produção sem materialCostTableVersionId (legado ou gerado antes da integração).`,
    });
  }

  if (!mpSourcePreview.available && totalVersions > 0) {
    findings.push({
      area: "material-table-source",
      status: "ALERTA",
      message: mpSourcePreview.message ?? "Sem tabela de MP publicada vigente para a data de referência.",
    });
  }

  if (totalVersions === 0) {
    findings.push({
      area: "data",
      status: "ALERTA",
      message: "Nenhuma versão de custo de produção cadastrada ainda (esperado antes da go-live).",
    });
  }

  console.log("=== Auditoria — Tabela oficial de custo de produção ===\n");
  console.log(`Data de referência: ${toCivilDateKey(referenceDate)}`);
  console.log(`Total versões: ${totalVersions}`);
  console.log(`Total itens: ${itemCount}`);
  console.log(`DRAFTs: ${draftCount}`);
  console.log(`Produtos ACTIVE: ${activeProducts}`);
  console.log("\n--- Vínculo com tabela de MP ---");
  console.log(
    `  MP vigente para ${toCivilDateKey(referenceDate)}: ${
      mpSourcePreview.available
        ? `${mpSourcePreview.materialCostTableVersionCode} rev.${mpSourcePreview.revision} (${mpSourcePreview.itemsCount} itens)`
        : "indisponível"
    }`
  );
  console.log(`  DRAFTs sem materialCostTableVersionId: ${draftsWithoutMpLink}`);
  console.log(`  Publicadas/supersedidas sem vínculo MP: ${publishedWithoutMpLink}`);
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

  console.log("\n--- Cobertura amostral (até 50 produtos com item publicado) ---");
  console.log(`  Com custo vigente: ${withCost}`);
  console.log(`  SEM_CUSTO: ${withoutCost}`);

  console.log(`\nProdutos com CIU mas sem custo congelado (amostra 30): ${ciuWithFrozenGap}`);

  if (product619) {
    console.log("\n--- Produto 619.24AA (CIU Engenharia) ---");
    console.log(
      JSON.stringify(
        {
          calculable: product619.calculable,
          unitProductionCost:
            product619.calculable && product619.resolved.ok
              ? product619.resolved.finalUnitCost
              : null,
          hash: product619.calculationHash,
          error: product619.errorMessage,
        },
        null,
        2
      )
    );
  }

  if (resolverSample && sampleProductId) {
    console.log("\n--- Exemplo de resolução ---");
    console.log(JSON.stringify(resolverSample, null, 2));
  }

  console.log("\n--- Imutabilidade ---");
  console.log(`  Status imutáveis: ${PRODUCTION_COST_TABLE_IMMUTABLE_STATUSES.join(", ")}`);

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
        totals: {
          versions: totalVersions,
          items: itemCount,
          drafts: draftCount,
          activeProducts,
          draftsWithoutMpLink,
          publishedWithoutMpLink,
        },
        materialCostSource: mpSourcePreview,
        mpLinkStats,
        statusGroups,
        sampleCoverage: { withCost, withoutCost, sampleSize: sampleIds.length },
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
    console.error("[audit-production-cost-versioning] erro:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
