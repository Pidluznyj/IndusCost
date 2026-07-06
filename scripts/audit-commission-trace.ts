#!/usr/bin/env npx tsx
/**
 * Auditoria read-only: "Quanto paguei de comissão neste item/pedido/título e por quê?"
 *
 * Uso:
 *   npx tsx scripts/audit-commission-trace.ts --order-number=PED-1 --json
 *   npx tsx scripts/audit-commission-trace.ts --year=2026 --month=6 --seller=GISLENE --order-number=PED-1
 *   npx tsx scripts/audit-commission-trace.ts --receivable-code=AR123 --csv
 *   npx tsx scripts/audit-commission-trace.ts --order-number=PED-1 --sku=618.08AA
 */
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildCommissionTraceCsv,
  formatCommissionTraceText,
} from "../src/lib/commissions/commissionTraceAudit.ts";
import { buildCommissionTraceAudit } from "../src/lib/commissions/commissionTraceAudit.server.ts";
import { hasFlag, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

function parseOptionalInt(name: string): number | null {
  const raw = parseArg(name);
  if (!raw?.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalFloat(name: string): number | null {
  const raw = parseArg(name);
  if (!raw?.trim()) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseSalesOrderIdArg(): string | undefined {
  return parseArg("sales-order-id") ?? parseArg("salesOrderId");
}

function parseOrderNumberArg(): string | undefined {
  return parseArg("order-number") ?? parseArg("orderNumber");
}

function parseNfeNumberArg(): string | undefined {
  return parseArg("nfe-number") ?? parseArg("nfeNumber");
}

function parseReceivableCodeArg(): string | undefined {
  return parseArg("receivable-code") ?? parseArg("receivableCode");
}

function defaultCsvOutDir(orderNumber: string | null): string {
  const safe = (orderNumber ?? "commission").replace(/[^\w.-]+/g, "_");
  return join("tmp", "commission-trace", safe);
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const report = await buildCommissionTraceAudit(prisma, {
    year: parseOptionalInt("year"),
    month: parseOptionalInt("month"),
    seller: parseArg("seller")?.trim() || null,
    salesOrderId: parseSalesOrderIdArg()?.trim() || null,
    orderNumber: parseOrderNumberArg()?.trim() || null,
    nfeNumber: parseNfeNumberArg()?.trim() || null,
    receivableCode: parseReceivableCodeArg()?.trim() || null,
    customer: parseArg("customer")?.trim() || null,
    sku: parseArg("sku")?.trim() || null,
    includeLines: hasFlag("include-lines") || !hasFlag("exclude-lines"),
    nomusBase: parseOptionalFloat("nomusBase"),
    nomusCommission: parseOptionalFloat("nomusCommission"),
  });

  const json = hasFlag("json");
  const csv = hasFlag("csv");

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
      parseArg("outDir")?.trim() || defaultCsvOutDir(report.sale?.orderNumber ?? null);
    if (!outDir.replace(/\\/g, "/").startsWith("tmp/") && !outDir.includes("local-artifacts")) {
      console.warn("Aviso: prefira --outDir=tmp/commission-trace para não sujar o git status.");
    }
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const stamp = report.auditedAt.replace(/[:.]/g, "-");
    const filePath = join(
      outDir,
      `commission-trace-${report.sale?.orderNumber ?? "order"}-${stamp}.csv`
    );
    writeFileSync(filePath, buildCommissionTraceCsv(report), "utf8");
    console.error(`CSV salvo em: ${filePath}`);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatCommissionTraceText(report));
  }
}

main()
  .catch((error) => {
    console.error("[audit-commission-trace]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
