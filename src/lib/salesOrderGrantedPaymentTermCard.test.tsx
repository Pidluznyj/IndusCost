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
  return { ...buildEmptySalesOrderGrantedPaymentTermSummary(12), ...overrides };
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

  it("FULL mostra dias, cobertura do valor vendido e a metodologia (emissão da NF-e → vencimento)", () => {
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
    assert.match(card, /Cobertura: 96,4% do valor vendido/);
    assert.match(card, /emissão da NF-e/);
    assert.match(card, /vencimento dos títulos do Contas a Receber/);
    assert.match(card, /títulos do CR em 80,0% do valor vendido; condição comercial em 20,0%/);
    assert.match(card, /Não mede atraso/);
    assert.match(card, /data-variant="info"/);
  });

  it("PARTIAL mostra dias + cobertura parcial (warning)", () => {
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
    assert.match(card, /Cobertura parcial: 89,4%/);
    assert.match(card, /data-variant="warning"/);
    assert.match(card, /foram excluídos da média/);
  });

  it("LOW mostra Cobertura insuficiente (sem o número principal)", () => {
    const card = cardHtml(
      render({
        paymentTermSummary: summaryWith({
          available: true,
          quality: "LOW",
          weightedAverageDays: 47.84,
          coveragePercent: 54.1,
        }),
      })
    );
    assert.match(card, /data-quality="LOW"/);
    assert.match(card, /Cobertura insuficiente/);
    assert.match(card, /Cobertura: 54,1%/);
    assert.doesNotMatch(card, /47,8 dias/);
    assert.match(card, /metric-card-value--text/);
  });

  it("UNAVAILABLE mostra Indisponível + Sem títulos ou condições de pagamento suficientes", () => {
    const card = cardHtml(
      render({
        paymentTermSummary: summaryWith({ available: false, quality: "UNAVAILABLE" }),
      })
    );
    assert.match(card, /data-quality="UNAVAILABLE"/);
    assert.match(card, /Indisponível/);
    assert.match(card, /Sem títulos ou condições de pagamento suficientes/);
    assert.match(card, /data-variant="neutral"/);
  });

  it("falha do endpoint (summary null) mostra Indisponível sem derrubar os demais cards", () => {
    const html = render({ paymentTermSummary: null });
    const card = cardHtml(html);
    assert.match(card, /Indisponível/);
    assert.match(card, /Não foi possível carregar o indicador\./);
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
