import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInactiveSalesOrderItemNomusFlags,
  isNomusSalesOrderItemCanceled,
  isFulfilledWithCutSalesOrderItem,
  isSalesOrderItemActiveForCommercialValue,
  isSalesOrderItemActiveForCommission,
  isSalesOrderItemActiveForMargin,
  isSalesOrderItemActiveForReceivableForecast,
  normalizeNomusSalesOrderItemStatus,
  parseNomusSalesOrderItemStatus,
  resolveCommissionIgnoreReasonForSalesOrderItem,
  resolveNomusRawItemMatchesForOrder,
  toOrderItemFulfillmentStorageStatus,
} from "./nomusSalesOrderItemStatus.js";
import type { NomusRawItem } from "../salesOrderNomusRaw.js";

describe("nomusSalesOrderItemStatus", () => {
  it("mapeia status 4 → FULFILLED e 6 → CANCELED", () => {
    assert.equal(normalizeNomusSalesOrderItemStatus(4), "FULFILLED");
    assert.equal(normalizeNomusSalesOrderItemStatus("4"), "FULFILLED");
    assert.equal(normalizeNomusSalesOrderItemStatus(6), "CANCELED");
    assert.equal(normalizeNomusSalesOrderItemStatus("6"), "CANCELED");
  });

  it("preserva UNKNOWN para código não mapeado", () => {
    assert.equal(normalizeNomusSalesOrderItemStatus(99), "UNKNOWN");
  });

  it("parseNomusSalesOrderItemStatus marca cancelado e pendência zero", () => {
    const canceled = parseNomusSalesOrderItemStatus({
      idProduto: 537,
      quantidade: 16.5,
      valorUnitario: 4.93,
      status: 6,
    });
    assert.equal(canceled.statusNormalized, "CANCELED");
    assert.equal(canceled.isCanceled, true);
    assert.equal(canceled.statusRaw, "6");
    assert.equal(canceled.quantityPending, 0);

    const fulfilled = parseNomusSalesOrderItemStatus({
      idProduto: 538,
      quantidade: 8,
      valorUnitario: 4.92,
      status: 4,
      quantidadeAtendida: 8,
    });
    assert.equal(fulfilled.statusNormalized, "FULFILLED");
    assert.equal(fulfilled.isCanceled, false);
    assert.equal(fulfilled.quantityPending, 0);
  });

  it("FULFILLED com quantidadeAtendida=0 usa faturada ou pedida (PD 02757)", () => {
    const viaFaturada = parseNomusSalesOrderItemStatus({
      quantidade: 114,
      status: 4,
      quantidadeAtendida: 0,
      quantidadeFaturada: 114,
    });
    assert.equal(viaFaturada.statusNormalized, "FULFILLED");
    assert.equal(viaFaturada.quantityFulfilled, 114);
    assert.equal(viaFaturada.quantityPending, 0);

    const viaOrdered = parseNomusSalesOrderItemStatus({
      quantidade: 360,
      status: 4,
      quantidadeAtendida: 0,
      quantidadeFaturada: 0,
    });
    assert.equal(viaOrdered.statusNormalized, "FULFILLED");
    assert.equal(viaOrdered.quantityFulfilled, 360);
    assert.equal(viaOrdered.quantityPending, 0);
  });

  it("parse pt-BR: '1.000' → 1000 (não 1) — regressão PD 02586", () => {
    const parsed = parseNomusSalesOrderItemStatus({
      quantidade: "1.000",
      status: 4,
      quantidadeAtendida: "1.000",
      valorUnitario: "2,85",
    });
    assert.equal(parsed.statusNormalized, "FULFILLED");
    assert.equal(parsed.quantityOrdered, 1000);
    assert.equal(parsed.quantityFulfilled, 1000);
    assert.equal(parsed.quantityPending, 0);
  });

  it("FULFILLED com atendida parcial inconsistente promove para pedida", () => {
    const parsed = parseNomusSalesOrderItemStatus({
      quantidade: 1000,
      status: 4,
      quantidadeAtendida: 1,
      quantidadeFaturada: 0,
    });
    assert.equal(parsed.statusNormalized, "FULFILLED");
    assert.equal(parsed.quantityFulfilled, 1000);
    assert.equal(parsed.quantityPending, 0);
  });

  it("toOrderItemFulfillmentStorageStatus e flags inativos", () => {
    assert.equal(toOrderItemFulfillmentStorageStatus("CANCELED"), "CANCELADO");
    assert.equal(toOrderItemFulfillmentStorageStatus("FULFILLED"), "ATENDIDO");
    assert.equal(
      isInactiveSalesOrderItemNomusFlags({ nomusIsCanceled: true }),
      true
    );
    assert.equal(
      isInactiveSalesOrderItemNomusFlags({ nomusIsStale: true }),
      true
    );
    assert.equal(
      isInactiveSalesOrderItemNomusFlags({
        nomusIsCanceled: false,
        nomusIsStale: false,
      }),
      false
    );
  });

  it("mapeia status 5 → FULFILLED_WITH_CUT e 2 → RELEASED (textos PT)", () => {
    assert.equal(normalizeNomusSalesOrderItemStatus(5), "FULFILLED_WITH_CUT");
    assert.equal(normalizeNomusSalesOrderItemStatus(2), "RELEASED");
    assert.equal(
      normalizeNomusSalesOrderItemStatus("Atendido com corte"),
      "FULFILLED_WITH_CUT"
    );
    assert.equal(normalizeNomusSalesOrderItemStatus("Liberado"), "RELEASED");
    assert.equal(
      normalizeNomusSalesOrderItemStatus("Atendido totalmente"),
      "FULFILLED"
    );
    assert.equal(normalizeNomusSalesOrderItemStatus("Cancelado"), "CANCELED");
    assert.equal(normalizeNomusSalesOrderItemStatus(97), "UNKNOWN");
  });

  it("parse expõe isCut + quantityCut e não deixa pending", () => {
    const cut = parseNomusSalesOrderItemStatus({
      idProduto: 309,
      quantidade: 100,
      quantidadeAtendida: 60,
      valorUnitario: 1,
      status: 5,
    });
    assert.equal(cut.statusNormalized, "FULFILLED_WITH_CUT");
    assert.equal(cut.isCut, true);
    assert.equal(cut.isCanceled, false);
    assert.equal(cut.quantityPending, 0);
    assert.equal(cut.quantityCut, 40);
  });

  it("PD 02534 — 5 linhas do MESMO SKU só cancela a linha realmente cancelada", () => {
    const rawItems: NomusRawItem[] = [
      { item: 80, idProduto: 309, status: "6", quantidade: 2000, raw: { id: 1080, item: 80, idProduto: 309, quantidade: 2000, valorUnitario: 1.59, status: 6 } },
      { item: 90, idProduto: 309, status: "2", quantidade: 4000, raw: { id: 1090, item: 90, idProduto: 309, quantidade: 4000, valorUnitario: 1.59, status: 2 } },
      { item: 100, idProduto: 309, status: "2", quantidade: 8000, raw: { id: 1100, item: 100, idProduto: 309, quantidade: 8000, valorUnitario: 1.59, status: 2 } },
      { item: 110, idProduto: 309, status: "2", quantidade: 4000, raw: { id: 1110, item: 110, idProduto: 309, quantidade: 4000, valorUnitario: 1.59, status: 2 } },
      { item: 120, idProduto: 309, status: "2", quantidade: 8000, raw: { id: 1120, item: 120, idProduto: 309, quantidade: 8000, valorUnitario: 1.59, status: 2 } },
    ];
    const locals = [
      { id: "L80", externalProductId: 309, skuSnapshot: "309.86AA", quantity: 2000, negotiatedPrice: 1.59, notes: null, nomusItemExternalId: 1080 },
      { id: "L90", externalProductId: 309, skuSnapshot: "309.86AA", quantity: 4000, negotiatedPrice: 1.59, notes: null, nomusItemExternalId: 1090 },
      { id: "L100", externalProductId: 309, skuSnapshot: "309.86AA", quantity: 8000, negotiatedPrice: 1.59, notes: null, nomusItemExternalId: 1100 },
      { id: "L110", externalProductId: 309, skuSnapshot: "309.86AA", quantity: 4000, negotiatedPrice: 1.59, notes: null, nomusItemExternalId: 1110 },
      { id: "L120", externalProductId: 309, skuSnapshot: "309.86AA", quantity: 8000, negotiatedPrice: 1.59, notes: null, nomusItemExternalId: 1120 },
    ];
    const map = resolveNomusRawItemMatchesForOrder(locals, rawItems);
    assert.equal(map.get("L80")!.matchConfidence, "HIGH");
    assert.equal(
      parseNomusSalesOrderItemStatus(map.get("L80")!.rawItem!.raw).isCanceled,
      true
    );
    for (const id of ["L90", "L100", "L110", "L120"]) {
      const m = map.get(id)!;
      assert.equal(m.matchConfidence, "HIGH");
      assert.equal(
        parseNomusSalesOrderItemStatus(m.rawItem!.raw).isCanceled,
        false,
        `${id} não pode ser cancelado por SKU`
      );
    }
  });

  it("SKU repetido sem id/sequência e sem qty+preço únicos → AMBIGUOUS", () => {
    const rawItems: NomusRawItem[] = [
      { item: 10, idProduto: 42, status: "6", quantidade: 100, raw: { idProduto: 42, quantidade: 100, valorUnitario: 5, status: 6 } },
      { item: 20, idProduto: 42, status: "2", quantidade: 100, raw: { idProduto: 42, quantidade: 100, valorUnitario: 5, status: 2 } },
    ];
    const locals = [
      { id: "A", externalProductId: 42, skuSnapshot: "42", quantity: 100, negotiatedPrice: 5, notes: null },
      { id: "B", externalProductId: 42, skuSnapshot: "42", quantity: 100, negotiatedPrice: 5, notes: null },
    ];
    const map = resolveNomusRawItemMatchesForOrder(locals, rawItems);
    // sem evidência de linha e qty+preço iguais → não deve marcar CANCELED aleatoriamente.
    // Confidence LOW (posicional) ou AMBIGUOUS — mas nunca aplicar cancel a AMBOS.
    const cancelHits = ["A", "B"].filter(
      (id) =>
        map.get(id)!.rawItem &&
        parseNomusSalesOrderItemStatus(map.get(id)!.rawItem!.raw).isCanceled
    );
    assert.ok(cancelHits.length <= 1, "não pode cancelar ambos");
  });

  it("isFulfilledWithCutSalesOrderItem detecta corte por flag e por status", () => {
    assert.equal(isFulfilledWithCutSalesOrderItem({ nomusIsCut: true }), true);
    assert.equal(
      isFulfilledWithCutSalesOrderItem({ nomusItemStatusNormalized: "FULFILLED_WITH_CUT" }),
      true
    );
    assert.equal(isFulfilledWithCutSalesOrderItem({}), false);
  });

  it("gates de ativo comercial / forecast / comissão / margem", () => {
    assert.equal(
      isSalesOrderItemActiveForCommercialValue({ nomusIsCanceled: true }),
      false
    );
    assert.equal(
      isSalesOrderItemActiveForReceivableForecast({ nomusIsStale: true }),
      false
    );
    assert.equal(
      isSalesOrderItemActiveForCommission({
        nomusItemStatusNormalized: "CANCELED",
      }),
      false
    );
    assert.equal(
      isSalesOrderItemActiveForMargin({ quantity: 0, totalNetValue: 100 }),
      false
    );
    assert.equal(
      isSalesOrderItemActiveForCommercialValue({
        nomusIsCanceled: false,
        nomusIsStale: false,
        quantity: 8,
        totalNetValue: 100,
      }),
      true
    );
    assert.equal(
      resolveCommissionIgnoreReasonForSalesOrderItem({ nomusIsStale: true }),
      "IGNORED_STALE_ITEM"
    );
    assert.equal(
      resolveCommissionIgnoreReasonForSalesOrderItem({ nomusIsCanceled: true }),
      "IGNORED_CANCELED_ITEM"
    );
    assert.equal(
      resolveCommissionIgnoreReasonForSalesOrderItem({ nomusIsCut: true }),
      "IGNORED_CUT_ITEM"
    );
    assert.equal(isNomusSalesOrderItemCanceled(6), true);
    assert.equal(isNomusSalesOrderItemCanceled(4), false);
    assert.equal(
      isSalesOrderItemActiveForCommercialValue({
        nomusIsCut: true,
        quantity: 100,
        totalNetValue: 500,
      }),
      false
    );
  });
});
