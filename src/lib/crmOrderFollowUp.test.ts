import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  orderHasFollowUpAfterCutoff,
  orderFollowUpCutoffMs,
} from "./crmOrderFollowUp.js";

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUTOFF = new Date("2026-05-02T00:00:00.000Z");

describe("crmOrderFollowUp", () => {
  it("atividade vinculada ao pedido após cutoff conta como follow-up", () => {
    const has = orderHasFollowUpAfterCutoff(ORDER_ID, CUTOFF, [
      {
        contactDate: new Date("2026-05-03T00:00:00.000Z"),
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
        salesOrderId: ORDER_ID,
      },
    ]);
    assert.equal(has, true);
  });

  it("pedido sem atividade vinculada entra como sem follow-up", () => {
    const has = orderHasFollowUpAfterCutoff(ORDER_ID, CUTOFF, []);
    assert.equal(has, false);
  });

  it("atividade geral do cliente é fallback quando sem salesOrderId", () => {
    const has = orderHasFollowUpAfterCutoff(ORDER_ID, CUTOFF, [
      {
        contactDate: new Date("2026-05-03T00:00:00.000Z"),
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
        salesOrderId: null,
      },
    ]);
    assert.equal(has, true);
  });

  it("vínculo direto tem prioridade — atividade de outro pedido não conta", () => {
    const otherOrder = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const has = orderHasFollowUpAfterCutoff(ORDER_ID, CUTOFF, [
      {
        contactDate: new Date("2026-05-10T00:00:00.000Z"),
        createdAt: new Date("2026-05-10T00:00:00.000Z"),
        salesOrderId: otherOrder,
      },
    ]);
    assert.equal(has, false);
  });

  it("atividade antes do cutoff não conta", () => {
    const has = orderHasFollowUpAfterCutoff(ORDER_ID, CUTOFF, [
      {
        contactDate: new Date("2026-05-01T00:00:00.000Z"),
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        salesOrderId: ORDER_ID,
      },
    ]);
    assert.equal(has, false);
  });

  it("orderFollowUpCutoffMs não retorna NaN", () => {
    const ms = orderFollowUpCutoffMs(new Date("2026-05-02T00:00:00.000Z"), new Date("2026-05-01T00:00:00.000Z"));
    assert.ok(Number.isFinite(ms));
  });
});
