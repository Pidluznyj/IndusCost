import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTreasuryCaixaCanonicalDays } from "../domain/treasuryCaixaCanonicalDay.js";
import type { FinanceAccountsReceivableGridRow } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import type { FinanceAccountsPayableGridRow } from "@/src/lib/financeAccountsPayableRulesEngine.js";
import {
  adaptTreasuryCaixaCanonicalDaysToCashSupportRows,
  sumCashSupportCanonicalRowsByDimension,
} from "./cashSupportCanonicalAdapter.js";

function receivable(
  overrides: Partial<FinanceAccountsReceivableGridRow>
): FinanceAccountsReceivableGridRow {
  return {
    externalId: 1,
    companyName: null,
    personName: "Cliente A",
    personCnpj: null,
    dueDate: "2026-07-20",
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    hasSourceInvoice: false,
    calculatedStatus: "open",
    daysOverdue: 0,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    ...overrides,
  } as FinanceAccountsReceivableGridRow;
}

function payable(
  overrides: Partial<FinanceAccountsPayableGridRow>
): FinanceAccountsPayableGridRow {
  return {
    externalId: 1,
    companyName: null,
    personName: "Fornecedor A",
    personCnpj: null,
    dueDate: "2026-07-20",
    paymentDate: null,
    operationalDueDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    calculatedStatus: "open",
    daysOverdue: 0,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    ...overrides,
  } as FinanceAccountsPayableGridRow;
}

