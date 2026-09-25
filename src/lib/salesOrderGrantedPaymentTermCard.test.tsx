/**
 * Card "Prazo médio de recebimento" — Visão Geral da listagem de Pedidos de Venda.
 * Render estático real do componente (loader vazio para `.css`, como landingPage.test).
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GRANTED_PAYMENT_TERM_CARD_LABEL,
  GRANTED_PAYMENT_TERM_CARD_TEST_ID,
  buildEmptySalesOrderGrantedPaymentTermSummary,
  type SalesOrderGrantedPaymentTermSummary,
} from "./salesOrderGrantedPaymentTerm.js";
import type { SalesOrderListSummary } from "./salesOrdersListSummary.js";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

type CardsModule = typeof import("../components/sales/SalesOrderListSummaryCards.js");
let SalesOrderListSummaryCards: CardsModule["SalesOrderListSummaryCards"];

before(async () => {
  SalesOrderListSummaryCards = (
    await import("../components/sales/SalesOrderListSummaryCards.js")
  ).SalesOrderListSummaryCards;
});

const LIST_SUMMARY: SalesOrderListSummary = {
  totalOrders: 12,
  totalNetAmount: 250_000,
  totalItems: 40,
  averageTicket: 250_000 / 12,
};

function summaryWith(
  overrides: Partial<SalesOrderGrantedPaymentTermSummary>
): SalesOrderGrantedPaymentTermSummary {
  return {
    ...buildEmptySalesOrderGrantedPaymentTermSummary(12),
    positiveSalesAmount: 250_000,
    invoicedSalesAmount: 193_500,
    invoicedSharePercent: 77.4,
    ...overrides,
  };
}

function render(props: {
  paymentTermSummary?: SalesOrderGrantedPaymentTermSummary | null;
  paymentTermSummaryLoading?: boolean;
  showMarginCard?: boolean;
  loading?: boolean;
}): string {
  return renderToStaticMarkup(
    <SalesOrderListSummaryCards
      summary={LIST_SUMMARY}
      marginSummary={null}
      paymentTermSummary={props.paymentTermSummary ?? null}
      paymentTermSummaryLoading={props.paymentTermSummaryLoading ?? false}
      showMarginCard={props.showMarginCard ?? false}
      loading={props.loading ?? false}
    />
  );
}

function cardHtml(html: string): string {
  const start = html.indexOf(`data-testid="${GRANTED_PAYMENT_TERM_CARD_TEST_ID}"`);
  assert.ok(start > 0, "card Prazo médio de recebimento não renderizado");
  const end = html.indexOf("Ticket médio", start);
  assert.ok(end > start);
  return html.slice(start, end);
}

/** Texto visível do card: sem atributos (title/aria-label do tooltip ficam de fora). */
function visibleText(card: string): string {
  return card.replace(/<[^>]*>/g, " ");
}

/** Texto do tooltip de ajuda do card (atributo title do botão de ajuda). */
function tooltipText(card: string): string {
  return [...card.matchAll(/<button[^>]*title="([^"]*)"/g)].map((m) => m[1]).join("\n");
}

