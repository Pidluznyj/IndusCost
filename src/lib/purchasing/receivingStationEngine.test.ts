import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateReceivingLineTotals } from "./receivingStationService.server.js";

describe("receivingStation aggregates (OP-23)", () => {
  it("calcula pedida/recebida/aceita/rejeitada/cancelada/pendente sem misturar conceitos", () => {
    const totals = aggregateReceivingLineTotals({
      quantityOrdered: 100,
      negotiatedUnitCost: 10,
      receipts: [
        {
          status: "APROVADO",
          quantityReceived: 40,
          quantityAccepted: 35,
          quantityRejected: 5,
          effectiveUnitCost: 9,
          unitCostSnapshot: 10,
        },
        {
          status: "RASCUNHO",
          quantityReceived: 10,
          quantityAccepted: 10,
          quantityRejected: 0,
          effectiveUnitCost: 9,
          unitCostSnapshot: 10,
        },
        {
          status: "ESTORNADO",
          quantityReceived: 20,
          quantityAccepted: 20,
          quantityRejected: 0,
          effectiveUnitCost: 8,
          unitCostSnapshot: 10,
        },
        {
          status: "CANCELADO",
          quantityReceived: 5,
          quantityAccepted: 0,
          quantityRejected: 0,
          effectiveUnitCost: null,
          unitCostSnapshot: null,
        },
      ],
    });
    assert.equal(totals.quantityOrdered, 100);
    assert.equal(totals.quantityAcceptedConfirmed, 35);
    assert.equal(totals.quantityPending, 65);
    assert.equal(totals.quantityRejected, 5);
    assert.equal(totals.quantityCancelled, 25); // 20 estornado + 5 cancelado
    assert.equal(totals.quantityReceived, 70); // 40 + 10 + 20 (cancelado não soma como recebida operacional)
    assert.equal(totals.negotiatedUnitCost, 10);
    assert.equal(totals.receivedUnitCost, 9);
  });
});
