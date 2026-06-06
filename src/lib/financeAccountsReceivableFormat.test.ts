import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinanceDate,
  formatFinanceInteger,
  formatFinanceMonthLabel,
  formatFinancePercent,
  formatFinanceDaysOverdue,
  safeFinanceNumber,
} from "./financeAccountsReceivableFormat.js";
import { buildFinanceArDashboardQuery, EMPTY_FINANCE_AR_UI_FILTERS } from "./financeAccountsReceivableDashboardTypes.js";

describe("financeAccountsReceivableFormat", () => {
  it("formatFinanceCurrency usa BRL com 2 casas", () => {
    assert.equal(formatFinanceCurrency(214190), "R$\u00a0214.190,00");
  });

  it("formatFinanceCurrencyCompact compacta milhões", () => {
    assert.match(formatFinanceCurrencyCompact(1_250_000), /1,25 Mi/);
    assert.match(formatFinanceCurrencyCompact(350_000), /350,00 mil/);
  });

  it("formatFinancePercent", () => {
    assert.equal(formatFinancePercent(12.5), "12,5%");
  });

  it("formatFinanceInteger", () => {
    assert.equal(formatFinanceInteger(5718), "5.718");
  });

  it("formatFinanceDate dd/mm/aaaa", () => {
    assert.equal(formatFinanceDate("2026-06-06T15:00:00.000Z"), "06/06/2026");
  });

  it("safeFinanceNumber evita NaN", () => {
    assert.equal(safeFinanceNumber(NaN), 0);
    assert.equal(safeFinanceNumber(undefined), 0);
    assert.equal(safeFinanceNumber("abc", 7), 7);
  });

  it("formatFinanceCalculatedStatus traduz status", () => {
    assert.equal(formatFinanceCalculatedStatus("overdue"), "Atrasado");
    assert.equal(formatFinanceCalculatedStatus("unknown"), "Indefinido");
  });

  it("formatFinanceDaysOverdue", () => {
    assert.equal(formatFinanceDaysOverdue(0), "—");
    assert.equal(formatFinanceDaysOverdue(15), "15");
  });

  it("formatFinanceMonthLabel rejeita valores inválidos", () => {
    assert.equal(formatFinanceMonthLabel(2026, 13), "—");
    assert.match(formatFinanceMonthLabel(2026, 6), /jun/i);
  });
});

describe("buildFinanceArDashboardQuery", () => {
  it("monta query params opcionais", () => {
    const qs = buildFinanceArDashboardQuery({
      ...EMPTY_FINANCE_AR_UI_FILTERS,
      companyName: "Empresa",
      status: "overdue",
      dueDateFrom: "2026-06-01",
    });
    assert.match(qs, /companyName=Empresa/);
    assert.match(qs, /status=overdue/);
    assert.match(qs, /dueDateFrom=2026-06-01/);
  });

  it("não envia status=all", () => {
    const qs = buildFinanceArDashboardQuery(EMPTY_FINANCE_AR_UI_FILTERS);
    assert.doesNotMatch(qs, /status=/);
  });
});
