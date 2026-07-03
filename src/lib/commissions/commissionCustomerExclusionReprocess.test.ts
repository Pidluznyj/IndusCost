import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExclusionImpactPreview,
  evaluateExclusionReprocessSafety,
  parseExclusionReprocessCustomerFilter,
  parseExclusionReprocessDateRange,
  parseExclusionReprocessMode,
  recordMatchesCustomerFilter,
  simulateExclusionImpactLine,
  type ExclusionReprocessRecordInput,
} from "./commissionCustomerExclusionReprocess.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";

const dateRange = parseExclusionReprocessDateRange({
  from: "2026-01-01",
  to: "2026-12-31",
});

const esmaltecRule: CustomerExclusionRuleSnapshot = {
  id: "rule-esmaltec",
  customerId: null,
  customerExternalId: 9001,
  customerNameSnapshot: "ESMALTEC",
  normalizedCustomerName: "esmaltec",
  reason: "Cliente corporativo sem comissão",
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
  status: "ACTIVE",
  notes: null,
};

const otherCustomerRule: CustomerExclusionRuleSnapshot = {
  ...esmaltecRule,
  id: "rule-other",
  customerExternalId: 8000,
  customerNameSnapshot: "OUTRO CLIENTE",
  normalizedCustomerName: "outro cliente",
};

function baseRecord(
  overrides: Partial<ExclusionReprocessRecordInput> = {}
): ExclusionReprocessRecordInput {
  return {
    recordId: "rec-1",
    orderCode: "PV-100",
    nfeNumber: "12345",
    nomusNfeId: 555,
    customerExternalId: 9001,
    customerName: "ESMALTEC S/A",
    commissionPersonId: "seller-1",
    commissionPersonName: "Vendedor A",
    status: "RELEASED",
    originStage: "OUTPUT_DOCUMENT",
    baseAmount: 1000,
    ratePercent: 2,
    commissionAmount: 20,
    releasedAmount: 10,
    paidAmount: 0,
    confirmedAt: new Date("2026-03-15"),
    calculatedAt: new Date("2026-03-15"),
    metadataJson: {},
    schedules: [
      {
        id: "sch-1",
        nomusReceivableId: 7001,
        dueDate: new Date("2026-04-01"),
        settlementDate: new Date("2026-04-10"),
        commissionExpectedAmount: 20,
        commissionReleasedAmount: 10,
        receivedAmount: 500,
      },
    ],
    ...overrides,
  };
}

