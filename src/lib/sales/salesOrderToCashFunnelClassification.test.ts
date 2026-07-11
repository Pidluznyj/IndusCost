import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  classifySalesOrderToCashFunnel,
  classifySalesOrderToCashFunnelRow,
  type ClassifySalesOrderToCashFunnelInput,
} from "./salesOrderToCashFunnelClassification.js";

const TODAY = "2026-07-11";

function baseOrder(
  partial: Partial<NonNullable<ClassifySalesOrderToCashFunnelInput["order"]>> & {
    id: string;
  }
): NonNullable<ClassifySalesOrderToCashFunnelInput["order"]> {
  return {
    orderCode: partial.orderCode ?? partial.id,
    totalNetValue: 100_000,
    issueDate: "2026-06-01",
    expectedDeliveryDate: "2026-08-15",
    status: "OPEN",
    customerId: "c1",
    customerName: "Cliente A",
    sellerId: "s1",
    sellerName: "Vendedor A",
    ...partial,
  };
}

function classify(input: ClassifySalesOrderToCashFunnelInput) {
  return classifySalesOrderToCashFunnel({ today: TODAY, ...input });
}

describe("salesOrderToCashFunnelClassification", () => {
  it("1. pedido recebido vira RECEBIDO", () => {
    const r = classify({
      order: baseOrder({ id: "pd-rec" }),
      receivables: [
        { openValue: 0, receivedValue: 100_000, totalValue: 100_000, settlementDate: "2026-07-01" },
      ],
      payments: [{ receivedValue: 100_000, settlementDate: "2026-07-01" }],
    });
    assert.equal(r.funnelStage, "RECEBIDO");
    assert.equal(r.confidenceScore, 100);
    assert.equal(r.stageGroup, "CAIXA");
  });

  it("2. pedido com CR aberto vira CR_ABERTO", () => {
    const r = classify({
      order: baseOrder({ id: "pd-cr" }),
      receivables: [
        { openValue: 80_000, receivedValue: 0, totalValue: 80_000, dueDate: "2026-08-01" },
      ],
    });
    assert.equal(r.funnelStage, "CR_ABERTO");
    assert.equal(r.confidenceScore, 90);
    assert.equal(r.stageGroup, "FINANCEIRO");
  });

  it("3. documento sem CR vira NF_SEM_CR ou DOCUMENTO_SEM_NF", () => {
    const nf = classify({
      order: baseOrder({ id: "pd-nf" }),
      nfes: [{ externalId: 1, numero: "123", valorLiquido: 100_000 }],
    });
    assert.equal(nf.funnelStage, "NF_SEM_CR");

    const doc = classify({
      order: baseOrder({ id: "pd-doc" }),
      stockDocuments: [{ id: "d1", externalId: 10, dataDocumento: "2026-07-01" }],
    });
    assert.equal(doc.funnelStage, "DOCUMENTO_SEM_NF");
  });

  it("4. atendimento total vira PEDIDO_TOTALMENTE_ATENDIDO", () => {
    const r = classify({
      order: baseOrder({ id: "pd-tot" }),
      fulfillmentMap: {
        operationalStatus: "OP_TOTALMENTE_ATENDIDO",
        fulfillmentSummary: {
          orderValue: 100_000,
          isFullyFulfilledByItems: true,
          hasExcessQuantity: false,
        },
      },
    });
    assert.equal(r.funnelStage, "PEDIDO_TOTALMENTE_ATENDIDO");
    assert.equal(r.confidenceScore, 75);
  });

  it("5. atendimento total com excedente vira PEDIDO_ATENDIDO_COM_EXCEDENTE", () => {
    const r = classify({
      order: baseOrder({ id: "pd-exc" }),
      fulfillmentMap: {
        operationalStatus: "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE",
        fulfillmentSummary: {
          orderValue: 100_000,
          isFullyFulfilledByItems: true,
          hasExcessQuantity: true,
        },
      },
    });
    assert.equal(r.funnelStage, "PEDIDO_ATENDIDO_COM_EXCEDENTE");
    assert.ok(r.alerts.includes("DOCUMENTO_COM_EXCEDENTE"));
  });

  it("6. atendimento parcial vira PEDIDO_PARCIALMENTE_ATENDIDO", () => {
    const r = classify({
      order: baseOrder({ id: "pd-par" }),
      fulfillmentMap: {
        operationalStatus: "OP_PARCIALMENTE_ATENDIDO",
        fulfillmentSummary: {
          orderValue: 100_000,
          fulfillmentPercent: 40,
          isFullyFulfilledByItems: false,
        },
      },
    });
    assert.equal(r.funnelStage, "PEDIDO_PARCIALMENTE_ATENDIDO");
    assert.ok(r.alerts.includes("DOCUMENTO_PARCIAL"));
  });

  it("7. pedido futuro vira PEDIDO_FUTURO_SAUDAVEL", () => {
    const r = classify({
      order: baseOrder({
        id: "pd-fut",
        issueDate: "2026-07-01",
        expectedDeliveryDate: "2026-08-20",
      }),
    });
    assert.equal(r.funnelStage, "PEDIDO_FUTURO_SAUDAVEL");
    assert.equal(r.temperature, "QUENTE");
  });

  it("8. pedido próximo vira PEDIDO_PROXIMO_ATENCAO", () => {
    const r = classify({
      order: baseOrder({
        id: "pd-prox",
        issueDate: "2026-07-01",
        expectedDeliveryDate: "2026-07-14",
      }),
    });
    assert.equal(r.funnelStage, "PEDIDO_PROXIMO_ATENCAO");
    assert.equal(r.temperature, "MORNO");
  });

  it("9. pedido vencido sem documento vira PEDIDO_ATRASADO_SEM_DOCUMENTO", () => {
    const r = classify({
      order: baseOrder({
        id: "pd-atr",
        issueDate: "2026-05-01",
        expectedDeliveryDate: "2026-06-01",
      }),
    });
    assert.equal(r.funnelStage, "PEDIDO_ATRASADO_SEM_DOCUMENTO");
    assert.ok(r.alerts.includes("ENTREGA_VENCIDA_SEM_DOCUMENTO"));
  });

  it("10. pedido antigo sem evolução vira BLOQUEADO_REVISAO", () => {
    const r = classify({
      order: baseOrder({
        id: "pd-blk",
        issueDate: "2026-01-01",
        expectedDeliveryDate: "2026-02-01",
        totalNetValue: 200_000,
      }),
    });
    assert.equal(r.funnelStage, "BLOQUEADO_REVISAO");
    assert.equal(r.temperature, "CONGELADO");
    assert.ok(r.confidenceScore >= 5 && r.confidenceScore <= 20);
  });

  it("11. cancelado vira CANCELADO", () => {
    const r = classify({
      order: baseOrder({ id: "pd-can", status: "CANCELLED", totalNetValue: 50_000 }),
    });
    assert.equal(r.funnelStage, "CANCELADO");
    assert.equal(r.valueForStage, 0);
  });

  it("12. alertas não substituem estágio principal indevidamente", () => {
    const r = classify({
      order: baseOrder({ id: "pd-alert" }),
      receivables: [
        { openValue: 50_000, receivedValue: 0, totalValue: 50_000, dueDate: "2026-06-01" },
      ],
      fulfillmentMap: {
        operationalStatus: "OP_PARCIALMENTE_ATENDIDO",
        technicalAlerts: ["PRODUTO_FORA_DO_PEDIDO", "QUANTIDADE_EXCEDENTE_DOCUMENTO"],
        fulfillmentSummary: {
          hasProductsOutsideOrder: true,
          hasExcessQuantity: true,
          fulfillmentPercent: 50,
        },
      },
    });
    assert.equal(r.funnelStage, "CR_ABERTO");
    assert.ok(r.alerts.includes("PRODUTO_FORA_DO_PEDIDO") || r.alerts.includes("CR_VENCIDO"));
    assert.notEqual(r.funnelStage, "PEDIDO_PARCIALMENTE_ATENDIDO");
  });

  it("13. temperatura CONGELADO para bloqueado", () => {
    const r = classify({
      order: baseOrder({
        id: "pd-cong",
        issueDate: "2025-12-01",
        expectedDeliveryDate: "2026-01-15",
      }),
    });
    assert.equal(r.funnelStage, "BLOQUEADO_REVISAO");
    assert.equal(r.temperature, "CONGELADO");
  });

  it("14. temperatura QUENTE para pedido futuro saudável", () => {
    const r = classify({
      order: baseOrder({
        id: "pd-quente",
        issueDate: "2026-07-05",
        expectedDeliveryDate: "2026-09-01",
      }),
    });
    assert.equal(r.funnelStage, "PEDIDO_FUTURO_SAUDAVEL");
    assert.equal(r.temperature, "QUENTE");
  });

  it("15. não usa proposta", () => {
    const src = readFileSync(
      new URL("./salesOrderToCashFunnelClassification.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(src, /from\s+["'][^"']*proposal/i);
    assert.doesNotMatch(src, /salesFunnel\.ts/);
    assert.doesNotMatch(src, /ProposalStatus/);
  });

  it("16. não usa comissão", () => {
    const src = readFileSync(
      new URL("./salesOrderToCashFunnelClassification.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(src, /from\s+["'][^"']*comiss/i);
    assert.doesNotMatch(src, /from\s+["'][^"']*commission/i);
  });

  it("classifySalesOrderToCashFunnelRow preenche identidade", () => {
    const row = classifySalesOrderToCashFunnelRow({
      today: TODAY,
      order: baseOrder({ id: "pd-row", orderCode: "PD-ROW" }),
      receivables: [{ openValue: 10_000, receivedValue: 0, totalValue: 10_000 }],
    });
    assert.equal(row.orderId, "pd-row");
    assert.equal(row.orderCode, "PD-ROW");
    assert.equal(row.funnelStage, "CR_ABERTO");
    assert.equal(row.hasOpenCr, true);
  });
});