describe("cashSupportCanonicalAdapter", () => {
  it("título real (externalId > 0) vira OFFICIAL_RECEIVABLE, não conciliável neste adaptador", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [receivable({ externalId: 555, balanceReceivable: 1000 })],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });

    const rows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(days, "EMP1");
    const row = rows.find((r) => r.displayId.startsWith("receivable:due:555"));
    assert.ok(row);
    assert.equal(row!.resourceType, "OFFICIAL_RECEIVABLE");
    assert.equal(row!.officialTitleKey?.externalId, 555);
    assert.equal(row!.officialTitleKey?.companyCode, "EMP1");
    assert.equal(row!.forecastContextKey, null);
    assert.equal(row!.reconcilable, false); // decidido pelo orquestrador, não aqui
    assert.equal(row!.dueDate, "2026-07-20");
    assert.equal(row!.bankDate, null, "título sem evidência bancária não tem bankDate");
  });

  it("previsão (externalId sintético negativo) vira FORECAST, nunca conciliável", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [receivable({ externalId: -998877, balanceReceivable: 300 })],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });

    const rows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(days, "EMP1");
    const row = rows.find((r) => r.displayId.includes("-998877"));
    assert.ok(row);
    assert.equal(row!.resourceType, "FORECAST");
    assert.equal(row!.officialTitleKey, null);
    assert.equal(row!.reconcilable, false);
    assert.ok(row!.forecastContextKey);
    assert.ok(
      row!.warnings.some((w) => w.code === "FORECAST_CONTEXT_ONLY"),
      "deve avisar que é só contexto"
    );
    assert.equal(
      row!.availableActions.find((a) => a.kind === "RECONCILE")!.enabled,
      false
    );
  });

  it("CP real vira OFFICIAL_PAYABLE com dueDate, nunca bankDate (regra canônica: CP usa vencimento)", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [],
      payables: [payable({ externalId: 42, balancePayable: 500 })],
      openingBalanceOfFirstDay: 0,
    });

    const rows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(days, "EMP1");
    const row = rows.find((r) => r.displayId.startsWith("payable:due:42"));
    assert.ok(row);
    assert.equal(row!.resourceType, "OFFICIAL_PAYABLE");
    assert.equal(row!.direction, "OUT");
    assert.equal(row!.bankDate, null);
    assert.equal(row!.dueDate, "2026-07-20");
  });

  it("sem companyCode conhecido: título real fica sem officialTitleKey e com warning, nada inventado", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [receivable({ externalId: 77 })],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });

    const rows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(days, null);
    const row = rows.find((r) => r.displayId.startsWith("receivable:due:77"));
    assert.ok(row);
    assert.equal(row!.officialTitleKey, null, "não pode inventar companyCode");
    assert.equal(row!.companyContext, null);
    assert.ok(row!.warnings.some((w) => w.code === "COMPANY_CONTEXT_UNAVAILABLE"));
  });

  it("conta nunca é inventada — accountContext sempre null neste adaptador", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [receivable({ externalId: 1 })],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });
    const rows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(days, "EMP1");
    for (const row of rows) {
      assert.equal(row.accountContext, null);
      assert.ok(row.warnings.some((w) => w.code === "ACCOUNT_CONTEXT_UNAVAILABLE"));
    }
  });

  it("valores diários fecham no centavo com o motor canônico (paridade, sem segunda soma)", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20", "2026-07-21"],
      receivables: [
        receivable({ externalId: 1, dueDate: "2026-07-20", balanceReceivable: 1000 }),
        receivable({
          externalId: 2,
          dueDate: "2026-07-21",
          settlementDate: "2026-07-21",
          amountReceived: 400,
          balanceReceivable: 0,
        }),
      ],
      payables: [
        payable({ externalId: 10, dueDate: "2026-07-20", balancePayable: 250 }),
        payable({
          externalId: 11,
          dueDate: "2026-07-21",
          paymentDate: "2026-07-21",
          amountPaid: 180,
          balancePayable: 0,
        }),
      ],
      openingBalanceOfFirstDay: 0,
    });

    const rows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(days, "EMP1");
    const sums = sumCashSupportCanonicalRowsByDimension(rows);

    const canonicalTotals = days.reduce(
      (acc, d) => ({
        receivableDue: acc.receivableDue + d.receivableDue,
        receivableReceived: acc.receivableReceived + d.receivableReceived,
        payableDue: acc.payableDue + d.payableDue,
        payablePaid: acc.payablePaid + d.payablePaid,
      }),
      { receivableDue: 0, receivableReceived: 0, payableDue: 0, payablePaid: 0 }
    );

    assert.equal(sums.receivableDue, canonicalTotals.receivableDue.toFixed(2));
    assert.equal(sums.receivableReceived, canonicalTotals.receivableReceived.toFixed(2));
    assert.equal(sums.payableDue, canonicalTotals.payableDue.toFixed(2));
    assert.equal(sums.payablePaid, canonicalTotals.payablePaid.toFixed(2));
  });

  it("título recebido e título em aberto no mesmo dia não se sobrepõem (disjunção preservada)", () => {
    // Mesmo título nunca aparece em Due E Received simultaneamente — regra do
    // motor de origem. O adaptador não pode juntar as duas dimensões.
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [
        receivable({
          externalId: 900,
          dueDate: "2026-07-20",
          settlementDate: "2026-07-20",
          amountReceived: 1000,
          balanceReceivable: 0,
        }),
      ],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });
    const rows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(days, "EMP1");
    const dueRow = rows.find((r) => r.displayId.startsWith("receivable:due:900"));
    const receivedRow = rows.find((r) => r.displayId.startsWith("receivable:received:900"));
    assert.equal(dueRow, undefined, "título totalmente baixado não aparece em Due");
    assert.ok(receivedRow);
  });

  it("nenhum valor monetário é number — tudo string", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [receivable({ externalId: 1 })],
      payables: [payable({ externalId: 2 })],
      openingBalanceOfFirstDay: 0,
    });
    const rows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(days, "EMP1");
    for (const row of rows) {
      if (row.officialAmount != null) assert.equal(typeof row.officialAmount, "string");
      if (row.expectedAmount != null) assert.equal(typeof row.expectedAmount, "string");
      assert.equal(typeof row.residualAmount, "string");
    }
  });
});