describe("commissionCustomerExclusionReprocess", () => {
  it("parseExclusionReprocessMode default dry-run", () => {
    assert.equal(parseExclusionReprocessMode({}), "dry-run");
    assert.equal(parseExclusionReprocessMode({ apply: true }), "apply");
  });

  it("preview não altera dados — simulate apenas calcula diff", () => {
    const line = simulateExclusionImpactLine({
      record: baseRecord(),
      rules: [esmaltecRule],
      dateRange,
      paidBlockAutoChange: true,
    });
    assert.ok(line);
    assert.equal(line!.afterCommissionAmount, 0);
    assert.equal(line!.commissionDiff, -20);
    assert.equal(line!.wouldChange, true);
  });

  it("apply exige flag — modo default dry-run", () => {
    assert.equal(parseExclusionReprocessMode({ dryRun: true }), "dry-run");
    assert.throws(() => parseExclusionReprocessMode({ apply: true, dryRun: true }));
  });

  it("regra afeta somente cliente correto", () => {
    const line = simulateExclusionImpactLine({
      record: baseRecord({ customerExternalId: 8000, customerName: "OUTRO CLIENTE" }),
      rules: [esmaltecRule],
      dateRange,
      paidBlockAutoChange: true,
    });
    assert.equal(line, null);
  });

  it("respeita vigência — regra futura não zera venda anterior", () => {
    const futureRule: CustomerExclusionRuleSnapshot = {
      ...esmaltecRule,
      effectiveFrom: new Date("2027-01-01"),
    };
    const line = simulateExclusionImpactLine({
      record: baseRecord({ confirmedAt: new Date("2026-06-01") }),
      rules: [futureRule],
      dateRange,
      paidBlockAutoChange: true,
    });
    assert.equal(line, null);
  });

  it("regra inativa não aplica", () => {
    const inactiveRule: CustomerExclusionRuleSnapshot = {
      ...esmaltecRule,
      status: "INACTIVE",
    };
    const line = simulateExclusionImpactLine({
      record: baseRecord(),
      rules: [inactiveRule],
      dateRange,
      paidBlockAutoChange: true,
    });
    assert.equal(line, null);
  });

  it("não altera meses fora do range", () => {
    const line = simulateExclusionImpactLine({
      record: baseRecord({ confirmedAt: new Date("2025-12-31") }),
      rules: [esmaltecRule],
      dateRange,
      paidBlockAutoChange: true,
    });
    assert.equal(line, null);
  });

  it("comissão já zero permanece zero", () => {
    const line = simulateExclusionImpactLine({
      record: baseRecord({
        commissionAmount: 0,
        ratePercent: 0,
        releasedAmount: 0,
        metadataJson: {
          customerExcluded: true,
          exclusionRuleId: esmaltecRule.id,
          exclusionReason: esmaltecRule.reason,
        },
      }),
      rules: [esmaltecRule],
      dateRange,
      paidBlockAutoChange: true,
    });
    assert.ok(line);
    assert.equal(line!.alreadyExcluded, true);
    assert.equal(line!.wouldChange, false);
    assert.equal(line!.commissionDiff, 0);
  });

  it("buildExclusionImpactPreview agrega por vendedor e mês", () => {
    const preview = buildExclusionImpactPreview({
      customerFilter: parseExclusionReprocessCustomerFilter({
        customer: "ESMALTEC",
      }),
      dateRange,
      rules: [esmaltecRule],
      records: [baseRecord(), baseRecord({ recordId: "rec-2", orderCode: "PV-101" })],
      paidBlockAutoChange: true,
    });
    assert.equal(preview.lines.length, 2);
    assert.equal(preview.ordersAffected, 2);
    assert.equal(preview.totals.currentCommission, 40);
    assert.equal(preview.totals.afterCommission, 0);
    assert.equal(preview.bySeller.length, 1);
    assert.ok(preview.byReferenceMonth.length > 0);
    assert.ok(preview.warnings.some((w) => w.includes("Não existe fechamento mensal persistido")));
  });

  it("evaluateExclusionReprocessSafety bloqueia registro pago", () => {
    const preview = buildExclusionImpactPreview({
      customerFilter: { customerName: "ESMALTEC" },
      dateRange,
      rules: [esmaltecRule],
      records: [
        baseRecord({
          status: "PAID_TOTAL",
          paidAmount: 20,
          releasedAmount: 20,
        }),
      ],
      paidBlockAutoChange: true,
    });
    const safety = evaluateExclusionReprocessSafety({
      preview,
      mode: "apply",
      skipClosedMonths: false,
      closedMonths: [],
      ruleId: esmaltecRule.id,
    });
    assert.equal(safety.safe, false);
    assert.ok(safety.blockers.some((b) => b.includes("pagos bloqueados")));
  });

  it("skip-closed-months bloqueia apply em mês com lote aprovado", () => {
    const preview = buildExclusionImpactPreview({
      customerFilter: { customerName: "ESMALTEC" },
      dateRange,
      rules: [esmaltecRule],
      records: [baseRecord()],
      paidBlockAutoChange: false,
      closedMonths: [
        {
          monthKey: "2026-04",
          sellerId: "seller-1",
          batchId: "batch-1",
          batchStatus: "APPROVED",
        },
      ],
    });
    const safety = evaluateExclusionReprocessSafety({
      preview,
      mode: "apply",
      skipClosedMonths: true,
      closedMonths: preview.closedMonths.map((monthKey) => ({
        monthKey,
        sellerId: "seller-1",
        batchId: "batch-1",
        batchStatus: "APPROVED" as const,
      })),
      ruleId: esmaltecRule.id,
    });
    assert.equal(safety.safe, false);
    assert.ok(safety.blockers.some((b) => b.includes("APPROVED/PAID")));
  });

  it("recordMatchesCustomerFilter usa externalId e nome normalizado", () => {
    assert.equal(
      recordMatchesCustomerFilter(baseRecord(), { customerExternalId: 9001 }),
      true
    );
    assert.equal(
      recordMatchesCustomerFilter(baseRecord(), { customerName: "ESMALTEC" }),
      true
    );
    assert.equal(
      recordMatchesCustomerFilter(baseRecord(), { customerName: "Cliente X" }),
      false
    );
  });

  it("não considera regra de outro cliente no safety com rule-id", () => {
    const preview = buildExclusionImpactPreview({
      customerFilter: { customerName: "ESMALTEC" },
      dateRange,
      rules: [esmaltecRule, otherCustomerRule],
      records: [baseRecord()],
      paidBlockAutoChange: false,
    });
    const safety = evaluateExclusionReprocessSafety({
      preview,
      mode: "apply",
      skipClosedMonths: false,
      closedMonths: [],
      ruleId: esmaltecRule.id,
    });
    assert.equal(safety.safe, true);
  });
});
