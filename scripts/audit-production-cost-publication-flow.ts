#!/usr/bin/env npx tsx
/**
 * Auditoria read-only do fluxo de geração/publicação de custo de produção versionado.
 *
 * Uso:
 *   npx tsx scripts/audit-production-cost-publication-flow.ts
 *   npx tsx scripts/audit-production-cost-publication-flow.ts --productCode=PA --date=2026-06-01
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { civilDateToLocalDate, toCivilDateKey } from "../src/lib/financeCivilDate.ts";
import {
  getEffectiveProductProductionCost,
  PRODUCTION_COST_TABLE_IMMUTABLE_STATUSES,
} from "../src/lib/productionCostTables.server.ts";
import { PRODUCTION_COST_PUBLICATION_SOURCE } from "../src/lib/productionCostPublication.ts";
import { PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE } from "../src/lib/productEngineeringCostSnapshot.ts";

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

  const [draftVersions, publishedVersions, supersededVersions, totalItems, activeProducts] =
    await Promise.all([
      prisma.productionCostTableVersion.findMany({
        where: { status: "DRAFT" },
        orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }],
        include: { _count: { select: { items: true } } },
      }),
      prisma.productionCostTableVersion.findMany({
        where: { status: "PUBLISHED" },
        orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }],
        include: { _count: { select: { items: true } } },
      }),
      prisma.productionCostTableVersion.findMany({
        where: { status: "SUPERSEDED" },
        orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }],
        take: 20,
        include: { _count: { select: { items: true } } },
      }),
      prisma.productionCostTableItem.count(),
      prisma.product.count({ where: { status: "ACTIVE", type: "PRODUCT" } }),
    ]);

  for (const row of publishedVersions) {
    if (!row.publishedAt) {
      findings.push({
        area: "publication",
        status: "BLOQUEANTE",
        message: `Versão PUBLISHED ${row.code} rev.${row.revision} sem publishedAt.`,
      });
    }
    if (row.updatedAt.getTime() > (row.publishedAt?.getTime() ?? 0) + 1_000) {
      findings.push({
        area: "immutability",
        status: "BLOQUEANTE",
        message: `Versão PUBLISHED ${row.code} rev.${row.revision} alterada após publicação (updatedAt > publishedAt).`,
      });
    }
  }

  for (const draft of draftVersions) {
    if (draft._count.items === 0) {
      findings.push({
        area: "draft",
        status: "ALERTA",
        message: `DRAFT ${draft.code} rev.${draft.revision} sem itens.`,
      });
    }
    if (draft.source && draft.source !== PRODUCTION_COST_PUBLICATION_SOURCE && draft.source !== PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE) {
      findings.push({
        area: "source",
        status: "ALERTA",
        message: `DRAFT ${draft.code} rev.${draft.revision} com source inesperada: ${draft.source}`,
      });
    }
  }

  const itemsWithoutSnapshot = await prisma.productionCostTableItem.count({
    where: { OR: [{ calculationSnapshot: { equals: null } }, { calculationHash: null }] },
  });
  if (itemsWithoutSnapshot > 0) {
    findings.push({
      area: "snapshot",
      status: "ALERTA",
      message: `${itemsWithoutSnapshot} item(ns) sem snapshot/hash de cálculo.`,
    });
  }

  const productsWithAnyItem = await prisma.productionCostTableItem.findMany({
    distinct: ["productId"],
    select: { productId: true },
    take: 5000,
  });
  const productsWithoutCost = activeProducts - productsWithAnyItem.length;
  if (productsWithoutCost > 0 && publishedVersions.length > 0) {
    findings.push({
      area: "coverage",
      status: "ALERTA",
      message: `${productsWithoutCost} produto(s) ACTIVE sem nenhum item em tabela de custo (amostra global).`,
    });
  }

  let sampleProductId: string | null = null;
  if (productCode) {
    const product = await prisma.product.findFirst({
      where: { sku: productCode },
      select: { id: true, sku: true },
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
      select: { productId: true },
      orderBy: { createdAt: "desc" },
    });
    sampleProductId = withItem?.productId ?? null;
  }

  let resolverSample: Awaited<ReturnType<typeof getEffectiveProductProductionCost>> | null = null;
  if (sampleProductId) {
    resolverSample = await getEffectiveProductProductionCost(prisma, sampleProductId, referenceDate);
    if (resolverSample.status === "SEM_CUSTO" && totalItems > 0) {
      findings.push({
        area: "resolver",
        status: "ALERTA",
        message: "Existem itens cadastrados, mas amostra retornou SEM_CUSTO na data informada.",
      });
    }
  }

  console.log("=== Auditoria — Fluxo de publicação de custo de produção ===\n");
  console.log(`Data de referência: ${toCivilDateKey(referenceDate)}`);
  console.log(`Produtos ACTIVE: ${activeProducts}`);
  console.log(`Total itens: ${totalItems}`);
  console.log(`Fonte esperada de geração: ${PRODUCTION_COST_PUBLICATION_SOURCE}`);
  console.log(`Status imutáveis: ${PRODUCTION_COST_TABLE_IMMUTABLE_STATUSES.join(", ")}`);

  console.log("\n--- DRAFTs ---");
  if (draftVersions.length === 0) {
    console.log("  (nenhum)");
  } else {
    for (const v of draftVersions) {
      console.log(
        `  ${v.code} rev.${v.revision} vigência=${toCivilDateKey(v.effectiveDate)} itens=${v._count.items} source=${v.source ?? "—"}`
      );
    }
  }

  console.log("\n--- PUBLISHED ---");
  if (publishedVersions.length === 0) {
    console.log("  (nenhum)");
  } else {
    for (const v of publishedVersions) {
      console.log(
        `  ${v.code} rev.${v.revision} vigência=${toCivilDateKey(v.effectiveDate)} publicado=${v.publishedAt?.toISOString() ?? "—"} itens=${v._count.items}`
      );
    }
  }

  console.log("\n--- SUPERSEDED (top 20) ---");
  if (supersededVersions.length === 0) {
    console.log("  (nenhum)");
  } else {
    for (const v of supersededVersions) {
      console.log(
        `  ${v.code} rev.${v.revision} vigência=${toCivilDateKey(v.effectiveDate)} itens=${v._count.items}`
      );
    }
  }

  console.log("\n--- Revisões por code (PUBLISHED + SUPERSEDED) ---");
  const revisionGroups = await prisma.productionCostTableVersion.groupBy({
    by: ["code"],
    where: { status: { in: ["PUBLISHED", "SUPERSEDED"] } },
    _count: { _all: true },
    _max: { revision: true },
  });
  for (const g of revisionGroups) {
    console.log(`  ${g.code}: ${g._count._all} versão(ões), revisão máxima=${g._max.revision ?? "—"}`);
  }

  if (resolverSample) {
    console.log("\n--- Exemplo de resolução por produto/data ---");
    console.log(JSON.stringify(resolverSample, null, 2));
  }

  console.log("\n--- Achados ---");
  if (findings.length === 0) {
    console.log("  OK — nenhum achado.");
  } else {
    for (const f of findings) {
      console.log(`  [${f.status}] ${f.area}: ${f.message}`);
    }
  }

  const hasBlocker = findings.some((f) => f.status === "BLOQUEANTE");
  const hasAlert = findings.some((f) => f.status === "ALERTA");
  const overall: AuditStatus = hasBlocker ? "BLOQUEANTE" : hasAlert ? "ALERTA" : "OK";
  console.log(`\nStatus geral: ${overall}`);

  await prisma.$disconnect();
  process.exit(hasBlocker ? 2 : hasAlert ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
