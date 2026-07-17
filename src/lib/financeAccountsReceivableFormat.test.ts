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
  readNomusLaunchDescriptionFromPayload,
  resolveFinanceLaunchDescription,
  safeFinanceNumber,
} from "./financeAccountsReceivableFormat.js";
import { buildFinanceArDashboardQuery, EMPTY_FINANCE_AR_UI_FILTERS } from "./financeAccountsReceivableDashboardTypes.js";

describe("financeAccountsReceivableFormat", () => {
  it("formatFinanceCurrency usa BRL com 2 casas", () => {
    assert.equal(formatFinanceCurrency(214190), "R$\u00a0214.190,00");
  });

  it("formatFinanceCurrencyCompact usa padrão KPI executivo", () => {
    assert.equal(formatFinanceCurrencyCompact(942.81), "R$\u00a0942,81");
    // Intl BRL usa NBSP (símbolo↔valor e número↔sufixo).
    assert.equal(formatFinanceCurrencyCompact(12_400), "R$\u00a012,4\u00a0mil");
    assert.equal(formatFinanceCurrencyCompact(827_500), "R$\u00a0827,5\u00a0mil");
    assert.equal(formatFinanceCurrencyCompact(5_830_000), "R$\u00a05,83\u00a0Mi");
    assert.doesNotMatch(formatFinanceCurrencyCompact(5_827_010.62), /5\.827\.010/);
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

  it("envia year e month quando informados", () => {
    const qs = buildFinanceArDashboardQuery({
      ...EMPTY_FINANCE_AR_UI_FILTERS,
      year: "2026",
      month: "6",
    });
    assert.match(qs, /year=2026/);
    assert.match(qs, /month=6/);
  });

  it("não envia year/month vazios", () => {
    const qs = buildFinanceArDashboardQuery(EMPTY_FINANCE_AR_UI_FILTERS);
    assert.doesNotMatch(qs, /year=/);
    assert.doesNotMatch(qs, /month=/);
  });

  it("normaliza month sem year para ano corrente na query", () => {
    const currentYear = new Date().getFullYear();
    const qs = buildFinanceArDashboardQuery({
      ...EMPTY_FINANCE_AR_UI_FILTERS,
      month: "3",
    });
    assert.match(qs, new RegExp(`year=${currentYear}`));
    assert.match(qs, /month=3/);
  });

  it("envia invoiceIssued quando diferente de all", () => {
    const qs = buildFinanceArDashboardQuery({
      ...EMPTY_FINANCE_AR_UI_FILTERS,
      invoiceIssued: "no",
    });
    assert.match(qs, /invoiceIssued=no/);
  });

  it("não envia invoiceIssued=all", () => {
    const qs = buildFinanceArDashboardQuery(EMPTY_FINANCE_AR_UI_FILTERS);
    assert.doesNotMatch(qs, /invoiceIssued=/);
  });

  it("resolveFinanceLaunchDescription prioriza description e faz fallback no payload Nomus", () => {
    assert.equal(resolveFinanceLaunchDescription({ description: "  Parcela NF 100  " }), "Parcela NF 100");
    assert.equal(
      resolveFinanceLaunchDescription({
        description: null,
        rawPayload: { descricaoLancamento: "Do payload" },
      }),
      "Do payload"
    );
    assert.equal(resolveFinanceLaunchDescription({ description: "" }), null);
    assert.equal(readNomusLaunchDescriptionFromPayload(null), null);
  });
});
