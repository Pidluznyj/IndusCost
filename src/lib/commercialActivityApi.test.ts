import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  COMMERCIAL_ACTIVITY_SALES_ORDER_BACKFILL_SQL,
  mapCommercialActivityForApi,
  parseOptionalUuidField,
} from "./commercialActivityApi.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

describe("commercialActivityApi", () => {
  it("mapCommercialActivityForApi retorna salesOrder aninhado", () => {
    const mapped = mapCommercialActivityForApi({
      id: "act-1",
      activityType: "CONTACT",
      subject: "Ligação",
      description: null,
      scheduledAt: null,
      completedAt: null,
      status: "DONE",
      priority: null,
      assignedTo: null,
      closeReason: null,
      contactDate: new Date("2026-06-01T10:00:00.000Z"),
      channel: "PHONE",
      reason: null,
      outcome: null,
      nextActionAt: null,
      nextActionDescription: null,
      createdByName: "Ana",
      createdByPhone: null,
      createdByEmail: null,
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      salesOrderId: ORDER_ID,
      proposalId: null,
      Proposal: null,
      SalesOrder: {
        id: ORDER_ID,
        orderCode: "PV-9001",
        status: "READY_TO_SEND",
        issueDate: new Date("2026-05-15T00:00:00.000Z"),
        totalNetValue: 42000,
      },
    });
    assert.equal(mapped.salesOrderId, ORDER_ID);
    assert.equal(mapped.salesOrder?.orderCode, "PV-9001");
    assert.equal(mapped.salesOrder?.totalNetValue, 42000);
    assert.ok(Number.isFinite(mapped.salesOrder?.totalNetValue ?? NaN));
    assert.equal(mapped.proposal, null);
  });

  it("aceita salesOrderId opcional (null)", () => {
    const mapped = mapCommercialActivityForApi({
      id: "act-2",
      activityType: "CONTACT",
      subject: null,
      description: "Nota",
      scheduledAt: null,
      completedAt: null,
      status: "OPEN",
      priority: null,
      assignedTo: null,
      closeReason: null,
      contactDate: null,
      channel: null,
      reason: null,
      outcome: null,
      nextActionAt: null,
      nextActionDescription: null,
      createdByName: null,
      createdByPhone: null,
      createdByEmail: null,
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      salesOrderId: null,
      proposalId: null,
      Proposal: null,
      SalesOrder: null,
    });
    assert.equal(mapped.salesOrderId, null);
    assert.equal(mapped.salesOrder, null);
  });

  it("parseOptionalUuidField valida UUID", () => {
    assert.equal(parseOptionalUuidField(undefined), undefined);
    assert.equal(parseOptionalUuidField(null), null);
    assert.equal(parseOptionalUuidField(ORDER_ID), ORDER_ID);
    assert.equal(parseOptionalUuidField("bad"), "INVALID");
  });

  it("backfill SQL usa proposalId único em SalesOrder", () => {
    assert.match(COMMERCIAL_ACTIVITY_SALES_ORDER_BACKFILL_SQL, /CommercialActivity/);
    assert.match(COMMERCIAL_ACTIVITY_SALES_ORDER_BACKFILL_SQL, /SalesOrder/);
    assert.match(COMMERCIAL_ACTIVITY_SALES_ORDER_BACKFILL_SQL, /proposalId/);
    const migration = readFileSync(
      join(process.cwd(), "prisma/migrations/20260612120000_commercial_activity_sales_order_id/migration.sql"),
      "utf8"
    );
    assert.match(migration, /salesOrderId/);
    assert.match(migration, /proposalId/);
  });

  it("proposal legado continua no payload", () => {
    const mapped = mapCommercialActivityForApi({
      id: "act-3",
      activityType: "CONTACT",
      subject: null,
      description: null,
      scheduledAt: null,
      completedAt: null,
      status: "DONE",
      priority: null,
      assignedTo: null,
      closeReason: null,
      contactDate: null,
      channel: null,
      reason: null,
      outcome: null,
      nextActionAt: null,
      nextActionDescription: null,
      createdByName: null,
      createdByPhone: null,
      createdByEmail: null,
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      salesOrderId: null,
      proposalId: "prop-1",
      Proposal: { number: 42, title: "Orçamento", status: "SENT" },
      SalesOrder: null,
    });
    assert.equal(mapped.proposal?.number, 42);
    assert.equal(mapped.proposalId, "prop-1");
  });
});
