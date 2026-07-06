import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerExclusionAuditCsv,
  buildCustomerExclusionAuditReport,
  buildExcludedCustomerVisualAuditInput,
  buildUiValidationFromVisualRows,
} from "./commissionCustomerExclusionAudit.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  buildExclusionImpactPreview,
  parseExclusionReprocessCustomerFilter,
  parseExclusionReprocessDateRange,
  type ExclusionImpactLine,
} from "./commissionCustomerExclusionReprocess.js";
import {
  buildVisualAuditCsv,
  buildVisualAuditRow,
  computeVisualAuditCards,
} from "./commissionVisualAudit.js";
import {
  aggregateMonthlyPayableFromRows,
  buildMonthlyPayableSellerSummaryCsv,
} from "./commissionMonthlyPayable.js";
import {
  aggregateReceivableForecastFromRows,
  buildReceivableForecastMonthlyCsv,
} from "./commissionReceivableForecast.js";
import { roundMoney } from "./commission-money.js";

const EXCLUDED_CUSTOMER_NAME = "CLIENTE EXCLUIDO SA";
const EXCLUSION_REASON = "Cliente corporativo sem comissão";

const dateRange = parseExclusionReprocessDateRange({
  from: "2026-01-01",
  to: "2026-12-31",
});

const exclusionRule: CustomerExclusionRuleSnapshot = {
  id: "rule-excluded-demo",
  customerId: null,
  customerExternalId: 77001,
  customerNameSnapshot: EXCLUDED_CUSTOMER_NAME,
  normalizedCustomerName: "cliente excluido sa",
  reason: EXCLUSION_REASON,
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
  status: "ACTIVE",
  notes: null,
};

function impactLine(overrides: Partial<ExclusionImpactLine> = {}): ExclusionImpactLine {
  return {
    recordId: "rec-ex-1",
    orderCode: "PV-77001",
    nfeNumber: "770100",
    nomusReceivableIds: [88001],
    customerName: EXCLUDED_CUSTOMER_NAME,
    sellerId: "seller-1",
    sellerName: "Vendedor Demo",
    status: "RELEASED",
    referenceDate: "2026-03-10",
    referenceDateKind: "nfe",
    settlementMonthKeys: ["2026-06"],
    dueMonthKeys: ["2026-04"],
    baseAmount: 5000,
    currentRatePercent: 2,
    currentCommissionAmount: 100,
    currentReleasedAmount: 50,
    currentPaidAmount: 0,
    afterRatePercent: 0,
    afterCommissionAmount: 0,
    afterReleasedAmount: 0,
    commissionDiff: -100,
    exclusionRuleId: exclusionRule.id,
    exclusionReason: EXCLUSION_REASON,
    alreadyExcluded: false,
    paidBlocked: false,
    titleCategory: "settled",
    wouldChange: true,
    ...overrides,
  };
}

