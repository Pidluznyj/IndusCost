import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSalesOrderFlowDetailId,
  buildColumnExplanation,
  buildSalesOrderFlowOfficialLinks,
  mapItemSnapshotForDetail,
  mapNfeForDetail,
  mapOrderSnapshotForDetail,
  parseSalesOrderFlowEventsQuery,
  SalesOrderFlowDetailQueryError,
} from "./salesOrderFlowDetail.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

describe("salesOrderFlowDetail (OP-61)", () => {
  it("valida salesOrderId UUID", () => {
    assert.equal(assertSalesOrderFlowDetailId(ORDER_ID), ORDER_ID);
    assert.throws(
      () => assertSalesOrderFlowDetailId("not-a-uuid"),
      SalesOrderFlowDetailQueryError
    );
  });

  it("explica coluna pronta e estado recomputável sem snapshot", () => {
    const ready = buildColumnExplanation({
      currentStage: "IN_PRODUCTION",
      bottleneckReason: "Item A sem OP suficiente",
      recomputable: false,
    });
    assert.equal(ready.stage, "IN_PRODUCTION");
    assert.match(ready.reason, /Item A/);
    assert.ok(ready.nextAction);

    const missing = buildColumnExplanation({
      currentStage: null,
      recomputable: true,
    });
    assert.equal(missing.stage, null);
    assert.match(missing.reason, /não materializado/i);
  });

  it("mascara valores e chave fiscal conforme permissão", () => {
    const order = mapOrderSnapshotForDetail(
      {
        currentStage: "WAITING_NFE",
        orderValue: 100,
        fulfilledValue: 40,
        activeResidualValue: 60,
        cutValue: 0,
        canceledValue: 0,
        progressProductionOrder: 1,
        progressProduced: null,
        progressDocumented: 1,
        progressInvoiced: 0,
        progressShipped: 0,
        inconsistenciesJson: [],
        badgesJson: ["PARTIAL"],
        computedAt: new Date("2026-07-17T00:00:00Z"),
      },
      { canViewValues: false }
    );
    assert.equal(order!.orderValue, null);
    assert.deepEqual(order!.badges, ["PARTIAL"]);

    const nfeHidden = mapNfeForDetail(
      {
        externalId: 1,
        nomusNfeId: null,
        numero: "123",
        chave: "SECRET",
        statusRaw: 1,
        statusNormalized: {
          statusNormalized: "AUTHORIZED",
          label: "Autorizada",
        },
        isCanceled: false,
        isValidForBilling: true,
        sources: ["SALES_ORDER_NFE_LINK"],
      },
      false
    );
    assert.equal(nfeHidden.chave, null);

    const item = mapItemSnapshotForDetail(
      {
        salesOrderItemId: ITEM_ID,
        currentStage: "IN_PRODUCTION",
        orderedQuantity: 10,
        stageEnteredAt: new Date("2026-07-10T00:00:00Z"),
        inconsistenciesJson: [],
      },
      { canViewValues: true, now: new Date("2026-07-17T00:00:00Z") }
    );
    assert.equal(item.daysInStage, 7);
  });

  it("parseia paginação/filtros de eventos e rejeita tipo inválido", () => {
    const parsed = parseSalesOrderFlowEventsQuery({
      page: "1",
      pageSize: "20",
      eventType: "STAGE_CHANGED",
      salesOrderItemId: ITEM_ID,
    });
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 20);
    assert.equal(parsed.eventType, "STAGE_CHANGED");
    assert.throws(
      () => parseSalesOrderFlowEventsQuery({ eventType: "NOPE" }),
      SalesOrderFlowDetailQueryError
    );
  });

  it("monta links oficiais sem raw", () => {
    const links = buildSalesOrderFlowOfficialLinks(ORDER_ID);
    assert.equal(links.salesOrder, `/sales-orders/${ORDER_ID}`);
    assert.equal(links.salesOrderPrint, `/sales-orders/${ORDER_ID}/print`);
    assert.doesNotMatch(JSON.stringify(links), /rawJson|nomusRaw/);
  });
});