describe("SalesOrderListSummaryCards — Prazo médio de recebimento", () => {
  it("overview tem Pedidos filtrados, Valor vendido, Prazo médio de recebimento e Ticket médio — sem Imposto/Custo", () => {
    const html = render({
      paymentTermSummary: summaryWith({
        available: true,
        quality: "FULL",
        weightedAverageDays: 47.84,
        coveragePercent: 96.4,
      }),
    });
    assert.equal(GRANTED_PAYMENT_TERM_CARD_LABEL, "Prazo médio de recebimento");
    const order = [
      "Pedidos filtrados",
      "Valor vendido",
      "Prazo médio de recebimento",
      "Ticket médio",
    ].map((label) => html.indexOf(label));
    assert.ok(order.every((idx) => idx >= 0), "labels ausentes");
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.doesNotMatch(html, /Imposto a pagar/);
    assert.doesNotMatch(html, /Custo estimado/);
    assert.doesNotMatch(html, /Prazo médio concedido/);
    assert.doesNotMatch(html, /sales-order-list-tax-payable-card/);
    assert.doesNotMatch(html, /sales-order-list-estimated-cost-card/);
    assert.doesNotMatch(html, /Margem comercial/);
    assert.match(html, /data-testid="sales-order-list-overview"/);
  });

  it("Margem comercial continua quando showMarginCard=true (após Ticket médio)", () => {
    const html = render({ showMarginCard: true, paymentTermSummary: null });
    assert.match(html, /Margem comercial/);
    assert.match(html, /sales-order-list-general-margin-card/);
    assert.ok(html.indexOf("Ticket médio") < html.indexOf("Margem comercial"));
    assert.ok(html.indexOf("Prazo médio de recebimento") < html.indexOf("Ticket médio"));
    assert.doesNotMatch(html, /Imposto a pagar|Custo estimado/);
  });

  it("FULL mostra dias e cobertura do faturado; participação do faturado e fonte só no tooltip", () => {
    const card = cardHtml(
      render({
        paymentTermSummary: summaryWith({
          available: true,
          quality: "FULL",
          weightedAverageDays: 47.84,
          coveragePercent: 96.4,
          coveredSalesAmount: 100,
          sources: {
            receivableTitles: { orders: 1, salesAmount: 80, salesSharePercent: 80, weightedAverageDays: 50 },
            commercialTerms: { orders: 1, salesAmount: 20, salesSharePercent: 20, weightedAverageDays: 39.2 },
          },
        }),
      })
    );
    assert.match(card, /data-quality="FULL"/);
    assert.match(card, /47,8 dias/);
    assert.match(card, /Cobertura: 96,4% do valor faturado/);
    assert.doesNotMatch(card, /footnote|metric-card-footer/, "sem linha extra no card");
    // Faturado e fonte no tooltip, nunca como texto visível do card.
    const tooltip = tooltipText(card);
    assert.match(tooltip, /^Faturado: 77,4% do valor vendido \(pedidos sem NF-e ainda não entram na média\)\./);
    assert.match(tooltip, /títulos do CR em 80,0% do valor faturado; condição comercial em 20,0%/);
    assert.match(tooltip, /emissão da NF-e/);
    assert.match(tooltip, /vencimento dos títulos do Contas a Receber/);
    assert.match(tooltip, /Não mede atraso/);
    assert.doesNotMatch(visibleText(card), /Faturado:|Fonte:/);
    assert.match(card, /data-variant="info"/);
  });

  it("PARTIAL mostra dias + cobertura parcial do faturado (warning)", () => {
    const card = cardHtml(
      render({
        paymentTermSummary: summaryWith({
          available: true,
          quality: "PARTIAL",
          weightedAverageDays: 47.84,
          coveragePercent: 89.4,
        }),
      })
    );
    assert.match(card, /data-quality="PARTIAL"/);
    assert.match(card, /47,8 dias/);
    assert.match(card, /Cobertura parcial: 89,4% do faturado/);
    assert.match(tooltipText(card), /Faturado: 77,4% do valor vendido/);
    assert.doesNotMatch(visibleText(card), /Faturado:/);
    assert.match(card, /data-variant="warning"/);
    assert.match(tooltipText(card), /foram excluídos da média/);
  });

  it("LOW mostra Cobertura insuficiente (sem o número principal) e expõe o prazo só no tooltip", () => {
    const card = cardHtml(
      render({
        paymentTermSummary: summaryWith({
          available: true,
          quality: "LOW",
          weightedAverageDays: 47.84,
          coveragePercent: 54.1,
          coveredSalesAmount: 100,
        }),
      })
    );
    assert.match(card, /data-quality="LOW"/);
    assert.match(card, /Cobertura insuficiente/);
    assert.match(card, /Cobertura: 54,1% do faturado/);
    assert.match(card, /metric-card-value--text/);
    // Número só no tooltip (title), nunca como valor principal.
    const valueStart = card.indexOf('data-testid="metric-card-value"');
    const valueEnd = card.indexOf("</p>", valueStart);
    assert.doesNotMatch(card.slice(valueStart, valueEnd), /47,8 dias/);
    assert.match(card, /Prazo calculado só sobre a parte coberta: 47,8 dias \(não confiável\)/);
  });

  it("UNAVAILABLE mostra Indisponível com o motivo (sem faturados × sem títulos)", () => {
    const noTitles = cardHtml(
      render({
        paymentTermSummary: summaryWith({
          available: false,
          quality: "UNAVAILABLE",
          weightedPopulationOrders: 3,
        }),
      })
    );
    assert.match(noTitles, /data-quality="UNAVAILABLE"/);
    assert.match(noTitles, /Indisponível/);
    assert.match(noTitles, /Sem títulos ou condições de pagamento suficientes/);
    assert.match(tooltipText(noTitles), /Faturado: 77,4% do valor vendido/);
    assert.doesNotMatch(visibleText(noTitles), /Faturado:/);
    assert.match(noTitles, /data-variant="neutral"/);

    const noInvoices = cardHtml(
      render({
        paymentTermSummary: summaryWith({
          available: false,
          quality: "UNAVAILABLE",
          weightedPopulationOrders: 0,
          invoicedSalesAmount: 0,
          invoicedSharePercent: 0,
        }),
      })
    );
    assert.match(noInvoices, /Sem pedidos faturados no filtro/);
    assert.match(tooltipText(noInvoices), /Faturado: 0,0% do valor vendido/);
  });

  it("falha do endpoint (summary null) mostra Indisponível sem rodapé e sem derrubar os demais cards", () => {
    const html = render({ paymentTermSummary: null });
    const card = cardHtml(html);
    assert.match(card, /Indisponível/);
    assert.match(card, /Não foi possível carregar o indicador\./);
    assert.doesNotMatch(card, /sales-order-list-average-payment-term-footnote/);
    assert.match(html, /Pedidos filtrados/);
    assert.match(html, /Valor vendido/);
    assert.match(html, /Ticket médio/);
  });

  it("loading do KPI mostra skeleton só no card de prazo (lista já renderizada)", () => {
    const html = render({ paymentTermSummaryLoading: true, paymentTermSummary: null });
    const card = cardHtml(html);
    assert.match(card, /data-quality="LOADING"/);
    assert.match(card, /metric-card-loading/);
    assert.doesNotMatch(card, /Indisponível/);
    assert.doesNotMatch(card, /sales-order-list-average-payment-term-footnote/);
    const before = html.slice(0, html.indexOf(`data-testid="${GRANTED_PAYMENT_TERM_CARD_TEST_ID}"`));
    assert.doesNotMatch(before, /metric-card-loading/);
  });

  it("0 dias e 100+ dias", () => {
    const zero = cardHtml(
      render({
        paymentTermSummary: summaryWith({
          available: true,
          quality: "FULL",
          weightedAverageDays: 0,
          coveragePercent: 100,
        }),
      })
    );
    assert.match(zero, /0,0 dias/);
    const long = cardHtml(
      render({
        paymentTermSummary: summaryWith({
          available: true,
          quality: "FULL",
          weightedAverageDays: 132.49,
          coveragePercent: 100,
        }),
      })
    );
    assert.match(long, /132,5 dias/);
  });
});
