import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrderCashForecastLine,
  buildPortfolioCashForecastMaturity,
  type PortfolioCashForecastOrderInput,
} from "./portfolioCashForecastMaturity.js";

const AS_OF = "2026-07-10";

function base(
  partial: Partial<PortfolioCashForecastOrderInput> = {}
): PortfolioCashForecastOrderInput {
  return {
    salesOrderId: "so-1",
    orderCode: "PD 00001",
    orderValue: 10_000,
    asOfDate: AS_OF,
    orderIssueDate: "2026-06-01",
    expectedDeliveryDate: "2026-09-15",
    forecastDate: "2026-09-15",
    forecastSource: "ORDER",
    receivedValue: 0,
    openReceivableValue: 0,
    receivableTotalValue: 0,
    hasNfe: false,
    hasStockDocument: false,
    paymentTermsAvailable: true,
    ...partial,
  };
}

describe("portfolioCashForecastMaturity", () => {
  it("1) baixa substitui CR", () => {
    const line = buildOrderCashForecastLine(
      base({
        receivedValue: 10_000,
        openReceivableValue: 0,
        receivableTotalValue: 10_000,
        receivableDueDate: "2026-08-01",
        receivableSettlementDate: "2026-07-05",
        forecastSource: "RECEIVABLE",
      })
    );
    assert.equal(line.sourceType, "RECEIVED");
    assert.equal(line.maturityBucket, "CAIXA_REALIZADO");
    assert.equal(line.confidenceScore, 100);
    assert.equal(line.isReliableCash, true);
    assert.notEqual(line.sourceType, "RECEIVABLE");
  });

  it("2) CR substitui pedido", () => {
    const line = buildOrderCashForecastLine(
      base({
        openReceivableValue: 8_000,
        receivableTotalValue: 8_000,
        receivableDueDate: "2026-08-10",
        forecastDate: "2026-09-15",
        forecastSource: "ORDER",
        expectedDeliveryDate: "2026-09-15",
      })
    );
    assert.equal(line.sourceType, "RECEIVABLE");
    assert.equal(line.maturityBucket, "FINANCEIRO_CONFIRMADO");
    assert.equal(line.forecastDate, "2026-08-10");
    assert.equal(line.confidenceScore, 90);
    assert.match(line.explanation, /Contas a Receber|CR/i);
    assert.ok(
      line.warnings.some((w) => /substituiu a previsão/i.test(w)) ||
        line.forecastDate === "2026-08-10"
    );
  });

  it("3) documento sem CR substitui pedido", () => {
    const line = buildOrderCashForecastLine(
      base({
        hasNfe: true,
        nfeDate: "2026-07-01",
        forecastDate: "2026-09-15",
        forecastSource: "ORDER",
      })
    );
    assert.equal(line.sourceType, "DOCUMENT_OR_NFE");
    assert.equal(line.maturityBucket, "FATURADO_SEM_CR");
    assert.equal(line.confidenceScore, 75);
    assert.equal(line.isReliableCash, false);
  });

  it("4) pedido futuro gera forecast", () => {
    const line = buildOrderCashForecastLine(
      base({
        forecastDate: "2026-09-15",
        expectedDeliveryDate: "2026-09-15",
      })
    );
    assert.equal(line.sourceType, "ORDER_FUTURE");
    assert.equal(line.maturityBucket, "PEDIDO_FUTURO_PROVAVEL");
    assert.equal(line.confidenceScore, 65);
    assert.equal(line.forecastValue, 10_000);
  });

  it("5) pedido recém vencido vira atenção", () => {
    const line = buildOrderCashForecastLine(
      base({
        forecastDate: "2026-06-20",
        expectedDeliveryDate: "2026-06-20",
        orderIssueDate: "2026-05-01",
      })
    );
    assert.equal(line.sourceType, "ORDER_ATTENTION");
    assert.equal(line.maturityBucket, "PEDIDO_PRESENTE_ATENCAO");
    assert.equal(line.confidenceScore, 50);
  });

  it("6) pedido antigo sem documento vira bloqueado", () => {
    const line = buildOrderCashForecastLine(
      base({
        orderIssueDate: "2025-12-01",
        forecastDate: "2025-12-15",
        expectedDeliveryDate: "2025-12-15",
      })
    );
    assert.equal(line.sourceType, "ORDER_BLOCKED");
    assert.equal(line.maturityBucket, "PEDIDO_VENCIDO_BLOQUEADO");
    assert.ok(line.confidenceScore >= 5 && line.confidenceScore <= 20);
  });

  it("7) pedido bloqueado não entra como caixa confiável", () => {
    const result = buildPortfolioCashForecastMaturity({
      asOfDate: AS_OF,
      orders: [
        base({
          orderCode: "PD BLOCK",
          orderIssueDate: "2025-10-01",
          forecastDate: "2025-11-01",
          orderValue: 50_000,
        }),
        base({
          orderCode: "PD CR",
          salesOrderId: "so-cr",
          openReceivableValue: 20_000,
          receivableDueDate: "2026-08-01",
          orderValue: 20_000,
        }),
      ],
    });
    const blocked = result.lines.find((l) => l.orderCode === "PD BLOCK")!;
    assert.equal(blocked.isReliableCash, false);
    assert.equal(blocked.sourceType, "ORDER_BLOCKED");
    const blockedBucket = result.byMaturity.find(
      (b) => b.maturityBucket === "PEDIDO_VENCIDO_BLOQUEADO"
    )!;
    assert.equal(blockedBucket.isReliableCash, false);
    assert.ok(result.totals.reliableCashValue < 50_000 + 20_000);
    assert.equal(result.totals.reliableCashValue, 20_000);
    assert.ok(result.totals.unreliableValue >= 50_000);
  });

  it("8) condição ausente gera warning", () => {
    const line = buildOrderCashForecastLine(
      base({
        paymentTermsAvailable: false,
        forecastDate: "2026-09-15",
      })
    );
    assert.ok(line.warnings.includes("SEM_CONDICAO_PAGAMENTO"));
    assert.ok(line.confidenceScore < 65);
  });

  it("9) confidence segue fonte", () => {
    assert.equal(buildOrderCashForecastLine(base({
      receivedValue: 100,
      openReceivableValue: 0,
      receivableSettlementDate: "2026-07-01",
    })).confidenceScore, 100);

    assert.equal(buildOrderCashForecastLine(base({
      openReceivableValue: 100,
      receivableDueDate: "2026-08-01",
      paymentTermsAvailable: true,
    })).confidenceScore, 90);

    assert.equal(buildOrderCashForecastLine(base({
      hasStockDocument: true,
      stockDocumentDate: "2026-07-01",
      paymentTermsAvailable: true,
    })).confidenceScore, 75);

    assert.equal(buildOrderCashForecastLine(base({
      forecastDate: "2026-10-01",
      paymentTermsAvailable: true,
    })).confidenceScore, 65);

    assert.equal(buildOrderCashForecastLine(base({
      forecastDate: "2026-07-15",
      paymentTermsAvailable: true,
    })).confidenceScore, 50);
  });

  it("10) explicação em português simples", () => {
    const line = buildOrderCashForecastLine(
      base({
        openReceivableValue: 5_000,
        receivableDueDate: "2026-08-01",
      })
    );
    assert.match(line.explanation, /pedido|Contas a Receber|caixa|previsão/i);
    assert.doesNotMatch(line.explanation, /Prisma|SQL|forecastSource/);
    assert.match(line.sourceLabel, /Contas a Receber|Baixa|Documento|Pedido/);
  });

  it("prefere data do item do pedido quando existir", () => {
    const line = buildOrderCashForecastLine(
      base({
        forecastDate: "2026-09-15",
        expectedDeliveryDate: "2026-09-15",
        items: [
          { salesOrderItemId: "i1", expectedDate: "2026-10-01", orderItemValue: 10_000 },
        ],
      })
    );
    assert.equal(line.sourceType, "ORDER_FUTURE");
    assert.equal(line.forecastDate, "2026-10-01");
  });

  it("sem data de item gera warning e usa data do pedido", () => {
    const line = buildOrderCashForecastLine(
      base({
        forecastDate: "2026-09-15",
        items: [],
      })
    );
    assert.equal(line.forecastDate, "2026-09-15");
    assert.ok(line.warnings.some((w) => /Sem data por item/i.test(w)));
  });
});
