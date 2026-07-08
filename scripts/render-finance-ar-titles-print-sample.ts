#!/usr/bin/env npx tsx
/**
 * Gera HTML de amostra do PDF Contas a Receber > Títulos (cenário Esmaltec).
 * Abra o arquivo no navegador e use Imprimir > Salvar como PDF.
 *
 * Uso: npx tsx scripts/render-finance-ar-titles-print-sample.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { FinanceAccountsReceivableTitlesPrintDocument } from "../src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.js";
import { createDefaultFinanceArAnalyticalUiFilters } from "../src/lib/financeAccountsReceivableDashboardTypes.js";
import type { FinanceArTitleListItem } from "../src/lib/financeAccountsReceivableTitles.js";
import { readFileSync } from "node:fs";

const css = readFileSync(
  join(process.cwd(), "src/components/finance/finance-ar-titles-print.css"),
  "utf8"
);

const sampleRows: FinanceArTitleListItem[] = [
  {
    externalId: 1001,
    personName: "Esmaltec S/A",
    companyName: "Lazarios",
    sourceInvoiceNumber: "NF-45821",
    sourceInvoiceId: 45821,
    competenceDate: "2026-05-10T00:00:00.000Z",
    dueDate: "2026-07-15T00:00:00.000Z",
    settlementDate: null,
    calculatedStatus: "DUE_SOON",
    daysOverdue: -7,
    amountReceivable: 12500,
    amountReceived: 0,
    balanceReceivable: 12500,
  },
  {
    externalId: 1002,
    personName: "Esmaltec S/A",
    companyName: "Lazarios",
    sourceInvoiceNumber: "NF-45822",
    sourceInvoiceId: 45822,
    competenceDate: "2026-04-02T00:00:00.000Z",
    dueDate: "2026-06-01T00:00:00.000Z",
    settlementDate: null,
    calculatedStatus: "OVERDUE",
    daysOverdue: 37,
    amountReceivable: 8200,
    amountReceived: 0,
    balanceReceivable: 8200,
  },
  {
    externalId: 1003,
    personName: "Esmaltec S/A",
    companyName: "Lazarios",
    sourceInvoiceNumber: "NF-45830",
    sourceInvoiceId: 45830,
    competenceDate: "2026-06-20T00:00:00.000Z",
    dueDate: "2026-08-10T00:00:00.000Z",
    settlementDate: null,
    calculatedStatus: "OPEN",
    daysOverdue: 0,
    amountReceivable: 5400,
    amountReceived: 0,
    balanceReceivable: 5400,
  },
];

const filters = {
  ...createDefaultFinanceArAnalyticalUiFilters(),
  customerName: "Esmaltec S/A",
  year: "2026",
  status: "open",
  invoiceIssued: "yes",
};

const totalOriginal = sampleRows.reduce((s, r) => s + r.amountReceivable, 0);
const totalOpen = sampleRows.reduce((s, r) => s + r.balanceReceivable, 0);
const totalOverdue = sampleRows
  .filter((r) => r.calculatedStatus === "OVERDUE")
  .reduce((s, r) => s + r.balanceReceivable, 0);
const totalDue = sampleRows
  .filter((r) => r.calculatedStatus === "DUE_SOON" || r.calculatedStatus === "OPEN")
  .reduce((s, r) => s + r.balanceReceivable, 0);

const payload = {
  items: sampleRows,
  summary: {
    totalTitles: sampleRows.length,
    totalOriginalValue: totalOriginal,
    totalReceivedValue: 0,
    totalOpenValue: totalOpen,
    totalOverdueValue: totalOverdue,
    totalDueValue: totalDue,
    averageTicket: totalOriginal / sampleRows.length,
  },
  page: 1,
  limit: sampleRows.length,
  total: sampleRows.length,
};

const branding = {
  companyName: "Grupo Lazarios",
  logoUrl: null,
  logoDataUrl: null,
  primaryColor: "#1d4ed8",
};

const body = renderToStaticMarkup(
  React.createElement(FinanceAccountsReceivableTitlesPrintDocument, {
    payload,
    filters,
    allItems: sampleRows,
    generatedAt: "2026-07-08T14:30:00.000Z",
    emitterName: "Paulo Koppetel",
    branding,
  })
);

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Contas a Receber — Títulos (amostra Esmaltec)</title>
  <style>${css}</style>
  <style>
    body { margin: 0; background: #e2e8f0; }
    #ar-titles-print-root { display: block !important; max-width: 297mm; margin: 12px auto; background: #fff; padding: 8mm; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
  </style>
</head>
<body class="ar-titles-print-route">
  ${body}
</body>
</html>`;

const outDir = join(process.cwd(), "scripts", "output");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "finance-ar-titles-print-sample-esmaltec.html");
writeFileSync(outPath, html, "utf8");
console.log(`Amostra gerada: ${outPath}`);
console.log("Abra no navegador e use Ctrl+P > Salvar como PDF para comparar o layout.");
