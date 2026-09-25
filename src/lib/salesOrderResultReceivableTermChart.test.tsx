/**
 * Gráfico "Prazo médio de recebimento por mês" (tela Resultado) — render estático
 * real do componente nos estados: com dados, vazio, carregando e erro; e os dois
 * cards acima do gráfico (período selecionado × mesmo período do ano anterior).
 * Loader vazio para `.css` (os cards importam CSS), como o teste do card da listagem.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildSalesOrderGrantedPaymentTermMonthlySeries,
  type GrantedPaymentTermDatedOrderInput,
} from "./salesOrderGrantedPaymentTerm.js";

function dated(
  id: string,
  issueDate: Date,
  totalNetValue: number,
  days: number | null
): GrantedPaymentTermDatedOrderInput {
  const nfIssue = new Date(issueDate.getFullYear(), issueDate.getMonth(), issueDate.getDate());
  return {
    id,
    issueDate,
    totalNetValue,
    paymentTerms: null,
    invoiced: days != null,
    titles:
      days == null
        ? []
        : [
            {
              invoiceIssueDate: nfIssue,
              dueDate: new Date(nfIssue.getFullYear(), nfIssue.getMonth(), nfIssue.getDate() + days),
              amount: totalNetValue,
            },
          ],
  };
}

const REFERENCE = new Date(2026, 8, 25);

const SERIES = buildSalesOrderGrantedPaymentTermMonthlySeries({
  year: 2026,
  currentYearOrders: [dated("a", new Date(2026, 0, 10), 10_000, 45), dated("b", new Date(2026, 8, 3), 5_000, null)],
  previousYearOrders: [
    dated("p", new Date(2025, 0, 12), 8_000, 30),
    dated("q", new Date(2025, 10, 5), 8_000, 90), // depois de 25/11: fora do acumulado comparável
  ],
  month: null,
  referenceDate: REFERENCE,
});

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

type ChartModule = typeof import("../components/sales/SalesOrderResultReceivableTermChart.js");
let SalesOrderResultReceivableTermChart: ChartModule["SalesOrderResultReceivableTermChart"];

before(async () => {
  SalesOrderResultReceivableTermChart = (
    await import("../components/sales/SalesOrderResultReceivableTermChart.js")
  ).SalesOrderResultReceivableTermChart;
});

function render(props: Parameters<ChartModule["SalesOrderResultReceivableTermChart"]>[0]): string {
  return renderToStaticMarkup(<SalesOrderResultReceivableTermChart {...props} />);
}

function cardHtml(html: string, testId: string): string {
  const start = html.indexOf(`data-testid="${testId}"`);
  assert.ok(start >= 0, `card ${testId}`);
  return html.slice(start, start + 4_000);
}

describe("SalesOrderResultReceivableTermChart", () => {
  it("com dados: título 12 meses × ano anterior, cards do período acima do gráfico e botão de expandir", () => {
    const html = render({ series: SERIES, loading: false, error: null });
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart"/);
    assert.match(html, /Prazo médio de recebimento por mês — 2026 vs 2025/);
    assert.match(html, /emissão da NF-e e o vencimento dos títulos do Contas a Receber/);
    assert.match(html, /Cards: período selecionado × as mesmas datas do ano anterior/);
    assert.match(html, /o filtro Mês não se aplica às barras/);
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart-expand"/);
    assert.doesNotMatch(html, /-empty"|-loading"|-error"/);
    assert.doesNotMatch(html, /-year-summary"/, "resumo anual em chips foi substituído pelos cards");

    // Cards acima do gráfico (antes do corpo do gráfico no HTML).
    const periodIdx = html.indexOf('data-testid="sales-order-result-receivable-term-chart-period"');
    assert.ok(periodIdx > 0);
    assert.match(html, /data-trend="WORSE"/);

    const current = cardHtml(html, "sales-order-result-receivable-term-chart-period-current");
    assert.match(current, /Prazo médio 2026 · acumulado/);
    assert.match(current, /45,0 dias/);
    assert.match(current, /01\/01 a 25\/09\/2026 · cobertura 100,0% do faturado/);
    assert.match(current, /data-testid="sales-order-result-receivable-term-chart-period-trend"/);
    assert.match(current, /\+15,0 dias vs 2025 · pior/);

    const previous = cardHtml(html, "sales-order-result-receivable-term-chart-period-previous");
    assert.match(previous, /Mesmo período 2025/);
    assert.match(previous, /30,0 dias/);
    assert.match(previous, /01\/01 a 25\/09\/2025/);
    assert.match(previous, /Base da comparação/);
  });

  it("Mês selecionado: card do mês; prazo menor que o do ano anterior = melhor", () => {
    const series = buildSalesOrderGrantedPaymentTermMonthlySeries({
      year: 2026,
      currentYearOrders: [dated("a", new Date(2026, 0, 10), 10_000, 20)],
      previousYearOrders: [dated("p", new Date(2025, 0, 12), 8_000, 30)],
      month: 1,
      referenceDate: REFERENCE,
    });
    const html = render({ series, loading: false, error: null });
    assert.match(html, /data-trend="BETTER"/);
    const current = cardHtml(html, "sales-order-result-receivable-term-chart-period-current");
    assert.match(current, /Prazo médio Jan\/2026/);
    assert.match(current, /01\/01 a 31\/01\/2026/);
    assert.match(current, /−10,0 dias vs 2025 · melhor/);
  });

  it("sem pedidos faturados no período: mensagem de vazio, cards sem número, sem gráfico", () => {
    const empty = buildSalesOrderGrantedPaymentTermMonthlySeries({
      year: 2026,
      currentYearOrders: [dated("x", new Date(2026, 2, 1), 1_000, null)],
      previousYearOrders: [],
      referenceDate: REFERENCE,
    });
    const html = render({ series: empty, loading: false, error: null });
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart-empty"/);
    assert.match(html, /Sem pedidos faturados com prazo apurado no período\./);
    assert.match(html, /data-trend="UNAVAILABLE"/);
    assert.match(html, /Sem base de comparação/);
    assert.match(html, /Indisponível/);
    assert.doesNotMatch(html, /-expand"/);
  });

  it("carregando e erro (fail-soft) sem dados anteriores", () => {
    const loading = render({ series: null, loading: true, error: null });
    assert.match(loading, /data-testid="sales-order-result-receivable-term-chart-loading"/);
    assert.match(loading, /Carregando prazo médio de recebimento…/);
    assert.doesNotMatch(loading, /-period"/);

    const failed = render({ series: null, loading: false, error: "Falhou" });
    assert.match(failed, /data-testid="sales-order-result-receivable-term-chart-error"/);
    assert.match(failed, /Falhou/);
  });

  it("recarregando com dados anteriores mantém cards e gráfico e mostra 'Atualizando…'", () => {
    const html = render({ series: SERIES, loading: true, error: null });
    assert.match(html, /Atualizando…/);
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart-period-current"/);
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart-expand"/);
  });
});
