import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrderEvidenceTags,
  buildOrderExecutiveSummary,
  calculateOrderConfidence,
  classifyPortfolioOrder,
  getMetricExplanation,
  type PortfolioMaturityOrderInput,
  type PortfolioMaturityStatus,
} from "./portfolioMaturityClassification.js";

const AS_OF = "2026-07-10";

function base(
  partial: Partial<PortfolioMaturityOrderInput> & { orderCode: string }
): PortfolioMaturityOrderInput {
  return {
    orderValue: 100_000,
    receivedValue: 0,
    openReceivableValue: 0,
    receivableTotalValue: 0,
    hasNfe: false,
    hasStockDocument: false,
    hasAllocation: false,
    itemizedAllocatedValue: 0,
    nfeHeaderValue: 0,
    forecastSource: "ORDER",
    factStatus: "ORDER_ONLY",
    factConfidenceLevel: "LOW",
    alerts: [],
    paymentTermsAvailable: true,
    asOfDate: AS_OF,
    ...partial,
  };
}

describe("portfolioMaturityClassification", () => {
  it("1. Pedido recebido → RECEBIDO confiança 100", () => {
    const r = classifyPortfolioOrder(
      base({
        orderCode: "PD REC",
        receivedValue: 50_000,
        openReceivableValue: 0,
        receivableTotalValue: 50_000,
        hasNfe: true,
        hasAllocation: true,
        forecastSource: "RECEIVABLE",
        factStatus: "RECEIVED",
        factConfidenceLevel: "HIGH",
      })
    );
    assert.equal(r.statusPrincipal, "RECEBIDO");
    assert.equal(r.confidenceScore, 100);
    assert.equal(r.confidenceLabel, "ALTA");
    assert.match(r.resumoExecutivo, /recebimento/i);
  });

  it("2. Pedido com CR aberto → CR_ABERTO", () => {
    const r = classifyPortfolioOrder(
      base({
        orderCode: "PD CR",
        openReceivableValue: 158_000,
        receivableTotalValue: 158_000,
        hasNfe: true,
        hasStockDocument: true,
        hasAllocation: true,
        itemizedAllocatedValue: 158_000,
        forecastSource: "RECEIVABLE",
        forecastDate: "2026-08-10",
        factStatus: "RECEIVABLE_CONFIRMED",
        factConfidenceLevel: "HIGH",
      })
    );
    assert.equal(r.statusPrincipal, "CR_ABERTO");
    assert.ok(r.confidenceScore >= 85 && r.confidenceScore <= 95);
    assert.equal(r.confidenceLabel, "ALTA");
  });

  it("3. Pedido com NF/documento sem CR → FATURADO_SEM_CR", () => {
    const r = classifyPortfolioOrder(
      base({
        orderCode: "PD NF",
        hasNfe: true,
        hasStockDocument: true,
        hasAllocation: true,
        itemizedAllocatedValue: 10_000,
        forecastSource: "NFE",
        forecastDate: "2026-07-20",
        factStatus: "ITEM_ALLOCATED",
        factConfidenceLevel: "MEDIUM",
      })
    );
    assert.equal(r.statusPrincipal, "FATURADO_SEM_CR");
    assert.ok(r.confidenceScore >= 60 && r.confidenceScore <= 75);
    assert.ok(r.tagsAlerta.includes("DOCUMENTO_SEM_CR"));
  });

  it("4. Pedido futuro sem NF/documento/CR → CARTEIRA_FUTURA_PROVAVEL (PD 02607/02740)", () => {
    for (const code of ["PD 02607", "PD 02740"]) {
      const r = classifyPortfolioOrder(
        base({
          orderCode: code,
          orderValue: 200_000,
          forecastDate: "2026-09-15", // > 30 dias de 2026-07-10
          forecastSource: "ORDER",
          factStatus: "ORDER_ONLY",
          orderIssueDate: "2026-06-01",
        })
      );
      assert.equal(r.statusPrincipal, "CARTEIRA_FUTURA_PROVAVEL", code);
      assert.ok(r.confidenceScore >= 55 && r.confidenceScore <= 70, code);
      assert.equal(r.sinaisEvidencia.hasNfe, false);
      assert.equal(r.sinaisEvidencia.hasOpenReceivable, false);
    }
  });

  it("5. Pedido presente/atenção sem NF/documento/CR → CARTEIRA_PRESENTE_ATENCAO (PD 02739)", () => {
    const r = classifyPortfolioOrder(
      base({
        orderCode: "PD 02739",
        orderValue: 95_460,
        forecastDate: "2026-07-20", // dentro de 30 dias
        forecastSource: "ORDER",
        factStatus: "ORDER_ONLY",
        orderIssueDate: "2026-06-15",
      })
    );
    assert.equal(r.statusPrincipal, "CARTEIRA_PRESENTE_ATENCAO");
    assert.ok(r.confidenceScore >= 40 && r.confidenceScore <= 60);
  });

  it("6. Pedido vencido antigo sem NF/documento/CR → CARTEIRA_VENCIDA_BLOQUEADA", () => {
    const critical = [
      "PD 02159",
      "PD 01604",
      "PD 01953",
      "PD 02092",
      "PD 01954",
      "PD 01955",
      "PD 02080",
      "PD 01603",
      "PD 02158",
      "PD 01562",
    ];
    for (const code of critical) {
      const r = classifyPortfolioOrder(
        base({
          orderCode: code,
          orderValue: 80_000,
          forecastDate: "2025-12-01", // > 60 dias antes de 2026-07-10
          forecastSource: "ORDER",
          factStatus: "ORDER_ONLY",
          factConfidenceLevel: "LOW",
          orderIssueDate: "2025-01-15",
        })
      );
      assert.equal(r.statusPrincipal, "CARTEIRA_VENCIDA_BLOQUEADA", code);
      assert.ok(r.confidenceScore >= 5 && r.confidenceScore <= 30, `${code} score=${r.confidenceScore}`);
      assert.ok(r.tagsAlerta.includes("PEDIDO_ANTIGO_SEM_EVOLUCAO"), code);
      assert.match(r.resumoExecutivo, /não confundir com título vencido/i);
    }
  });

  it("7. CR aberto + divergência técnica → status CR_ABERTO + tag DIVERGENCIA_TECNICA", () => {
    const r = classifyPortfolioOrder(
      base({
        orderCode: "PD 02339",
        orderValue: 158_000,
        openReceivableValue: 158_000,
        receivableTotalValue: 158_000,
        hasNfe: true,
        hasStockDocument: true,
        hasAllocation: true,
        itemizedAllocatedValue: 158_000,
        nfeHeaderValue: 355_290,
        forecastSource: "RECEIVABLE",
        forecastDate: "2026-07-10",
        factStatus: "OVER_LINKED_BY_HEADER",
        factConfidenceLevel: "MEDIUM",
        alerts: ["Soma de cabeçalhos de NF maior que o pedido"],
      })
    );
    assert.equal(r.statusPrincipal, "CR_ABERTO");
    assert.ok(r.tagsAlerta.includes("DIVERGENCIA_TECNICA"));
    assert.ok(r.tagsAlerta.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.notEqual(r.statusPrincipal, "DIVERGENCIA_TECNICA" as PortfolioMaturityStatus);
  });

  it("8. Pedido sem condição de pagamento → tag SEM_CONDICAO_PAGAMENTO", () => {
    const r = classifyPortfolioOrder(
      base({
        orderCode: "PD SEM COND",
        forecastDate: "2026-09-01",
        paymentTermsAvailable: false,
      })
    );
    assert.ok(r.tagsAlerta.includes("SEM_CONDICAO_PAGAMENTO"));
    assert.ok(
      r.motivosConfianca.some((m) => /Informação não disponível na importação atual/i.test(m))
    );
  });

  it("9. Status principal é único (um por classificação)", () => {
    const samples = [
      base({ orderCode: "A", receivedValue: 1, openReceivableValue: 0, factStatus: "RECEIVED" }),
      base({
        orderCode: "B",
        openReceivableValue: 10,
        hasNfe: true,
        forecastSource: "RECEIVABLE",
        factStatus: "RECEIVABLE_CONFIRMED",
      }),
      base({
        orderCode: "C",
        hasNfe: true,
        hasStockDocument: true,
        hasAllocation: true,
        forecastSource: "NFE",
      }),
      base({ orderCode: "D", forecastDate: "2026-10-01" }),
      base({ orderCode: "E", forecastDate: "2026-07-15" }),
      base({ orderCode: "F", forecastDate: "2025-01-01", orderIssueDate: "2024-06-01" }),
    ];
    const statuses = new Set(samples.map((s) => classifyPortfolioOrder(s).statusPrincipal));
    assert.equal(samples.length, 6);
    assert.ok(statuses.size >= 5);
    for (const s of samples) {
      const r = classifyPortfolioOrder(s);
      assert.equal(typeof r.statusPrincipal, "string");
      assert.ok(!Array.isArray(r.statusPrincipal));
    }
  });

  it("10. Tags múltiplas sem duplicar/substituir status", () => {
    const tags = buildOrderEvidenceTags(
      base({
        orderCode: "PD MULTI",
        openReceivableValue: 10_000,
        hasNfe: true,
        hasStockDocument: false,
        hasAllocation: false,
        nfeHeaderValue: 50_000,
        orderValue: 10_000,
        forecastSource: "RECEIVABLE",
        factStatus: "OVER_LINKED_BY_HEADER",
        alerts: ["Soma de cabeçalhos de NF maior que o pedido"],
        paymentTermsAvailable: null,
      })
    );
    assert.ok(tags.includes("DIVERGENCIA_TECNICA"));
    assert.ok(tags.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.ok(tags.includes("NF_SEM_DOCUMENTO"));
    assert.ok(tags.includes("SEM_CONDICAO_PAGAMENTO"));
    assert.ok(!tags.includes("CR_ABERTO" as never));
    assert.equal(new Set(tags).size, tags.length);

    const conf = calculateOrderConfidence(
      base({
        orderCode: "PD MULTI",
        openReceivableValue: 10_000,
        hasNfe: true,
        nfeHeaderValue: 50_000,
        orderValue: 10_000,
        forecastSource: "RECEIVABLE",
        factStatus: "OVER_LINKED_BY_HEADER",
        paymentTermsAvailable: false,
      })
    );
    assert.ok(conf.score < 95);

    const summary = buildOrderExecutiveSummary(
      base({
        orderCode: "PD MULTI",
        openReceivableValue: 10_000,
        forecastSource: "RECEIVABLE",
        factStatus: "RECEIVABLE_CONFIRMED",
      })
    );
    assert.match(summary, /Contas a Receber/i);

    const expl = getMetricExplanation("CARTEIRA_VENCIDA_BLOQUEADA");
    assert.match(expl.comoInterpretar, /não acusar cliente/i);
    const missing = getMetricExplanation("METRICA_INEXISTENTE");
    assert.match(missing.oQueSignifica, /Informação não disponível/);
  });
});
