#!/usr/bin/env npx tsx
/**
 * Exporta comissões do período para comparação com Nomus.
 *
 * Uso:
 *   npx tsx scripts/export-commission-june-comparison.ts --year=2026 --month=6 --outDir=tmp/commissions-june-2026
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import { decimalToNumber } from "../src/lib/commissions/commission-money.ts";
import {
  activeCommissionRecordWhere,
  csvLine,
  fmtBrl,
  parseArg,
  parseYearPeriod,
  requireDatabaseUrl,
} from "./commission-script-utils.ts";

type ExportRow = Record<string, string | number | null>;

function metaStr(metadataJson: unknown, key: string): string | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const v = (metadataJson as Record<string, unknown>)[key];
  return typeof v === "string" ? v : v != null ? String(v) : null;
}

function metaNum(metadataJson: unknown, key: string): number | null {
  const s = metaStr(metadataJson, key);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const range = parseYearPeriod();
  const outDir = parseArg("outDir") ?? "tmp/commissions-june-2026";
  mkdirSync(outDir, { recursive: true });

  console.log("=== Exportação Comissões — comparação Nomus ===");
  console.log(`Período: ${range.label}`);
  console.log(`Saída: ${outDir}\n`);

  const records = await prisma.commissionRecord.findMany({
    where: activeCommissionRecordWhere({ from: range.from, to: range.to }),
    include: {
      commissionPerson: { select: { name: true } },
      paymentSchedules: {
        where: { source: "ACCOUNTS_RECEIVABLE" },
        select: { nomusReceivableId: true, receivedAmount: true },
        take: 1,
        orderBy: { installmentNumber: "asc" },
      },
    },
    orderBy: [{ orderCode: "asc" }, { productCode: "asc" }],
  });

  const rows: ExportRow[] = records.map((r) => {
    const received = r.paymentSchedules[0]
      ? decimalToNumber(r.paymentSchedules[0].receivedAmount)
      : null;
    return {
      orderCode: r.orderCode,
      issueDate: r.calculatedAt.toISOString().slice(0, 10),
      customerName: r.customerName,
      sellerName: null,
      commissionPersonName: r.commissionPerson.name,
      source: r.originStage,
      status: r.status,
      salesAmount: decimalToNumber(r.baseAmount),
      invoiceNumber: r.nfeNumber,
      receivableNumber: r.paymentSchedules[0]?.nomusReceivableId ?? null,
      receivedAmount: received,
      ruleName: metaStr(r.metadataJson, "ruleName"),
      rulePercent: metaNum(r.metadataJson, "rulePercent") ?? decimalToNumber(r.ratePercent),
      commissionBaseAmount: decimalToNumber(r.baseAmount),
      commissionAmount: decimalToNumber(r.commissionAmount),
      releasedAmount: decimalToNumber(r.releasedAmount),
      paidAmount: decimalToNumber(r.paidAmount),
      balanceAmount: decimalToNumber(r.balanceAmount),
      divergencesWarnings: "",
    };
  });

  const headers = [
    "orderCode",
    "issueDate",
    "customerName",
    "sellerName",
    "commissionPersonName",
    "source",
    "status",
    "salesAmount",
    "invoiceNumber",
    "receivableNumber",
    "receivedAmount",
    "ruleName",
    "rulePercent",
    "commissionBaseAmount",
    "commissionAmount",
    "releasedAmount",
    "paidAmount",
    "balanceAmount",
    "divergencesWarnings",
  ];

  const csvPath = join(outDir, "induscost-commissions-june-2026.csv");
  const jsonPath = join(outDir, "induscost-commissions-june-2026.json");
  const templatePath = join(outDir, "commission-comparison-template-nomus.csv");
  const summaryPath = join(outDir, "commission-summary-june-2026.md");

  writeFileSync(csvPath, [csvLine(headers), ...rows.map((r) => csvLine(headers.map((h) => r[h])))].join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify({ period: range.label, exportedAt: new Date().toISOString(), rows }, null, 2), "utf8");

  const nomusHeaders = [
    "orderCode",
    "invoiceNumber",
    "sellerName",
    "commissionAmountNomus",
    "statusNomus",
    "paidAmountNomus",
    "observation",
  ];
  writeFileSync(templatePath, csvLine(nomusHeaders) + "\n", "utf8");

  const totalCommission = rows.reduce((s, r) => s + Number(r.commissionAmount ?? 0), 0);
  const totalReleased = rows.reduce((s, r) => s + Number(r.releasedAmount ?? 0), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.paidAmount ?? 0), 0);

  const summary = `# Resumo exportação comissões — ${range.label}

- Registros exportados: ${rows.length}
- Comissão total: ${fmtBrl(totalCommission)}
- Liberado: ${fmtBrl(totalReleased)}
- Pago: ${fmtBrl(totalPaid)}

Arquivos:
- ${csvPath}
- ${jsonPath}
- ${templatePath}
`;

  writeFileSync(summaryPath, summary, "utf8");

  console.log(`Registros exportados: ${rows.length}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Template Nomus: ${templatePath}`);
  console.log(`Resumo: ${summaryPath}`);
}

main()
  .catch((err) => {
    console.error("Erro na exportação:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
