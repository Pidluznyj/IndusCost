/**
 * Trava a honestidade dos indicadores da Carteira.
 *
 * Regra: um card só pode ter rótulo absoluto ("Total de clientes no filtro")
 * se o número vier do universo contado no banco. O que é calculado sobre a
 * lista paginada precisa dizer que é da lista.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computePortfolioEmptySummary,
  type PortfolioEmptySummary,
} from "@/src/components/crm/crmCustomerPortfolioUi.js";
import type { CrmCustomerListItem } from "@/src/lib/crmCustomersListTypes.js";

function item(overrides: Partial<CrmCustomerListItem> = {}): CrmCustomerListItem {
  return {
    id: "c1",
    displayName: "Cliente",
    tradeName: null,
    taxId: "00000000000000",
    email: null,
    phone: null,
    city: null,
    state: null,
    address: null,
    lastContactAt: null,
    nextFollowUpAt: null,
    contactCount: 0,
    primarySellerResponsible: null,
    primaryExternalSellerId: null,
    commercialOwnerName: null,
    commercialOwnerExternalId: null,
    hasCommercialOwner: false,
    hasPurchaseHistory: false,
    hasOpenPortfolio: false,
    hasOverdueFollowUp: false,
    portfolioStatus: "SEM_COMPRA",
    lastOrderAt: null,
    lastOrderCode: null,
    daysSinceLastOrder: null,
    ordersCount: 0,
    historicalPurchaseValue: 0,
    periodPurchaseValue: 0,
    periodOrdersCount: 0,
    leadingProduct: null,
    lastOrderNomusSellerName: null,
    lastOrderExternalSellerId: null,
    hasOrderWithoutNomusSeller: false,
    hasOwnerSellerDivergence: false,
    ...overrides,
  } as CrmCustomerListItem;
}

describe("computePortfolioEmptySummary — é da página, por contrato", () => {
  it("conta apenas o que recebeu", () => {
    const page = [
      item({ id: "a", hasOpenPortfolio: true }),
      item({ id: "b", hasOverdueFollowUp: true }),
      item({ id: "c", lastContactAt: new Date().toISOString() }),
    ];
    const summary: PortfolioEmptySummary = computePortfolioEmptySummary(page);
    assert.equal(summary.totalListed, 3);
    assert.equal(summary.withOpenPortfolio, 1);
    assert.equal(summary.withOverdueFollowUp, 1);
    assert.equal(summary.withoutContact, 2);
  });
});

describe("Carteira — rótulos não podem passar página por universo", () => {
  const cockpit = readFileSync(
    join(process.cwd(), "src/components/crm/CrmCustomerAccountCockpit.tsx"),
    "utf8"
  );
  const section = readFileSync(
    join(process.cwd(), "src/components/crm/CrmCustomerPortfolioSection.tsx"),
    "utf8"
  );

  it("os cards page-scoped se identificam como da lista", () => {
    // Restrito ao empty state: o cockpit do cliente selecionado tem um
    // "Carteira aberta" legítimo (métrica do próprio cliente, não da página).
    const start = cockpit.indexOf("CrmCustomerPortfolioEmptyState: React.FC");
    const end = cockpit.indexOf("export type CrmCustomerAccountCockpitProps");
    assert.ok(start > 0 && end > start, "bloco do empty state não localizado");
    const emptyState = cockpit.slice(start, end);

    for (const label of [
      "Na lista: carteira aberta",
      "Na lista: follow-up atrasado",
      "Na lista: sem contato",
    ]) {
      assert.ok(emptyState.includes(label), `rótulo ausente: ${label}`);
    }
    // Rótulos absolutos não podem voltar nesses quatro cards.
    assert.doesNotMatch(emptyState, /label="Carteira aberta"/);
    assert.doesNotMatch(emptyState, /label="Follow-up atrasado"/);
    assert.doesNotMatch(emptyState, /label="Sem contato"/);
    assert.match(emptyState, /Indicadores da lista exibida/);
  });

  it("a faixa de auditoria expõe o total do universo do filtro", () => {
    assert.match(section, /Total de clientes no filtro/);
    assert.match(section, /totals\.totalCustomersInScope/);
  });

  it("avisa quando a agregação foi truncada em vez de subestimar", () => {
    assert.match(section, /qualityTotalsTruncated/);
    assert.match(section, /crm-portfolio-truncated-warning/);
  });

  it("não afirma 'sem pedidos no período' olhando só a página", () => {
    // A afirmação exige que a página seja o universo inteiro.
    assert.match(section, /listIsWholeScope/);
    const idx = section.indexOf("customersWithoutPeriodOrders");
    const block = section.slice(idx, idx + 260);
    assert.match(block, /listIsWholeScope/);
  });
});
