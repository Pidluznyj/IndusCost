/**
 * Gráfico "Prazo médio de recebimento por mês" (tela Resultado) — render estático
 * real do componente nos estados: com dados, vazio, carregando e erro.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesOrderResultReceivableTermChart } from "../components/sales/SalesOrderResultReceivableTermChart.js";
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

const SERIES = buildSalesOrderGrantedPaymentTermMonthlySeries({
  year: 2026,
  currentYearOrders: [dated("a", new Date(2026, 0, 10), 10_000, 45), dated("b", new Date(2026, 8, 3), 5_000, null)],
  previousYearOrders: [dated("p", new Date(2025, 0, 12), 8_000, 30)],
});

function render(props: Parameters<typeof SalesOrderResultReceivableTermChart>[0]): string {
  return renderToStaticMarkup(<SalesOrderResultReceivableTermChart {...props} />);
}

describe("SalesOrderResultReceivableTermChart", () => {
  it("com dados: título 12 meses × ano anterior, resumo anual por ano e botão de expandir", () => {
    const html = render({ series: SERIES, loading: false, error: null });
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart"/);
    assert.match(html, /Prazo médio de recebimento por mês — 2026 vs 2025/);
    assert.match(html, /emissão da NF-e e o vencimento dos títulos do Contas a Receber/);
    assert.match(html, /o filtro Mês não se aplica \(visão de 12 meses\)/);
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart-year-summary"/);
    assert.match(html, /2026: <strong>45,0 dias<\/strong>/);
    assert.match(html, /2025: <strong>30,0 dias<\/strong>/);
    assert.match(html, /cobertura 100,0% do faturado/);
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart-expand"/);
    assert.doesNotMatch(html, /-empty"|-loading"|-error"/);
  });

  it("sem pedidos faturados no período: mensagem de vazio, sem gráfico", () => {
    const empty = buildSalesOrderGrantedPaymentTermMonthlySeries({
      year: 2026,
      currentYearOrders: [dated("x", new Date(2026, 2, 1), 1_000, null)],
      previousYearOrders: [],
    });
    const html = render({ series: empty, loading: false, error: null });
    assert.match(html, /data-testid="sales-order-result-receivable-term-chart-empty"/);
    assert.match(html, /Sem pedidos faturados com prazo apurado no período\./);
    assert.match(html, /2026: <strong>Indisponível<\/strong>/);
    assert.doesNotMatch(html, /-expand"/);
  });

  it("carregando e erro (fail-soft) sem dados anteriores", () => {
    const loading = render({ series: null, loading: true, error: null });
    assert.match(loading, /data-testid="sales-order-result-receivable-term-chart-loading"/);
    assert.match(loading, /Carregando prazo médio de recebimento…/);

    const failed = render({ series: null, loading: false, error: "Falhou" });
    assert.match(failed, /data-testid="sales-order-result-receivable-term-chart-error"/);
    assert.match(failed, /Falhou/);
  });

  it("recarregando com dados anteriores mantém o gráfico e mostra 'Atualizando…'", () => {
    const html = render({ series: SERIES, loading: true, error: null });
    assert.match(html, /Atualizando…/);
    assert.match(html, /2026: <strong>45,0 dias<\/strong>/);
  });
});
