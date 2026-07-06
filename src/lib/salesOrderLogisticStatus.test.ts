import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderBiLogisticStatus,
  buildSalesOrderLogisticStatus,
  compareLogisticToExecutiveStatus,
  NOMUS_CANCELLED_ITEM_STATUS_CODES,
  NOMUS_PENDING_ITEM_STATUS_CODES,
} from "./salesOrderLogisticStatus.js";

const REF = new Date(2026, 5, 15);

describe("salesOrderBiLogisticStatus — fórmula Power BI", () => {
  it("expõe códigos pendentes e cancelados documentados", () => {
    assert.ok(NOMUS_PENDING_ITEM_STATUS_CODES.has(1));
    assert.ok(NOMUS_PENDING_ITEM_STATUS_CODES.has(2));
    assert.ok(NOMUS_PENDING_ITEM_STATUS_CODES.has(3));
    assert.ok(NOMUS_CANCELLED_ITEM_STATUS_CODES.has(6));
  });

  it("1. NF antes da data planejada → Entregue no Prazo", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 20),
      nomusRawResponse: {
        nfes: [{ dataProcessamento: "15/06/2026", numero: "1" }],
        itensPedido: [{ status: 2, quantidade: 10 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Entregue no Prazo");
    assert.equal(result.cardId, "deliveredOnTime");
  });

  it("2. NF no mesmo dia da data planejada → Entregue no Prazo", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 15),
      nomusRawResponse: {
        nfes: [{ dataProcessamento: "15/06/2026", numero: "1" }],
        itensPedido: [{ status: 1, quantidade: 5 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Entregue no Prazo");
  });

  it("3. NF depois da data planejada → Entregue com Atraso", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 1),
      nomusRawResponse: {
        nfes: [{ dataProcessamento: "15/06/2026", numero: "1" }],
        itensPedido: [{ status: 3, quantidade: 10 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Entregue com Atraso");
    assert.equal(result.cardId, "deliveredLate");
  });

  it("4-6. Sem NF, status 1/2/3 e prazo vencido → Atrasado (Pendente)", () => {
    for (const status of [1, 2, 3]) {
      const result = buildSalesOrderBiLogisticStatus({
        expectedDeliveryDate: new Date(2026, 5, 1),
        nomusRawResponse: {
          itensPedido: [{ idProduto: 1, status, quantidade: 5 }],
        },
        referenceDate: REF,
      });
      assert.equal(result.label, "Atrasado (Pendente)", `status ${status}`);
      assert.equal(result.cardId, "overduePending");
    }
  });

  it("7-9. Sem NF, status 1/2/3 e prazo futuro → No Prazo (Pendente)", () => {
    for (const status of [1, 2, 3]) {
      const result = buildSalesOrderBiLogisticStatus({
        expectedDeliveryDate: new Date(2026, 6, 1),
        nomusRawResponse: {
          itensPedido: [{ idProduto: 1, status, quantidade: 5 }],
        },
        referenceDate: REF,
      });
      assert.equal(result.label, "No Prazo (Pendente)", `status ${status}`);
      assert.equal(result.cardId, "onTimePending");
    }
  });

  it("10. Sem NF, status fora de 1/2/3 → Finalizado/Cancelado", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 0, 23),
      nomusRawResponse: {
        itensPedido: [{ status: 6, quantidade: 1, quantidadeCancelada: 1 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Finalizado/Cancelado");
    assert.equal(result.cardId, "finishedOrCancelled");
  });

  it("11. Status item não numérico sem NF → Revisar dados", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 6, 1),
      nomusRawResponse: {
        itensPedido: [{ status: "Liberado", quantidade: 5 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Revisar dados");
    assert.equal(result.cardId, "reviewData");
  });

  it("12. Sem DataPlanejada e sem NF → Revisar dados", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: null,
      nomusRawResponse: {
        itensPedido: [{ status: 1, quantidade: 5 }],
      },
      referenceDate: REF,
    });
    assert.equal(result.label, "Revisar dados");
  });

  it("com NF não cai em pendente mesmo com item status 1/2/3", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 4, 1),
      nomusRawResponse: {
        nfes: [{ dataProcessamento: "15/06/2026" }],
        itensPedido: [{ status: 1, quantidade: 10 }],
      },
      referenceDate: REF,
    });
    assert.notEqual(result.label, "Atrasado (Pendente)");
    assert.notEqual(result.label, "No Prazo (Pendente)");
    assert.equal(result.label, "Entregue com Atraso");
  });

  it("alias buildSalesOrderLogisticStatus retorna mesmo resultado", () => {
    const input = {
      expectedDeliveryDate: new Date(2026, 6, 1),
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 1 }] },
      referenceDate: REF,
    };
    assert.deepEqual(
      buildSalesOrderLogisticStatus(input).label,
      buildSalesOrderBiLogisticStatus(input).label
    );
  });

  it("divergência entre logístico BI e gerencial é sinalizada", () => {
    const logistic = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 1),
      nomusRawResponse: {
        nfes: [{ dataProcessamento: "15/06/2026" }],
        itensPedido: [{ status: 1, quantidade: 10 }],
      },
      referenceDate: REF,
    });
    const cmp = compareLogisticToExecutiveStatus(logistic, "Liberado");
    assert.equal(cmp.diverges, true);
    assert.match(cmp.message ?? "", /Divergência/i);
  });
});
