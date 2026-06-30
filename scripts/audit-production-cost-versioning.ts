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

  const [totalVersions, statusGroups, latestPublished, itemCount, draftCount] = await Promise.all([
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
        },
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
