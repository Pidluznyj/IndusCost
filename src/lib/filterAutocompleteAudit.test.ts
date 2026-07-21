import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  FILTER_AUTOCOMPLETE_AUDIT,
  filterAutocompleteAuditByStatus,
  filterAutocompleteAuditFixed,
  isInternalCompanyFilter,
} from "./filterAutocompleteAudit.js";

test("lista telas com filtros de cliente/pessoa", () => {
  assert.ok(FILTER_AUTOCOMPLETE_AUDIT.length >= 10);
  const screens = new Set(FILTER_AUTOCOMPLETE_AUDIT.map((e) => e.screen));
  assert.ok(screens.has("Financeiro > Contas a Receber"));
  assert.ok(screens.has("Pedidos de Venda"));
});

test("identifica entradas corrigidas", () => {
  const fixed = filterAutocompleteAuditFixed();
  assert.ok(fixed.some((e) => e.id === "finance-ar-customer"));
  assert.ok(fixed.some((e) => e.id === "finance-cash-flow-customer"));
  assert.ok(fixed.some((e) => e.id === "sales-orders-customer"));
  assert.ok(fixed.every((e) => e.status === "fixed"));
});

test("identifica autocomplete já existente", () => {
  const existing = filterAutocompleteAuditByStatus("already_autocomplete");
  assert.ok(existing.some((e) => e.id === "customer-module-list"));
  assert.ok(existing.some((e) => e.id === "projects-customer-lookup"));
});

test("identifica pendentes por falta de endpoint", () => {
  const pending = filterAutocompleteAuditByStatus("pending_no_endpoint");
  assert.ok(pending.some((e) => e.entity === "product"));
});

test("não marca filtro de empresa interna como cliente", () => {
  const company = FILTER_AUTOCOMPLETE_AUDIT.find((e) => e.id === "finance-cash-flow-company");
  assert.ok(company);
  assert.equal(company!.entity, "company_internal");
  assert.ok(isInternalCompanyFilter(company!));
  assert.equal(company!.status, "not_applicable");
});

test("fornecedor AP permanece texto livre documentado", () => {
  const ap = FILTER_AUTOCOMPLETE_AUDIT.find((e) => e.id === "finance-ap-supplier");
  assert.equal(ap?.status, "keep_free_text");
});

test("Relatório Presidencial documentado como não aplicável", () => {
  const exec = FILTER_AUTOCOMPLETE_AUDIT.find((e) => e.id === "finance-executive-report-customer");
  assert.equal(exec?.status, "not_applicable");
});

test("telas corrigidas importam CustomerAutocompleteFilter", () => {
  const files = [
    "src/components/finance/FinanceAccountsReceivablePage.tsx",
    "src/components/finance/FinanceCashFlowPage.tsx",
    "src/components/SalesOrdersModule.tsx",
    "src/components/commercial/SoldProductsReportPage.tsx",
    "src/components/contextual/ProductMaterialDemandDashboard.tsx",
    "src/components/commercial/OutputDocumentsModule.tsx",
  ];
  for (const file of files) {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    assert.ok(
      src.includes("CustomerAutocompleteFilter"),
      `${file} deve usar CustomerAutocompleteFilter`
    );
  }
});
