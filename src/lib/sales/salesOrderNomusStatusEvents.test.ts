import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNomusSyncItemWritePlan,
  type NomusSyncExistingItem,
  type NomusSyncPlannedLine,
} from "../salesOrderNomusSync.server.ts";
import { buildSalesOrderNomusStatusEvents } from "./salesOrderNomusStatusEvents.ts";

function existing(id: string, lineId: number, flags: Partial<NomusSyncExistingItem> = {}): NomusSyncExistingItem {
  return {
    id,
    productId: `p${lineId}`,
    externalProductId: lineId,
    proposalItemId: null,
    skuSnapshot: "SKU",
    productNameSnapshot: "Produto",
    unit: "UN",
    unitCost: "10",
    totalCost: "0",
    marginValue: "0",
    marginPerc: "0",
    quantity: "10",
    negotiatedPrice: "10",
    totalNetValue: "100",
    notes: null,
    nomusItemExternalId: lineId,
    nomusItemStatusRaw: "2",
    nomusItemStatusNormalized: "RELEASED",
    nomusIsCanceled: false,
    nomusIsStale: false,
    nomusIsCut: false,
    ...flags,
  };
}

function line(lineId: number, flags: Partial<NomusSyncPlannedLine> = {}): NomusSyncPlannedLine {
  return {
    externalLineId: lineId,
    productId: `p${lineId}`,
    externalProductId: lineId,
    proposalItemId: null,
    skuSnapshot: "SKU",
    productNameSnapshot: "Produto",
    unit: "UN",
    quantity: 10,
    negotiatedPrice: 10,
    totalNetValue: 100,
    notes: null,
    nomusItemStatusRaw: "2",
    nomusItemStatusNormalized: "RELEASED",
    nomusIsCanceled: false,
    nomusIsCut: false,
    ...flags,
  };
}

function sync(existingItems: NomusSyncExistingItem[], plannedLines: NomusSyncPlannedLine[]) {
  const plan = buildNomusSyncItemWritePlan({ salesOrderId: "so-1", plannedLines, existingItems });
  return { plan, events: buildSalesOrderNomusStatusEvents({ salesOrderId: "so-1", existingItems, plan }) };
}

const CANCELED = { nomusItemStatusRaw: "6", nomusItemStatusNormalized: "CANCELED", nomusIsCanceled: true };

describe("status Nomus entre sincronizações (itens e pedido)", () => {
  it("10. sincronização repetida sem mudanças → nenhum evento", () => {
    const { events } = sync([existing("i1", 1), existing("i2", 2)], [line(1), line(2)]);
    assert.deepEqual(events, []);
  });

  it("3/2. cancelamento posterior: item cancelado e, quando todos, o pedido inteiro", () => {
    const one = sync([existing("i1", 1), existing("i2", 2)], [line(1, CANCELED), line(2)]);
    assert.deepEqual(one.events.map((e) => e.kind), ["ITEM_CANCELED"]);
    assert.equal(one.plan.upserts.find((r) => r.id === "i1")?.nomusIsCanceled, true);

    const all = sync([existing("i1", 1), existing("i2", 2)], [line(1, CANCELED), line(2, CANCELED)]);
    assert.deepEqual(all.events.map((e) => e.kind), ["ITEM_CANCELED", "ITEM_CANCELED", "ORDER_FULLY_CANCELED"]);
    // nenhum item é apagado: os dois continuam no plano como atualização
    assert.equal(all.plan.upserts.length, 2);
    assert.equal(all.plan.staleUpdates.length, 0);
  });

  it("9. reativação: item volta ativo, pedido sai de 'cancelado' e o cancelamento anterior fica no histórico", () => {
    const before = [existing("i1", 1, CANCELED)];
    const { plan, events } = sync(before, [line(1, { nomusItemStatusRaw: "2", nomusItemStatusNormalized: "RELEASED" })]);
    assert.equal(plan.upserts[0]?.nomusIsCanceled, false);
    assert.deepEqual(events.map((e) => e.kind), ["ITEM_REACTIVATED", "ORDER_REACTIVATED"]);
    assert.equal(events[0]!.previousStatusNormalized, "CANCELED");
    assert.equal(plan.creates.length, 0, "reativação não duplica item");
  });

  it("5. item cortado e progressão normal de status", () => {
    const cut = sync(
      [existing("i1", 1, { nomusItemStatusRaw: "3", nomusItemStatusNormalized: "PARTIAL" })],
      [line(1, { nomusItemStatusRaw: "5", nomusItemStatusNormalized: "FULFILLED_WITH_CUT", nomusIsCut: true, nomusQuantityFulfilled: 6 })]
    );
    assert.deepEqual(cut.events.map((e) => e.kind), ["ITEM_CUT"]);
    const progress = sync([existing("i1", 1)], [line(1, { nomusItemStatusRaw: "3", nomusItemStatusNormalized: "PARTIAL" })]);
    assert.deepEqual(progress.events.map((e) => e.kind), ["ITEM_STATUS_CHANGED"]);
  });

  it("11. status ausente no payload → estado anterior preservado (não reativa item cancelado)", () => {
    const { plan, events } = sync(
      [existing("i1", 1, CANCELED)],
      [line(1, { nomusItemStatusRaw: null, nomusItemStatusNormalized: "UNKNOWN", nomusIsCanceled: false })]
    );
    const row = plan.upserts[0]!;
    assert.equal(row.nomusIsCanceled, true);
    assert.equal(row.nomusItemStatusNormalized, "CANCELED");
    assert.equal(row.nomusStatusPreservedFromPrevious, true);
    assert.deepEqual(events.map((e) => e.kind), ["ITEM_STATUS_UNKNOWN_PRESERVED"]);
  });

  it("12. código de status desconhecido → preserva o anterior e registra o código recebido uma vez", () => {
    const unknown = line(1, { nomusItemStatusRaw: "9", nomusItemStatusNormalized: "UNKNOWN" });
    const first = sync([existing("i1", 1, { nomusItemStatusRaw: "4", nomusItemStatusNormalized: "FULFILLED" })], [unknown]);
    assert.equal(first.plan.upserts[0]!.nomusItemStatusNormalized, "FULFILLED");
    assert.equal(first.plan.upserts[0]!.nomusItemStatusRaw, "9", "código bruto recebido fica gravado para auditoria");
    assert.deepEqual(first.events.map((e) => e.kind), ["ITEM_STATUS_UNKNOWN_PRESERVED"]);
    // próxima leitura com o mesmo código desconhecido: sem novo evento
    const again = sync(
      [existing("i1", 1, { nomusItemStatusRaw: "9", nomusItemStatusNormalized: "FULFILLED" })],
      [unknown]
    );
    assert.deepEqual(again.events, []);
    // item novo com status desconhecido: sem estado anterior, fica como veio (ativo)
    const fresh = sync([], [unknown]);
    assert.equal(fresh.plan.creates[0]!.nomusIsCanceled, false);
    assert.deepEqual(fresh.events, []);
  });

  it("linha que some do payload vira stale (sem exclusão) e volta como RETURNED", () => {
    const gone = sync([existing("i1", 1), existing("i2", 2)], [line(1)]);
    assert.deepEqual(gone.events.map((e) => e.kind), ["ITEM_STALE"]);
    assert.equal(gone.plan.staleUpdates[0]!.id, "i2");
    const back = sync([existing("i1", 1), existing("i2", 2, { nomusIsStale: true })], [line(1), line(2)]);
    assert.deepEqual(back.events.map((e) => e.kind), ["ITEM_RETURNED"]);
  });
});
