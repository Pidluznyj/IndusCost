import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TREASURY_REPORT_KEYS } from "../contracts/treasuryEnums.js";
import {
  assertPlannedVsActualInternalConsistency,
  assertTreasuryReportTotalsConsistent,
  buildTreasuryReportDto,
  cashBridgeBuckets,
  computeTreasuryReportSharePercent,
  dailyPositionBuckets,
  plannedVsActualBuckets,
  sumTreasuryReportBucketAmounts,
  sumTreasuryReportBucketCounts,
} from "./treasuryReportRules.js";

describe("treasuryReportRules — consistência de totais", () => {
  it("soma de buckets bate com composição para relatório particionado", () => {
    const dto = buildTreasuryReportDto({
      reportKey: "delinquency",
      from: "2026-07-01",
      to: "2026-07-27",
      accountIds: null,
      authorizedAccountIds: ["a1"],
      scenario: "PROBABLE",
      filters: {},
      buckets: [
        { key: "1-30", label: "1–30", amount: "100.00", count: 2 },
        { key: "31-60", label: "31–60", amount: "50.50", count: 1 },
        { key: "61-90", label: "61–90", amount: "0.00", count: 0 },
        { key: "90+", label: "90+", amount: "49.50", count: 1 },
      ],
      rows: [],
      totalRows: 0,
      page: 1,
      pageSize: 50,
      paginate: false,
    });
    assert.equal(dto.totals.amount, "200.00");
    assert.equal(dto.totals.count, 4);
    assertTreasuryReportTotalsConsistent(dto);
  });

  it("camadas (posição diária) usam override e ainda validam composição", () => {
    const buckets = dailyPositionBuckets({
      observed: "1000.00",
      calculated: "990.00",
      reconciled: "1000.00",
      divergence: "10.00",
      blocked: "50.00",
      investments: "200.00",
    });
    const dto = buildTreasuryReportDto({
      reportKey: "daily-position",
      from: "2026-07-27",
      to: "2026-07-27",
      accountIds: ["a1"],
      authorizedAccountIds: ["a1"],
      scenario: null,
      filters: {},
      buckets,
      rows: [
        {
          id: "a1",
          label: "Conta 1",
          amount: "1000.00",
          accountId: "a1",
        },
      ],
      totalRows: 1,
      page: 1,
      pageSize: 50,
      totalsAmountOverride: "1000.00",
      totalsCountOverride: 1,
    });
    assert.equal(dto.totals.amount, "1000.00");
    assert.equal(dto.totals.extras.totalsAmountOverridden, true);
    assertTreasuryReportTotalsConsistent(dto);
  });

  it("ponte de caixa: composição soma buckets; total override = closing", () => {
    const buckets = cashBridgeBuckets({
      opening: "100.00",
      inflows: "40.00",
      outflows: "25.00",
      transfers: "0.00",
      closing: "115.00",
    });
    const dto = buildTreasuryReportDto({
      reportKey: "cash-bridge",
      from: "2026-07-01",
      to: "2026-07-27",
      accountIds: null,
      authorizedAccountIds: [],
      scenario: null,
      filters: {},
      buckets,
      rows: [],
      totalRows: 0,
      page: 1,
      pageSize: 50,
      paginate: false,
      totalsAmountOverride: "115.00",
    });
    assert.equal(dto.totals.amount, "115.00");
    assert.equal(
      sumTreasuryReportBucketAmounts(buckets),
      String(dto.totals.extras.bucketAmountSum)
    );
    assertTreasuryReportTotalsConsistent(dto);
  });

  it("previsto×realizado: buckets consistentes e share calculável", () => {
    const buckets = plannedVsActualBuckets({
      plannedReceipts: "100.00",
      realizedReceipts: "60.00",
      pendingReceipts: "40.00",
      plannedPayments: "50.00",
      realizedPayments: "20.00",
      pendingPayments: "30.00",
      plannedReceiptsCount: 2,
      realizedReceiptsCount: 1,
      pendingReceiptsCount: 1,
      plannedPaymentsCount: 2,
      realizedPaymentsCount: 1,
      pendingPaymentsCount: 1,
    });
    assertPlannedVsActualInternalConsistency(buckets);
    const dto = buildTreasuryReportDto({
      reportKey: "planned-vs-actual",
      from: "2026-07-01",
      to: "2026-07-27",
      accountIds: null,
      authorizedAccountIds: ["a1"],
      scenario: "PROBABLE",
      filters: { scenario: "PROBABLE" },
      buckets,
      rows: [],
      totalRows: 0,
      page: 1,
      pageSize: 50,
      paginate: false,
      totalsAmountOverride: "40.00",
      totalsCountOverride: 4,
    });
    assert.equal(computeTreasuryReportSharePercent("60.00", "100.00"), "60.00");
    assertTreasuryReportTotalsConsistent(dto);
  });

  it("detecta inconsistência se composição for adulterada", () => {
    const dto = buildTreasuryReportDto({
      reportKey: "promises",
      from: "2026-07-01",
      to: "2026-07-27",
      accountIds: null,
      authorizedAccountIds: [],
      scenario: null,
      filters: {},
      buckets: [
        { key: "ACTIVE", label: "ACTIVE", amount: "10.00", count: 1 },
        { key: "FULFILLED", label: "FULFILLED", amount: "5.00", count: 1 },
      ],
      rows: [],
      totalRows: 0,
      page: 1,
      pageSize: 50,
      paginate: false,
    });
    dto.composition[0]!.amount = "99.00";
    assert.throws(() => assertTreasuryReportTotalsConsistent(dto), /Inconsistência amount/);
  });

  it("cobre as 10 chaves canônicas no catálogo", () => {
    assert.equal(TREASURY_REPORT_KEYS.length, 10);
    assert.equal(sumTreasuryReportBucketCounts([{ key: "a", label: "a", amount: "1.00", count: 3 }]), 3);
  });
});
