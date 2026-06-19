import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderLogisticStatus,
  compareLogisticToExecutiveStatus,
  NOMUS_CANCELLED_ITEM_STATUS_CODES,
  NOMUS_PENDING_ITEM_STATUS_CODES,
} from "./salesOrderLogisticStatus.js";

const REF = new Date(2026, 5, 15);

describe("salesOrderLogisticStatus", () => {
  it("expõe códigos pendentes e cancelados documentados", () => {
    assert.ok(NOMUS_PENDING_ITEM_STATUS_CODES.has(1));
    assert.ok(NOMUS_PENDING_ITEM_STATUS_CODES.has(2));
    assert.ok(NOMUS_PENDING_ITEM_STATUS_CODES.has(3));
    assert.ok(NOMUS_CANCELLED_ITEM_STATUS_CODES.has(6));
  });

  it("pedido com NF antes/na data prevista gera Faturado no prazo", () => {
    const result = buildSalesOrderLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 20),
      nomusRawResponse: {
        nfes: [{ dataProcessamento: "15/06/2026", numero: "1" }],
        itensPedido: [{ status: "Liberado", quantidade: 10 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Faturado no prazo");
  });

  it("pedido com NF após data prevista gera Faturado com atraso", () => {
    const result = buildSalesOrderLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 1),
      nomusRawResponse: {
        nfes: [{ dataProcessamento: "15/06/2026", numero: "1" }],
        itensPedido: [{ status: "Liberado", quantidade: 10 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Faturado com atraso");
  });

  it("sem NF, status item 2 e prazo vencido gera Atrasado pendente", () => {
    const result = buildSalesOrderLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 1),
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: 2, quantidade: 5 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Atrasado pendente");
  });

  it("sem NF, status item 1 e prazo futuro gera No prazo pendente", () => {
    const result = buildSalesOrderLogisticStatus({
      expectedDeliveryDate: new Date(2026, 6, 1),
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: 1, quantidade: 5 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "No prazo pendente");
  });

  it("sem NF e status item 6 gera Cancelado (PD 02130)", () => {
    const result = buildSalesOrderLogisticStatus({
      expectedDeliveryDate: new Date(2026, 0, 23),
      nomusRawResponse: {
        itensPedido: [{ status: 6, quantidade: 1, quantidadeCancelada: 1 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Cancelado");
    const cmp = compareLogisticToExecutiveStatus(result, "Cancelado");
    assert.equal(cmp.diverges, false);
  });

  it("divergência entre logístico e gerencial é sinalizada", () => {
    const logistic = buildSalesOrderLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 1),
      nomusRawResponse: {
        nfes: [{ dataProcessamento: "15/06/2026" }],
        itensPedido: [{ status: "Atendido totalmente", quantidade: 10, quantidadeFaturada: 10 }],
      },
      referenceDate: REF,
    });
    const cmp = compareLogisticToExecutiveStatus(logistic, "Liberado");
    assert.equal(cmp.diverges, true);
    assert.match(cmp.message ?? "", /Divergência/i);
  });
});
