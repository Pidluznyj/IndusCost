import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionsDashboardQueryString,
  resolveCommissionsRecalculatePeriod,
} from "../components/commissions/dashboard/commissionsDashboardFilters.js";
import {
  buildPendingByDueDateBuckets,
  filterUpcomingReleases,
} from "../components/commissions/dashboard/commissionsDashboardLabels.js";

describe("commissionsDashboardFilters", () => {
  it("serializa filtros para query string", () => {
    const qs = buildCommissionsDashboardQueryString({
      year: "2026",
      month: "6",
      from: "",
      to: "",
      commissionPersonId: "abc",
      personType: "SELLER",
      customer: "Cliente X",
      orderCode: "PV-1",
      nfeNumber: "123",
      status: "RELEASED",
      ruleId: "rule-1",
    });
    assert.match(qs, /year=2026/);
    assert.match(qs, /month=6/);
    assert.match(qs, /personType=SELLER/);
    assert.match(qs, /orderCode=PV-1/);
  });

  it("resolve período de recálculo por ano/mês", () => {
    const period = resolveCommissionsRecalculatePeriod({
      year: "2026",
      month: "6",
      from: "",
      to: "",
      commissionPersonId: "",
      personType: "",
      customer: "",
      orderCode: "",
      nfeNumber: "",
      status: "",
      ruleId: "",
    });
    assert.equal(period.from, "2026-06-01");
    assert.equal(period.to, "2026-06-30");
  });
});

describe("commissionsDashboardLabels helpers", () => {
  it("agrupa pendente por vencimento", () => {
    const buckets = buildPendingByDueDateBuckets([
      { dueDate: null, balanceToRelease: 100 },
      { dueDate: new Date(Date.now() + 5 * 86400000).toISOString(), balanceToRelease: 50 },
    ]);
    assert.ok(buckets.length >= 1);
  });

  it("filtra próximas liberações", () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const rows = filterUpcomingReleases([
      { dueDate: future.toISOString(), balanceToRelease: 10 },
      { dueDate: future.toISOString(), balanceToRelease: 0 },
    ]);
    assert.equal(rows.length, 1);
  });
});
