#!/usr/bin/env npx tsx
/**
 * Auditoria read-only: "Qual foi a margem real desta venda e qual custo oficial foi usado?"
 *
 * Uso:
 *   npx tsx scripts/audit-sales-order-trace.ts --order-number=PD0001
 *   npx tsx scripts/audit-sales-order-trace.ts --sales-order-id=<uuid> --json
 *   npx tsx scripts/audit-sales-order-trace.ts --nfe-number=12345 --csv
 *   npx tsx scripts/audit-sales-order-trace.ts --customer=ACME --year=2026 --month=6
 */
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildSalesOrderTraceCsv,
  formatSalesOrderTraceText,
} from "../src/lib/audit/salesOrderTrace.ts";
import { buildSalesOrderTrace } from "../src/lib/audit/costToCashTrace.server.ts";
import { hasFlag, parseArg, requireDatabaseUrl } from "./commission-audit-args.ts";

function parseSalesOrderIdArg(): string | undefined {
  return parseArg("sales-order-id") ?? parseArg("salesOrderId");
}

function parseOrderNumberArg(): string | undefined {
  return parseArg("order-number") ?? parseArg("orderNumber");
}

function parseNfeNumberArg(): string | undefined {
  return parseArg("nfe-number") ?? parseArg("nfeNumber");
}

function parseOptionalInt(name: string): number | null {
  const raw = parseArg(name);
  if (!raw?.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function defaultCsvOutDir(orderNumber: string | null): string {
  const safe = (orderNumber ?? "sales-order").replace(/[^\w.-]+/g, "_");
  return join("tmp", "sales-order-trace", safe);
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const salesOrderId = parseSalesOrderIdArg()?.trim() || null;
  const orderNumber = parseOrderNumberArg()?.trim() || null;
  const nfeNumber = parseNfeNumberArg()?.trim() || null;
  const customer = parseArg("customer")?.trim() || null;
  const year = parseOptionalInt("year");
  const month = parseOptionalInt("month");
  const json = hasFlag("json");
  const csv = hasFlag("csv");
  const includeItems = hasFlag("include-items") || !hasFlag("exclude-items");

  await prisma.$connect();

  const report = await buildSalesOrderTrace(prisma, {
    salesOrderId,
    orderNumber,
    nfeNumber,
    customer,
    year,
    month,
    includeItems,
  });

  if (report.status === "FAIL") {
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(report.errorMessage ?? "Auditoria falhou.");
    }
    process.exit(1);
  }

  if (csv) {
    const outDir =
      parseArg("outDir")?.trim() || defaultCsvOutDir(report.order?.orderNumber ?? orderNumber);
    if (!outDir.replace(/\\/g, "/").startsWith("tmp/") && !outDir.includes("local-artifacts")) {
      console.warn("Aviso: prefira --outDir=tmp/sales-order-trace para não sujar o git status.");
    }
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const stamp = report.auditedAt.replace(/[:.]/g, "-");
    const filePath = join(
      outDir,
      `sales-order-trace-${report.order?.orderNumber ?? "order"}-${stamp}.csv`
    );
    writeFileSync(filePath, buildSalesOrderTraceCsv(report), "utf8");
    console.error(`CSV salvo em: ${filePath}`);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatSalesOrderTraceText(report));
  }
}

main()
  .catch((error) => {
    console.error("[audit-sales-order-trace]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
