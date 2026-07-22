import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceApTitlesPrintSummary,
  resolveFinanceApTitleDocumentReference,
  FINANCE_AP_TITLES_PRINT_PAGE_SIZE,
} from "./financeApTitlesPrint.js";
import {
  buildFinanceApTitlesPrintFilterLines,
  FINANCE_AP_TITLES_PRINT_LOGO_MAX_HEIGHT_PX,
  FINANCE_AP_TITLES_PRINT_LOGO_MAX_WIDTH_PX,
} from "./financeApTitlesPrintMeta.js";
import { createDefaultFinanceApUiFilters } from "./financeAccountsPayableDashboardTypes.js";
import type { FinanceApTitleListItem } from "./financeAccountsPayableTitles.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

function item(
  partial: Partial<FinanceApTitleListItem> & Pick<FinanceApTitleListItem, "externalId">
): FinanceApTitleListItem {
  return {
    companyName: null,
    personName: "Fornecedor X",
    personCnpj: null,
    description: null,
    sourceInvoiceId: null,
    documentNumber: null,
    dueDate: null,
    scheduleDate: null,
    operationalDueDate: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 100,
    amountPaid: 0,
    balancePayable: 100,
    paymentMethodName: null,
    bankAccountName: null,
    calculatedStatus: "overdue",
    nomusStatus: false,
    daysOverdue: 5,
    suspendPayment: false,
    type: null,
    exclusionReason: null,
    isPurchaseOrderSchedule: false,
    syncedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("financeApTitlesPrint", () => {
  it("CSS de impressão ativa display block no print root", () => {
    const css = read("src/components/finance/finance-ap-titles-print.css");
    assert.match(css, /#ap-titles-print-root\s*\{[\s\S]*?display:\s*none/);
    assert.match(
      css,
      /@media print[\s\S]*#ap-titles-print-root\s*\{[\s\S]*?display:\s*block\s*!important/
    );
  });

  it("global reports-print inclui rota AP", () => {
    const global = read("src/reports-print.css");
    assert.match(global, /body\.ap-titles-print-route #root[\s\S]*display:\s*none\s*!important/);
    assert.match(global, /#ap-titles-print-root,/);
  });

  it("capa e documento espelham o padrão AR", () => {
    const cover = read("src/components/finance/FinanceAccountsPayableTitlesPrintCover.tsx");
    const doc = read("src/components/finance/FinanceAccountsPayableTitlesPrintDocument.tsx");
    const tab = read("src/components/finance/FinanceAccountsPayableTitlesTab.tsx");
    assert.match(cover, /PrintHeader/);
    assert.match(cover, /documentTitle="CONTAS A PAGAR"/);
    assert.match(cover, /documentHighlight="TÍTULOS"/);
    assert.match(doc, /id="ap-titles-print-root"/);
    assert.match(doc, /Valor pago/);
    assert.match(tab, /Exportar PDF/);
    assert.match(tab, /FINANCE_AP_TITLES_PRINT_PAGE_SIZE/);
    assert.match(tab, /canExport/);
    assert.equal(FINANCE_AP_TITLES_PRINT_LOGO_MAX_WIDTH_PX, 106);
    assert.equal(FINANCE_AP_TITLES_PRINT_LOGO_MAX_HEIGHT_PX, 83);
    assert.equal(FINANCE_AP_TITLES_PRINT_PAGE_SIZE, 50_000);
  });

  it("monta linhas de filtro e resumo", () => {
    const filters = {
      ...createDefaultFinanceApUiFilters(),
      personName: "Fornecedor Y",
      year: "2026",
      status: "overdue",
    };
    const lines = buildFinanceApTitlesPrintFilterLines(filters);
    assert.ok(lines.some((l) => l.includes("Fornecedor Y")));
    assert.ok(lines.some((l) => l.includes("2026")));
    assert.ok(lines.some((l) => l.includes("Atrasado")));

    const summary = buildFinanceApTitlesPrintSummary([
      item({ externalId: 1, amountPayable: 200, amountPaid: 50, balancePayable: 150 }),
      item({
        externalId: 2,
        amountPayable: 100,
        amountPaid: 100,
        balancePayable: 0,
        calculatedStatus: "settled",
      }),
    ]);
    assert.equal(summary.totalTitles, 2);
    assert.equal(summary.totalOriginalValue, 300);
    assert.equal(summary.totalPaidValue, 150);
    assert.equal(summary.totalOpenValue, 150);
    assert.equal(summary.totalOverdueValue, 150);
    assert.equal(resolveFinanceApTitleDocumentReference({
      documentNumber: "NF-9",
      sourceInvoiceId: 1,
      description: "x",
    }), "NF-9");
  });

  it("página passa canExport para a aba Títulos", () => {
    const page = read("src/components/finance/FinanceAccountsPayablePage.tsx");
    assert.match(page, /canExport=\{canExport\}/);
  });
});
