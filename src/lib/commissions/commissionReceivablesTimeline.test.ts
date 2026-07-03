import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionReceivablesTimeline,
  enumerateMonthKeys,
  findTimelineMonth,
  parseMonthRangeArg,
} from "./commissionReceivablesTimeline.js";
import { aggregateMonthlyPayableFromRows } from "./commissionMonthlyPayable.js";
import { buildVisualAuditRow, filterRowsByAppraisalMode } from "./commissionVisualAudit.js";

describe("commissionReceivablesTimeline", () => {
  it("parseMonthRangeArg aceita YYYY-MM", () => {
    assert.deepEqual(parseMonthRangeArg("2026-06"), { year: 2026, month: 6 });
  });

  it("enumerateMonthKeys gera intervalo inclusivo", () => {
    const keys = enumerateMonthKeys("2026-01", "2026-03");
    assert.equal(keys.length, 3);
    assert.deepEqual(keys[2], { year: 2026, month: 3 });
  });

  it("findTimelineMonth localiza junho", () => {
    const row = buildVisualAuditRow({
      lineId: "r:s",
      recordId: "r",
      scheduleId: "s",
      commissionPersonId: "p1",
      commissionPersonName: "V",
      customerName: "C",
      orderCode: "P",
      nfeNumber: "1",
      nomusNfeId: 1,
      confirmedAt: "2026-04-01T00:00:00.000Z",
      documentKey: "p:1",
      documentBaseAmount: 100,
      documentCommissionTotal: 2,
      itemBaseAmount: 100,
      itemCommissionAmount: 2,
      itemRatePercent: 2,
      nomusReceivableId: 1,
      settlementDate: "2026-06-10T00:00:00.000Z",
      receivableAmount: 100,
      receivedAmount: 100,
      openBalance: 0,
      commissionExpected: 2,
      commissionReleased: 2,
      hasArLink: true,
      hasSchedule: true,
      customerNoCommission: false,
    });
    const period = {
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-30T23:59:59.999Z"),
    };
    const summary = aggregateMonthlyPayableFromRows(
      filterRowsByAppraisalMode([row], "PAYABLE", period),
      { year: 2026, month: 6 }
    );
    const timeline = buildCommissionReceivablesTimeline({
      fromMonthKey: "2026-01",
      toMonthKey: "2026-12",
      payableSummaries: [summary],
      forecast: null,
    });
    assert.equal(findTimelineMonth(timeline, 2026, 6)?.payableCommissionTotal, 2);
  });
});
