import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInactiveSalesOrderItemNomusFlags,
  normalizeNomusSalesOrderItemStatus,
  parseNomusSalesOrderItemStatus,
  toOrderItemFulfillmentStorageStatus,
} from "./nomusSalesOrderItemStatus.js";

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
});
