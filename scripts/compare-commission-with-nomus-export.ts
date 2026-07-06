#!/usr/bin/env npx tsx
/**
 * Compara export IndusCost x arquivo Nomus.
 *
 * Uso:
 *   npx tsx scripts/compare-commission-with-nomus-export.ts --year=2026 --month=6 --nomusFile=tmp/nomus.csv
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

type CompareClass = "OK" | "DIVERGENTE" | "FALTANDO_NO_INDUSCOST" | "FALTANDO_NO_NOMUS";

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]!);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function matchKey(orderCode: string | null, invoiceNumber: string | null): string {
  return `${(orderCode ?? "").trim()}|${(invoiceNumber ?? "").trim()}`;
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const range = parseYearPeriod();
  const nomusFile = parseArg("nomusFile");
  const outDir = parseArg("outDir") ?? "tmp/commissions-june-2026";
  mkdirSync(outDir, { recursive: true });

  console.log("=== Comparação IndusCost x Nomus ===");
  console.log(`Período: ${range.label}\n`);

  if (!nomusFile || !existsSync(nomusFile)) {
    const templatePath = join(outDir, "commission-comparison-template-nomus.csv");
    const headers = [
      "orderCode",
      "invoiceNumber",
      "sellerName",
      "commissionAmountNomus",
      "statusNomus",
      "paidAmountNomus",
      "observation",
    ];
    writeFileSync(templatePath, csvLine(headers) + "\n", "utf8");
    console.log("Arquivo Nomus não informado ou inexistente.");
    console.log(`Template gerado em: ${templatePath}`);
    console.log("\nUso:");
    console.log(
      "  npx tsx scripts/compare-commission-with-nomus-export.ts --year=2026 --month=6 --nomusFile=caminho/arquivo.csv"
    );
    return;
  }

  const nomusRows = parseCsv(readFileSync(nomusFile, "utf8"));
  const indusRecords = await prisma.commissionRecord.findMany({
    where: activeCommissionRecordWhere({ from: range.from, to: range.to }),
    select: {
      orderCode: true,
      nfeNumber: true,
      commissionAmount: true,
      paidAmount: true,
      status: true,
      commissionPerson: { select: { name: true } },
    },
  });

  const indusByKey = new Map<string, (typeof indusRecords)[number]>();
  for (const r of indusRecords) {
    indusByKey.set(matchKey(r.orderCode, r.nfeNumber), r);
  }

  const nomusByKey = new Map<string, Record<string, string>>();
  for (const row of nomusRows) {
    nomusByKey.set(matchKey(row.orderCode ?? null, row.invoiceNumber ?? null), row);
  }

  type DiffRow = {
    classification: CompareClass;
    orderCode: string;
    invoiceNumber: string;
    sellerName: string;
    indusCommission: number | null;
    nomusCommission: number | null;
    delta: number | null;
    observation: string;
  };

  const diffs: DiffRow[] = [];
  const allKeys = new Set([...indusByKey.keys(), ...nomusByKey.keys()]);

  for (const key of allKeys) {
    const [orderCode, invoiceNumber] = key.split("|");
    const indus = indusByKey.get(key);
    const nomus = nomusByKey.get(key);

    if (indus && !nomus) {
      diffs.push({
        classification: "FALTANDO_NO_NOMUS",
        orderCode: orderCode ?? "",
        invoiceNumber: invoiceNumber ?? "",
        sellerName: indus.commissionPerson.name,
        indusCommission: decimalToNumber(indus.commissionAmount),
        nomusCommission: null,
        delta: null,
        observation: "Presente no IndusCost, ausente no arquivo Nomus",
      });
      continue;
    }

    if (!indus && nomus) {
      diffs.push({
        classification: "FALTANDO_NO_INDUSCOST",
        orderCode: orderCode ?? "",
        invoiceNumber: invoiceNumber ?? "",
        sellerName: nomus.sellerName ?? "",
        indusCommission: null,
        nomusCommission: Number(nomus.commissionAmountNomus) || null,
        delta: null,
        observation: "Presente no Nomus, ausente no IndusCost",
      });
      continue;
    }

    if (!indus || !nomus) continue;

    const ic = decimalToNumber(indus.commissionAmount);
    const nc = Number(nomus.commissionAmountNomus) || 0;
    const delta = Math.abs(ic - nc);
    diffs.push({
      classification: delta <= 0.02 ? "OK" : "DIVERGENTE",
      orderCode: orderCode ?? "",
      invoiceNumber: invoiceNumber ?? "",
      sellerName: nomus.sellerName ?? indus.commissionPerson.name,
      indusCommission: ic,
      nomusCommission: nc,
      delta,
      observation: delta <= 0.02 ? "" : `Diferença ${fmtBrl(delta)}`,
    });
  }

  const outPath = join(outDir, "commission-nomus-divergences.csv");
  const headers = [
    "classification",
    "orderCode",
    "invoiceNumber",
    "sellerName",
    "indusCommission",
    "nomusCommission",
    "delta",
    "observation",
  ];
  writeFileSync(
    outPath,
    [csvLine(headers), ...diffs.map((d) => csvLine(headers.map((h) => d[h as keyof DiffRow])))].join("\n"),
    "utf8"
  );

  const counts = {
    OK: diffs.filter((d) => d.classification === "OK").length,
    DIVERGENTE: diffs.filter((d) => d.classification === "DIVERGENTE").length,
    FALTANDO_NO_INDUSCOST: diffs.filter((d) => d.classification === "FALTANDO_NO_INDUSCOST").length,
    FALTANDO_NO_NOMUS: diffs.filter((d) => d.classification === "FALTANDO_NO_NOMUS").length,
  };

  console.log("--- Resultado ---");
  console.log(`Linhas comparadas: ${diffs.length}`);
  console.log(`OK: ${counts.OK}`);
  console.log(`DIVERGENTE: ${counts.DIVERGENTE}`);
  console.log(`FALTANDO_NO_INDUSCOST: ${counts.FALTANDO_NO_INDUSCOST}`);
  console.log(`FALTANDO_NO_NOMUS: ${counts.FALTANDO_NO_NOMUS}`);
  console.log(`\nCSV divergências: ${outPath}`);
}

main()
  .catch((err) => {
    console.error("Erro:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
