#!/usr/bin/env npx tsx
/**
 * Auditoria read-only de SalesOrderItem.unitCost (preço unitário comercial Nomus).
 *
 * @deprecated BLOQUEADO para apply — unitCost do Nomus é preço de venda, não custo de produção.
 * Este script não pode ser usado como backfill de custo industrial.
 *
 * Preview (read-only):
 *   npx tsx scripts/backfill-sales-order-unit-cost-snapshot.ts --year=2026 --month=6 --mode=preview
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildNomusSyncOfficialUnitCostIndex,
  computeNomusSyncLineTotalCost,
  createBackfillUnitCostSummary,
  formatNomusSyncUnitCostDecimal,
  parseNomusSyncStoredUnitCost,
  resolveBackfillSalesOrderItemUnitCost,
  type BackfillUnitCostSummary,
} from "../src/lib/salesOrderNomusSyncCost.server.ts";

type CliArgs = {
  year: number;
  month: number | null;
  mode: "preview" | "apply";
  limit: number | null;
  order: "recent" | "oldest";
  onlyMissing: boolean;
};

type ScannedItem = {
  id: string;
  productId: string;
  skuSnapshot: string;
  quantity: number;
  totalNetValue: number;
  unitCostStored: number;
  hasFrozenCost: boolean;
  orderCode: string;
  issueDate: Date;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function parseCliArgs(): CliArgs {
  const modeRaw = parseArg("mode") ?? "preview";
  if (modeRaw !== "preview" && modeRaw !== "apply") {
    throw new Error(`--mode inválido: ${modeRaw} (use preview ou apply)`);
  }

  const orderRaw = parseArg("order") ?? "recent";
  if (orderRaw !== "recent" && orderRaw !== "oldest") {
    throw new Error(`--order inválido: ${orderRaw} (use recent ou oldest)`);
  }

  const onlyMissingRaw = parseArg("onlyMissing") ?? "true";
  const onlyMissing = onlyMissingRaw !== "false" && onlyMissingRaw !== "0";

  const limitRaw = parseArg("limit");
  const limit =
    limitRaw != null && limitRaw !== "" ? Math.max(1, Math.min(50_000, Number(limitRaw))) : null;

  return {
    year: Number(parseArg("year") ?? String(new Date().getFullYear())),
    month: (() => {
      const m = parseArg("month");
      return m != null && m !== "" ? Number(m) : null;
    })(),
    mode: modeRaw,
    limit,
    order: orderRaw,
    onlyMissing,
  };
}

function buildPeriodFilter(args: Pick<CliArgs, "year" | "month">): {
  start: Date;
  endExclusive: Date;
  label: string;
} {
  const { year, month } = args;
  if (month != null && month >= 1 && month <= 12) {
    return {
      start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
      endExclusive: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
      label: `${year}-${String(month).padStart(2, "0")}`,
    };
  }
  return {
    start: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
    endExclusive: new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0)),
    label: String(year),
  };
}

function fmtMoney(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function assertDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "DATABASE_URL não configurada. Configure a conexão PostgreSQL antes de executar o backfill."
    );
  }
}

function pushExample(
  summary: BackfillUnitCostSummary,
  row: BackfillUnitCostSummary["examples"][number],
  max = 20
): void {
  if (summary.examples.length < max) summary.examples.push(row);
}

async function loadScannedItems(args: CliArgs, period: ReturnType<typeof buildPeriodFilter>): Promise<ScannedItem[]> {
  const rows = await prisma.salesOrderItem.findMany({
    where: {
      SalesOrder: {
        issueDate: { gte: period.start, lt: period.endExclusive },
        status: { not: "CANCELLED" },
      },
    },
    select: {
      id: true,
      productId: true,
      skuSnapshot: true,
      quantity: true,
      totalNetValue: true,
      unitCost: true,
      SalesOrder: {
        select: {
          orderCode: true,
          issueDate: true,
        },
      },
    },
    orderBy: {
      SalesOrder: { issueDate: args.order === "recent" ? "desc" : "asc" },
    },
  });

  return rows.map((row) => {
    const unitCostStored = toNumber(row.unitCost);
    const hasFrozenCost = parseNomusSyncStoredUnitCost(row.unitCost) != null;
    return {
      id: row.id,
      productId: row.productId,
      skuSnapshot: row.skuSnapshot,
      quantity: toNumber(row.quantity),
      totalNetValue: toNumber(row.totalNetValue),
      unitCostStored,
      hasFrozenCost,
      orderCode: row.SalesOrder.orderCode,
      issueDate: row.SalesOrder.issueDate,
    };
  });
}

async function runBackfill(args: CliArgs): Promise<BackfillUnitCostSummary> {
  const startedAt = Date.now();
  const summary = createBackfillUnitCostSummary(args.mode);
  const period = buildPeriodFilter(args);

  const scanned = await loadScannedItems(args, period);
  summary.scanned = scanned.length;

  const candidates = args.onlyMissing
    ? scanned.filter((row) => !row.hasFrozenCost)
    : scanned;

  for (const row of scanned) {
    if (row.hasFrozenCost) summary.preservedExisting += 1;
  }

  const productIds = [...new Set(candidates.map((row) => row.productId).filter(Boolean))];
  const indexBuild = await buildNomusSyncOfficialUnitCostIndex(prisma, productIds);
  summary.resolverStats = indexBuild.resolverStats;

  const resolvedProductIdsSeen = new Set<string>();
  let processedEligible = 0;

  for (const row of candidates) {
    if (args.limit != null && processedEligible >= args.limit) break;

    if (row.hasFrozenCost) {
      continue;
    }

    processedEligible += 1;
    summary.eligible += 1;

    const resolution = resolveBackfillSalesOrderItemUnitCost({
      productId: row.productId,
      unitCostIndex: indexBuild.index,
    });

    if (resolution.outcome === "no_product") {
      summary.unresolvedNoProduct += 1;
      pushExample(summary, {
        orderCode: row.orderCode,
        itemId: row.id,
        sku: row.skuSnapshot,
        productId: row.productId,
        resolvedUnitCost: null,
        netValue: row.totalNetValue,
        action: "skip_no_product",
      });
      continue;
    }

    if (resolution.outcome !== "resolved" || resolution.unitCost == null || resolution.unitCost <= 0) {
      summary.unresolvedNoCost += 1;
      pushExample(summary, {
        orderCode: row.orderCode,
        itemId: row.id,
        sku: row.skuSnapshot,
        productId: row.productId,
        resolvedUnitCost: null,
        netValue: row.totalNetValue,
        action: "skip_no_cost",
      });
      if (resolution.warning) {
        summary.errors.push(
          `pedido=${row.orderCode} item=${row.id} sku=${row.skuSnapshot}: ${resolution.warning}`
        );
      }
      continue;
    }

    if (resolvedProductIdsSeen.has(row.productId)) {
      summary.fromCache += 1;
    } else {
      resolvedProductIdsSeen.add(row.productId);
    }

    const lineTotalCost = computeNomusSyncLineTotalCost(row.quantity, resolution.unitCost);
    summary.approximateCostImpact += lineTotalCost;
    summary.approximateNetRevenueEligible += row.totalNetValue;

    if (args.mode === "preview") {
      pushExample(summary, {
        orderCode: row.orderCode,
        itemId: row.id,
        sku: row.skuSnapshot,
        productId: row.productId,
        resolvedUnitCost: resolution.unitCost,
        netValue: row.totalNetValue,
        action: "would_update",
      });
      continue;
    }

    try {
      const current = await prisma.salesOrderItem.findUnique({
        where: { id: row.id },
        select: { unitCost: true },
      });
      if (!current) {
        summary.errors.push(`item=${row.id} não encontrado no apply`);
        continue;
      }
      if (parseNomusSyncStoredUnitCost(current.unitCost) != null) {
        summary.preservedExisting += 1;
        pushExample(summary, {
          orderCode: row.orderCode,
          itemId: row.id,
          sku: row.skuSnapshot,
          productId: row.productId,
          resolvedUnitCost: resolution.unitCost,
          netValue: row.totalNetValue,
          action: "preserved",
        });
        continue;
      }

      await prisma.salesOrderItem.update({
        where: { id: row.id },
        data: {
          unitCost: formatNomusSyncUnitCostDecimal(resolution.unitCost),
        },
      });
      summary.updated += 1;
      pushExample(summary, {
        orderCode: row.orderCode,
        itemId: row.id,
        sku: row.skuSnapshot,
        productId: row.productId,
        resolvedUnitCost: resolution.unitCost,
        netValue: row.totalNetValue,
        action: "updated",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`pedido=${row.orderCode} item=${row.id}: ${message}`);
    }
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

function printHumanSummary(args: CliArgs, period: ReturnType<typeof buildPeriodFilter>, summary: BackfillUnitCostSummary): void {
  console.log("=== IndusCost — Backfill SalesOrderItem.unitCost ===");
  console.log(`Modo: ${summary.mode}${summary.mode === "preview" ? " (sem gravação)" : " (GRAVA no banco)"}`);
  console.log(`Período: ${period.label}`);
  console.log(`Ordem: ${args.order} | onlyMissing: ${args.onlyMissing} | limit: ${args.limit ?? "sem limite"}`);
  console.log("");
  console.log(
    "⚠ Backfill usa custo resolvido no momento da execução; para histórico perfeito seria necessário snapshot/log da época."
  );
  console.log("");

  console.log("--- Resumo ---");
  console.log(`scanned:              ${summary.scanned}`);
  console.log(`eligible:             ${summary.eligible}`);
  console.log(`updated:              ${summary.updated}`);
  console.log(`preservedExisting:    ${summary.preservedExisting}`);
  console.log(`unresolvedNoProduct:  ${summary.unresolvedNoProduct}`);
  console.log(`unresolvedNoCost:     ${summary.unresolvedNoCost}`);
  console.log(`fromCache:            ${summary.fromCache}`);
  console.log(`errors:               ${summary.errors.length}`);
  console.log(`durationMs:           ${summary.durationMs}`);
  console.log(`engineCalls:          ${summary.resolverStats.engineCalls}`);
  console.log(`cacheHits:            ${summary.resolverStats.cacheHits}`);
  console.log("");
  console.log(`Impacto custo aprox. (qty × unitCost): R$ ${fmtMoney(summary.approximateCostImpact)}`);
  console.log(`Receita líq. elegível:                 R$ ${fmtMoney(summary.approximateNetRevenueEligible)}`);

  if (summary.examples.length > 0) {
    console.log("\n--- Exemplos ---");
    for (const ex of summary.examples) {
      console.log(
        `  [${ex.action}] pedido=${ex.orderCode} item=${ex.itemId} sku=${ex.sku} ` +
          `unitCost→${ex.resolvedUnitCost ?? "—"} receita=R$ ${fmtMoney(ex.netValue)}`
      );
    }
  }

  if (summary.errors.length > 0) {
    console.log("\n--- Warnings / erros ---");
    for (const err of summary.errors.slice(0, 30)) {
      console.warn(`  ${err}`);
    }
    if (summary.errors.length > 30) {
      console.warn(`  ... +${summary.errors.length - 30} mensagens`);
    }
  }

  console.log("\n--- JSON ---");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.mode === "preview") {
    console.log("\nNenhum dado alterado (preview). Apply está permanentemente bloqueado — veja audit-sales-order-cost-semantics.ts.");
  }
}

async function main(): Promise<void> {
  assertDatabaseUrl();
  const args = parseCliArgs();
  if (args.mode === "apply") {
    console.error(
      "[backfill-sales-order-unit-cost-snapshot] BLOQUEADO: apply desabilitado.\n" +
        "unitCost do Nomus é preço de venda, não custo de produção. Este script não pode ser usado como backfill de custo.\n" +
        "Use scripts/audit-sales-order-cost-semantics.ts e o motor de margem IndusCost."
    );
    process.exitCode = 1;
    return;
  }
  const period = buildPeriodFilter(args);

  await prisma.$connect();

  const summary = await runBackfill(args);
  printHumanSummary(args, period, summary);
}

main()
  .catch((error) => {
    console.error("[backfill-sales-order-unit-cost-snapshot] erro:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
