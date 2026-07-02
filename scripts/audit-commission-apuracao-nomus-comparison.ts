#!/usr/bin/env npx tsx
/**
 * Compara linhas de apuração IndusCost com export CSV do Nomus.
 *
 * CSV Nomus esperado (cabeçalhos flexíveis):
 *   vendedor, cliente, nfe, contaReceber, baseCalculo, percentual, comissao
 *
 * Uso:
 *   npx tsx scripts/audit-commission-apuracao-nomus-comparison.ts \
 *     --year=2026 --month=6 --seller="GISLENE LIMA" --file=./nomus-apuracao-98.csv
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listCommissionApuracaoPage } from "../src/lib/commissions/commissionApuracao.server.ts";
import { parseCommissionApuracaoQuery } from "../src/lib/commissions/commissionQuery.ts";
import { requireDatabaseUrl, parseArg, csvLine } from "./commission-script-utils.ts";
import type { CommissionAccessScope } from "../src/lib/commissions/commissionAccessScope.ts";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

type NomusRow = {
  seller: string;
  customer: string;
  nfe: string;
  receivable: string;
  base: number;
  rate: number;
  commission: number;
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "");
}

function parseNomusCsv(content: string): NomusRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map(normalizeHeader);
  const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

  const sellerI = idx(["vendedor", "seller"]);
  const customerI = idx(["cliente", "customer"]);
  const nfeI = idx(["nfe", "nota"]);
  const receivableI = idx(["conta", "receber", "duplicata"]);
  const baseI = idx(["base", "calculo"]);
  const rateI = idx(["percent", "%"]);
  const commissionI = idx(["comissao", "commission"]);

  const parseNum = (v: string) => {
    const n = Number.parseFloat(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      seller: sellerI >= 0 ? (cols[sellerI] ?? "").trim() : "",
      customer: customerI >= 0 ? (cols[customerI] ?? "").trim() : "",
      nfe: nfeI >= 0 ? (cols[nfeI] ?? "").trim() : "",
      receivable: receivableI >= 0 ? (cols[receivableI] ?? "").trim() : "",
      base: baseI >= 0 ? parseNum(cols[baseI] ?? "0") : 0,
      rate: rateI >= 0 ? parseNum(cols[rateI] ?? "0") : 0,
      commission: commissionI >= 0 ? parseNum(cols[commissionI] ?? "0") : 0,
    };
  });
}

function matchKey(row: { nfe: string; receivable: string; customer: string }): string {
  return `${row.nfe}|${row.receivable}|${row.customer}`.toUpperCase();
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const year = parseArg("year") ?? "2026";
  const month = parseArg("month") ?? "6";
  const seller = parseArg("seller") ?? "";
  const file = parseArg("file");

  const query = parseCommissionApuracaoQuery({
    year,
    month,
    page: "1",
    pageSize: "10000",
    nomusReferenceBase: "808107.32",
    nomusReferenceCommission: "20926.56",
  });

  const payload = await listCommissionApuracaoPage(query, GLOBAL_SCOPE);
  let indusLines = payload.lines;
  if (seller) {
    const s = seller.toUpperCase();
    indusLines = indusLines.filter((l) => l.commissionPersonName.toUpperCase().includes(s));
  }

  console.log("=== Comparação IndusCost x Nomus ===");
  console.log(`Período: ${month}/${year}`);
  console.log(`Linhas IndusCost: ${indusLines.length}`);
  console.log(
    `Total comissão IndusCost: R$ ${payload.totals.commissionCalculatedTotal.toFixed(2)}`
  );

  if (!file) {
    console.log("\nInforme --file=caminho.csv com export Nomus para comparar linha a linha.");
    return;
  }

  const nomusRows = parseNomusCsv(readFileSync(resolve(file), "utf8"));
  console.log(`Linhas Nomus (arquivo): ${nomusRows.length}`);

  const indusByKey = new Map(
    indusLines.map((l) => [
      matchKey({
        nfe: l.nfeNumber ?? "",
        receivable: l.receivableCode ?? "",
        customer: l.customerName ?? "",
      }),
      l,
    ])
  );

  let ok = 0;
  let diffValue = 0;
  let notFound = 0;

  for (const nomus of nomusRows) {
    const key = matchKey(nomus);
    const indus = indusByKey.get(key);
    if (!indus) {
      notFound += 1;
      continue;
    }
    const diff = Math.abs(indus.commissionCalculated - nomus.commission);
    if (diff < 0.02 && Math.abs(indus.ratePercent - nomus.rate) < 0.01) ok += 1;
    else diffValue += 1;
  }

  console.log(`\nOK: ${ok} | DIFERENCA_VALOR: ${diffValue} | NF/CR não encontrada: ${notFound}`);
  console.log("\nAmostra divergências (até 10):");
  let shown = 0;
  for (const nomus of nomusRows) {
    const indus = indusByKey.get(matchKey(nomus));
    if (!indus) continue;
    const diff = Math.abs(indus.commissionCalculated - nomus.commission);
    if (diff >= 0.02) {
      console.log(
        csvLine([
          nomus.nfe,
          nomus.receivable,
          nomus.commission.toFixed(2),
          indus.commissionCalculated.toFixed(2),
          (indus.commissionCalculated - nomus.commission).toFixed(2),
        ])
      );
      shown += 1;
      if (shown >= 10) break;
    }
  }
}

main().catch((err) => {
  console.error("Erro:", err instanceof Error ? err.message : err);
  process.exit(1);
});