describe("commissionCustomerExclusionAudit", () => {
  it("fixture de cliente excluído zera comissão nas três apurações", () => {
    const settled = buildVisualAuditRow(
      buildExcludedCustomerVisualAuditInput({
        settlementDate: "2026-06-12T00:00:00.000Z",
        receivedAmount: 5000,
        openBalance: 0,
        commissionExpected: 0,
        commissionReleased: 0,
      })
    );
    const openFuture = buildVisualAuditRow(
      buildExcludedCustomerVisualAuditInput({
        lineId: "excluded:r2:s2",
        recordId: "r-excluded-2",
        scheduleId: "s-excluded-2",
        nomusReceivableId: 88002,
        settlementDate: null,
        receivedAmount: 0,
        openBalance: 3000,
        dueDate: "2026-08-01T00:00:00.000Z",
        commissionExpected: 0,
        commissionReleased: 0,
      })
    );

    const rows = [settled, openFuture];
    const ui = buildUiValidationFromVisualRows(rows, EXCLUSION_REASON);

    assert.equal(ui.visualAudit.commissionZero, true);
    assert.equal(ui.visualAudit.basePreserved, true);
    assert.equal(ui.visualAudit.statusSemComissao, true);
    assert.equal(ui.monthlyClosing.releasedCommissionZero, true);
    assert.equal(ui.forecast.forecastCommissionZero, true);
    assert.equal(ui.generated.generatedCommissionZero, true);
  });

  it("fechamento mensal retorna comissão liberada zero para cliente excluído", () => {
    const row = buildVisualAuditRow(
      buildExcludedCustomerVisualAuditInput({
        settlementDate: "2026-06-15T00:00:00.000Z",
        receivedAmount: 5000,
        commissionReleased: 0,
        commissionExpected: 0,
      })
    );
    const summary = aggregateMonthlyPayableFromRows([row], { year: 2026, month: 6 });
    assert.equal(summary.payableCommissionTotal, 0);
    assert.ok(summary.receivedAmountTotal > 0);
    const csv = buildMonthlyPayableSellerSummaryCsv(summary);
    assert.match(csv, /comissao_liberada/);
  });

  it("previsão retorna comissão prevista zero para cliente excluído", () => {
    const row = buildVisualAuditRow(
      buildExcludedCustomerVisualAuditInput({
        settlementDate: null,
        receivedAmount: 0,
        openBalance: 5000,
        dueDate: "2026-08-15T00:00:00.000Z",
        commissionExpected: 0,
      })
    );
    const summary = aggregateReceivableForecastFromRows([row], { year: 2026, month: 8 });
    const forecastTotal = roundMoney(
      summary.cards.futureCommissionTotal + summary.cards.overdueCommissionTotal
    );
    assert.equal(forecastTotal, 0);
    const csv = buildReceivableForecastMonthlyCsv(summary);
    assert.match(csv, /comissao_prevista_futura=0/);
  });

  it("apuracao GENERATED retorna comissão prevista zero", () => {
    const row = buildVisualAuditRow(buildExcludedCustomerVisualAuditInput());
    const cards = computeVisualAuditCards([row], "GENERATED");
    assert.equal(cards.commissionExpectedTotal, 0);
    assert.ok(cards.commissionableBaseTotal > 0);
  });

  it("export contém motivo e regra de exclusão", () => {
    const row = buildVisualAuditRow(buildExcludedCustomerVisualAuditInput());
    const csv = buildVisualAuditCsv([row], computeVisualAuditCards([row], "GENERATED"));
    assert.match(csv, /motivoExclusao/);
    assert.match(csv, /regraExclusaoId/);
    assert.match(csv, /comissionavel/);
    assert.match(csv, /NAO/);
    assert.match(csv, new RegExp(EXCLUSION_REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("buildCustomerExclusionAuditReport agrega impacto por mês", () => {
    const preview = buildExclusionImpactPreview({
      customerFilter: parseExclusionReprocessCustomerFilter({
        customer: EXCLUDED_CUSTOMER_NAME,
      }),
      dateRange,
      rules: [exclusionRule],
      records: [],
      paidBlockAutoChange: true,
      closedMonths: [],
    });
    const previewWithLines = {
      ...preview,
      lines: [
        impactLine(),
        impactLine({
          recordId: "rec-ex-2",
          orderCode: "PV-77002",
          referenceDate: "2026-04-20",
          baseAmount: 2000,
          currentCommissionAmount: 40,
          commissionDiff: -40,
        }),
      ],
      ordersAffected: 2,
      nfesAffected: 2,
      totals: {
        ...preview.totals,
        currentCommission: 140,
        afterCommission: 0,
        commissionDiff: -140,
        wouldChangeCount: 2,
      },
    };

    const report = buildCustomerExclusionAuditReport({
      preview: previewWithLines,
      rules: [exclusionRule],
      receivedByRecordId: new Map([
        ["rec-ex-1", 5000],
        ["rec-ex-2", 2000],
      ]),
    });

    assert.equal(report.ruleRegistered, true);
    assert.equal(report.rules[0]?.id, exclusionRule.id);
    assert.equal(report.summary.ordersCount, 2);
    assert.equal(report.summary.commissionAfterTotal, 0);
    assert.equal(report.summary.receivedAmountTotal, 7000);
    assert.ok(report.byReferenceMonth.length >= 2);
    assert.equal(report.uiValidation.csv.hasMotivoExclusaoColumn, true);
  });

  it("audit CSV inclui base, comissão e motivo", () => {
    const report = buildCustomerExclusionAuditReport({
      preview: {
        ...buildExclusionImpactPreview({
          customerFilter: { customerName: EXCLUDED_CUSTOMER_NAME },
          dateRange,
          rules: [exclusionRule],
          records: [],
          paidBlockAutoChange: false,
        }),
        lines: [impactLine()],
        ordersAffected: 1,
        totals: {
          currentCommission: 100,
          afterCommission: 0,
          commissionDiff: -100,
          currentReleased: 50,
          afterReleased: 0,
          paidBlockedCount: 0,
          wouldChangeCount: 1,
        },
      },
      rules: [exclusionRule],
    });
    const csv = buildCustomerExclusionAuditCsv(report);
    assert.match(csv, /motivo/);
    assert.match(csv, /comissao_apos/);
    assert.match(csv, new RegExp(EXCLUSION_REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
