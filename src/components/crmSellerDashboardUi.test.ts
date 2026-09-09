/**
 * `buildSellerKpiCards` — cobre especificamente o card "Clientes sem
 * compra", adicionado nesta missão. Achado da revisão adversarial: o
 * cálculo (carteira do responsável − clientes com pedido) só é seguro
 * quando NENHUM filtro auxiliar de vendedor Nomus está ativo — do
 * contrário os dois números deixam de falar do mesmo universo e o card
 * superestima "sem compra". O chamador (`CrmModule.tsx`) resolve essa
 * condição e passa `undefined` quando o filtro de vendedor Nomus está
 * ativo; aqui testamos só a função pura.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSellerKpiCards } from "@/src/components/crmSellerDashboardUi";
import type { SellerDashboardSummary } from "@/src/components/crmSellerDashboardTypes";

const fmt = (v: number | null | undefined) => String(v ?? 0);
const fmtCurrency = (v: unknown) => String(v ?? 0);

function summary(overrides: Partial<SellerDashboardSummary> = {}): SellerDashboardSummary {
  return {
    ordersCount: 10,
    ordersValue: 1000,
    invoicedOrdersCount: 5,
    invoicedOrdersValue: 500,
    openOrdersCount: 5,
    openOrdersValue: 500,
    cancelledOrdersCount: 0,
    uniqueCustomersCount: 7,
    ticketAverage: 100,
    topProduct: null,
    ordersWithoutLinkedProposalCount: 0,
    ...overrides,
  };
}

test("'Clientes sem compra' ausente quando walletCustomerCount não é passado (visão 'Todos')", () => {
  const cards = buildSellerKpiCards(summary(), fmt, fmtCurrency, undefined);
  assert.equal(cards.some((c) => c.label === "Clientes sem compra"), false);
});

test("'Clientes sem compra' ausente quando walletCustomerCount é 0", () => {
  const cards = buildSellerKpiCards(summary(), fmt, fmtCurrency, 0);
  assert.equal(cards.some((c) => c.label === "Clientes sem compra"), false);
});

test("'Clientes sem compra' presente e correto quando um responsável específico está selecionado", () => {
  const cards = buildSellerKpiCards(summary({ uniqueCustomersCount: 7 }), fmt, fmtCurrency, 20);
  const card = cards.find((c) => c.label === "Clientes sem compra");
  assert.ok(card, "card deveria existir");
  assert.equal(card!.value, "13"); // 20 - 7
});

test("'Clientes sem compra' nunca fica negativo (uniqueCustomersCount > walletCustomerCount)", () => {
  const cards = buildSellerKpiCards(summary({ uniqueCustomersCount: 25 }), fmt, fmtCurrency, 20);
  const card = cards.find((c) => c.label === "Clientes sem compra");
  assert.equal(card!.value, "0");
});

test("todos os 11 cards originais continuam presentes independente do novo card", () => {
  const withWallet = buildSellerKpiCards(summary(), fmt, fmtCurrency, 10);
  const withoutWallet = buildSellerKpiCards(summary(), fmt, fmtCurrency, undefined);
  const originalLabels = [
    "Pedidos emitidos",
    "Valor de pedidos",
    "Carteira aberta",
    "Valor em carteira",
    "Pedidos faturados",
    "Valor faturado",
    "Pedidos cancelados",
    "Ticket médio",
    "Clientes com pedido",
    "Produto líder",
    "Pedidos sem proposta vinculada",
  ];
  for (const label of originalLabels) {
    assert.ok(withWallet.some((c) => c.label === label), `faltando (com carteira): ${label}`);
    assert.ok(withoutWallet.some((c) => c.label === label), `faltando (sem carteira): ${label}`);
  }
  assert.equal(withWallet.length, 12);
  assert.equal(withoutWallet.length, 11);
});
