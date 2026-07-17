import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SALES_ORDER_RELEASE_CLASSIFICATIONS,
  mapSalesOrderItemReleaseBucket,
  mapSalesOrderReleaseStatus,
} from "./salesOrderReleaseStatusMapper.js";

describe("salesOrderReleaseStatusMapper", () => {
  it("expõe as 5 classificações oficiais", () => {
    assert.deepEqual([...SALES_ORDER_RELEASE_CLASSIFICATIONS], [
      "AWAITING_RELEASE",
      "RELEASED",
      "BLOCKED",
      "CANCELED",
      "UNKNOWN",
    ]);
  });

  it("status 1 (PENDING) → aguardando liberação", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 1 }],
    });
    assert.equal(r.classification, "AWAITING_RELEASE");
    assert.equal(r.isReleased, false);
    assert.equal(r.isBlocked, false);
    assert.equal(r.isCanceled, false);
    assert.equal(r.reasonCode, "ALL_ACTIVE_AWAITING_RELEASE");
    assert.ok(r.sourceFields.includes("status"));
  });

  it("status 2 (RELEASED) → liberado", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 2 }],
    });
    assert.equal(r.classification, "RELEASED");
    assert.equal(r.isReleased, true);
    assert.equal(r.reasonCode, "ALL_ACTIVE_PAST_RELEASE");
  });

  it("status 3/4/5 (parcial/atendido/corte) contam como já liberados no gate", () => {
    for (const status of [3, 4, 5] as const) {
      const r = mapSalesOrderReleaseStatus({ items: [{ status }] });
      assert.equal(r.classification, "RELEASED", `status ${status}`);
      assert.equal(r.isReleased, true, `status ${status}`);
    }
  });

  it("status 6 (CANCELED) → cancelado", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 6 }],
    });
    assert.equal(r.classification, "CANCELED");
    assert.equal(r.isCanceled, true);
    assert.equal(r.isReleased, false);
    assert.equal(r.reasonCode, "ALL_ITEMS_CANCELED");
  });

  it("textos Nomus comprovados (Aguardando / Liberado / Cancelado)", () => {
    assert.equal(
      mapSalesOrderReleaseStatus({
        items: [{ status: "Aguardando liberação" }],
      }).classification,
      "AWAITING_RELEASE"
    );
    assert.equal(
      mapSalesOrderReleaseStatus({
        items: [{ status: "Liberado" }],
      }).classification,
      "RELEASED"
    );
    assert.equal(
      mapSalesOrderReleaseStatus({
        items: [{ status: "Cancelado" }],
      }).classification,
      "CANCELED"
    );
  });

  it("ausência do campo status → UNKNOWN (não liberado)", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ statusNormalized: null, status: null }],
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.isReleased, false);
    assert.equal(r.reasonCode, "MISSING_STATUS_FIELD");
  });

  it("pedido sem itens → UNKNOWN", () => {
    const r = mapSalesOrderReleaseStatus({ items: [] });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.reasonCode, "NO_ITEMS");
    assert.equal(r.isReleased, false);
  });

  it("status desconhecido não é tratado como liberado", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 99 }],
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.isReleased, false);
    assert.equal(r.isBlocked, false);
    assert.equal(r.reasonCode, "UNKNOWN_ITEM_STATUS");
  });

  it("mistura liberado + desconhecido → UNKNOWN (não RELEASED)", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 2 }, { status: 99 }],
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.isReleased, false);
  });

  it("bloqueio explícito por texto Nomus no item", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: "Bloqueado" }],
    });
    assert.equal(r.classification, "BLOCKED");
    assert.equal(r.isBlocked, true);
    assert.equal(r.isReleased, false);
    assert.equal(r.reasonCode, "EXPLICIT_BLOCKED_STATUS");
  });

  it("bloqueio explícito por cabeçalho Nomus", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 2 }],
      headerStatusRaw: "Pedido bloqueado",
    });
    assert.equal(r.classification, "BLOCKED");
    assert.equal(r.isBlocked, true);
    assert.ok(r.sourceFields.includes("headerStatusRaw"));
  });

  it("SalesOrder.status ERROR → BLOCKED", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 2 }],
      orderStatus: "ERROR",
    });
    assert.equal(r.classification, "BLOCKED");
    assert.equal(r.reasonCode, "ORDER_STATUS_ERROR");
    assert.equal(r.isReleased, false);
  });

  it("SalesOrder.status CANCELLED → CANCELED", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 2 }],
      orderStatus: "CANCELLED",
    });
    assert.equal(r.classification, "CANCELED");
    assert.equal(r.reasonCode, "ORDER_STATUS_CANCELLED");
    assert.equal(r.isCanceled, true);
  });

  it("pedido misto: qualquer item aguardando vence → AWAITING_RELEASE", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 2 }, { status: 1 }, { status: 4 }],
    });
    assert.equal(r.classification, "AWAITING_RELEASE");
    assert.equal(r.reasonCode, "HAS_AWAITING_RELEASE_ITEMS");
    assert.equal(r.isReleased, false);
    assert.equal(r.evidence.awaitingReleaseCount, 1);
    assert.equal(r.evidence.pastReleaseCount, 2);
  });

  it("não inferir liberação por presença de OP/Documento/NF no input (só status)", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 1 }],
      // campos estranhos no objeto não existem no contrato — garantir PENDING
    });
    assert.equal(r.classification, "AWAITING_RELEASE");
    assert.equal(r.isReleased, false);
  });

  it("itens stale não votam; só ativos cancelados → CANCELED", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [
        { status: 6 },
        { status: 2, nomusIsStale: true },
      ],
    });
    assert.equal(r.classification, "CANCELED");
    assert.equal(r.evidence.staleCount, 1);
  });

  it("statusNormalized persistido tem precedência sobre raw", () => {
    const r = mapSalesOrderReleaseStatus({
      items: [{ status: 1, statusNormalized: "RELEASED" }],
    });
    assert.equal(r.classification, "RELEASED");
    assert.ok(r.sourceFields.includes("statusNormalized"));
  });

  it("mapSalesOrderItemReleaseBucket cobre buckets por status comprovado", () => {
    assert.equal(mapSalesOrderItemReleaseBucket({ status: 1 }).bucket, "AWAITING_RELEASE");
    assert.equal(mapSalesOrderItemReleaseBucket({ status: 2 }).bucket, "PAST_RELEASE");
    assert.equal(mapSalesOrderItemReleaseBucket({ status: 3 }).bucket, "PAST_RELEASE");
    assert.equal(mapSalesOrderItemReleaseBucket({ status: 4 }).bucket, "PAST_RELEASE");
    assert.equal(mapSalesOrderItemReleaseBucket({ status: 5 }).bucket, "PAST_RELEASE");
    assert.equal(mapSalesOrderItemReleaseBucket({ status: 6 }).bucket, "CANCELED");
    assert.equal(mapSalesOrderItemReleaseBucket({ status: 99 }).bucket, "UNKNOWN");
    assert.equal(mapSalesOrderItemReleaseBucket({}).bucket, "MISSING");
    assert.equal(mapSalesOrderItemReleaseBucket({ status: "Bloqueado" }).bucket, "BLOCKED");
  });

  it("SENT_TO_NOMUS / DRAFT não classificam liberação sozinhos", () => {
    const draft = mapSalesOrderReleaseStatus({
      items: [{ status: 1 }],
      orderStatus: "DRAFT",
    });
    assert.equal(draft.classification, "AWAITING_RELEASE");

    const sent = mapSalesOrderReleaseStatus({
      items: [{ status: 2 }],
      orderStatus: "SENT_TO_NOMUS",
    });
    assert.equal(sent.classification, "RELEASED");
  });
});
