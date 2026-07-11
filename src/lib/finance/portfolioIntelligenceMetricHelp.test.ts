import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetricExplanation } from "./portfolioMaturityClassification";
import { SELLER_KPI_EXPLANATIONS } from "./portfolioIntelligenceSellerKpiExplanations";
import { PORTFOLIO_INTELLIGENCE_DATE_AXIS_HELP } from "./portfolioIntelligenceFilters";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_CARD_KEYS = [
  "CARTEIRA_TOTAL_ANALISADA",
  "RECEBIDO",
  "CR_ABERTO",
  "FATURADO_SEM_CR",
  "CARTEIRA_FUTURA_PROVAVEL",
  "CARTEIRA_PRESENTE_ATENCAO",
  "CARTEIRA_VENCIDA_BLOQUEADA",
  "DIVERGENCIA_TECNICA",
  "NF_CABECALHO_MAIOR_PEDIDO",
  "QUANTIDADE_EXCEDENTE_DOCUMENTO",
  "PRODUTO_FORA_DO_PEDIDO",
  "OP_PCT_TOTALMENTE_ATENDIDO",
  "OP_PCT_PARCIALMENTE_ATENDIDO",
  "OP_PCT_NAO_ATENDIDO",
  "OP_VALOR_TOTALMENTE_ATENDIDO",
  "OP_VALOR_PARCIALMENTE_ATENDIDO",
  "OP_VALOR_NAO_ATENDIDO",
  "PEDIDOS_COM_QTD_EXCEDENTE",
  "QTD_EXCEDENTE_TOTAL",
  "VALOR_ESTIMADO_EXCEDENTE",
  "PEDIDOS_COM_PRODUTO_FORA",
  "VALOR_DOCUMENTO_FORA_PEDIDO",
  "VALOR_CABECALHO_NAO_ATRIBUIDO",
  "SEM_EVIDENCIA",
  "RISCO_SUPERESTIMACAO",
  "CONVERSAO_PEDIDOS_CR_QTD",
  "CONVERSAO_PEDIDOS_CR_VALOR",
  "CONVERSAO_DOC_SAIDA_QTD",
  "CONVERSAO_DOC_SAIDA_VALOR",
  "TAXA_RECEBIMENTO_CR",
  "CONFIANCA_MEDIA_CARTEIRA",
] as const;

describe("portfolio intelligence metric help", () => {
  it("todas as métricas de card têm explicação leiga completa", () => {
    for (const key of REQUIRED_CARD_KEYS) {
      const e = getMetricExplanation(key);
      assert.ok(e.oQueSignifica.length > 20, key);
      assert.ok(e.comoCalculamos.length > 10, key);
      assert.ok(e.oQueEntra.length > 5, key);
      assert.ok(e.oQueNaoEntra.length > 5, key);
      assert.ok(e.comoInterpretar.length > 10, key);
      assert.doesNotMatch(e.oQueSignifica, /OPEN_OVERDUE|factStatus|Σ |× 100/);
    }
  });

  it("exemplos obrigatórios estão cobertos", () => {
    const cr = getMetricExplanation("CONVERSAO_PEDIDOS_CR_QTD");
    assert.match(cr.oQueSignifica, /Contas a Receber/i);
    assert.match(cr.comoCalculamos, /pedidos com CR|dividido/i);
    assert.match(cr.comoInterpretar, /financeiro real/i);

    const blocked = getMetricExplanation("CARTEIRA_VENCIDA_BLOQUEADA");
    assert.match(blocked.oQueSignifica, /NF|documento|CR/i);
    assert.match(blocked.comoInterpretar, /caixa confiável/i);

    const conf = getMetricExplanation("CONFIDENCE_SCORE");
    assert.match(conf.oQueSignifica, /0 a 100|0–100/i);
    assert.match(conf.comoInterpretar, /não é previsão perfeita|operacional/i);

    const risk = getMetricExplanation("RISCO_SUPERESTIMACAO");
    assert.match(risk.oQueSignifica, /inflando|antigos/i);
    assert.match(risk.comoInterpretar, /validação|caixa/i);

    assert.match(
      PORTFOLIO_INTELLIGENCE_DATE_AXIS_HELP.whatItMeans,
      /emissão.*vencimento|diferentes/i
    );
  });

  it("KPIs por vendedor e tooltip padronizado existem", () => {
    assert.ok(Object.keys(SELLER_KPI_EXPLANATIONS).length >= 10);
    const help = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceHelpPopover.tsx"
      ),
      "utf8"
    );
    assert.match(help, /MetricHelpTooltip/);
    assert.match(help, /portfolio-intelligence-help-operational/);
    assert.match(help, /Escape/);
  });
});
