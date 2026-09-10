/**
 * Contrato desta missão (fechamento do redesenho operacional do CRM):
 * Gestão por Responsável e Carteira de Clientes ganham o contrato único de
 * período Ano/Mês, comparação entre responsáveis, listas de dados já
 * computados-mas-não-exibidos.
 *
 * 10/09/2026: a Carteira de Clientes trocou a tabela operacional paginada
 * por um cartão-resumo do cliente resolvido pelos filtros (grid 50/50 com
 * os filtros), com desambiguação leve em chips quando a busca ainda é
 * ambígua. Da faixa "Resumo comercial" para baixo o cockpit passou a
 * ocupar a tela de ponta a ponta, fora da coluna do resumo. Os testes de
 * tabela/paginação foram substituídos pelos do novo contrato abaixo.
 *
 * Testes no estilo já usado pelo projeto (`crmCommercialLayout.test.ts`,
 * `crmPortfolioScopeLabels.test.ts`) — leitura estática do código-fonte —
 * porque `CrmModule.tsx` concentra o estado das 3 abas num único
 * componente sem cobertura de integração.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("Gestão por Responsável — contrato de período e comparação", () => {
  const section = read("src/components/CrmSellerDashboardSection.tsx");
  const module_ = read("src/components/CrmModule.tsx");
  const uiHelpers = read("src/components/crmSellerDashboardUi.ts");

  it("usa a barra Ano/Mês compartilhada, não mais o preset de datas antigo", () => {
    assert.match(section, /CrmPeriodFilterBar/);
    assert.doesNotMatch(section, /SELLER_PERIOD_PRESET_OPTIONS/);
    assert.doesNotMatch(uiHelpers, /SELLER_PERIOD_PRESET_OPTIONS/);
  });

  it("abre no mês vigente (tela de movimento/performance)", () => {
    assert.match(module_, /crmPeriodFilterFromSearchParams\(searchParams, "seller", "current"\)/);
  });

  it("expõe a comparação entre responsáveis só quando 'Todos os responsáveis' está selecionado", () => {
    assert.match(section, /CrmCommercialOwnerComparisonTable/);
    assert.match(section, /showOwnerComparison/);
  });

  it("o card 'Clientes sem compra' desliga quando o filtro de vendedor Nomus está ativo", () => {
    // Achado da revisão adversarial: customerCount (carteira inteira) e
    // uniqueCustomersCount (clientes com pedido, já filtrados pelo vendedor
    // Nomus) deixam de falar do mesmo universo quando esse filtro auxiliar
    // está ativo — o card superestimaria "sem compra".
    assert.match(module_, /selectedOrderSellerKey === SELLER_KEY_ALL/);
  });
});

describe("Carteira de Clientes — contrato de período e resumo do cliente", () => {
  const section = read("src/components/crm/CrmCustomerPortfolioSection.tsx");
  const finder = read("src/components/crm/CrmCustomerPortfolioFinder.tsx");
  const cockpit = read("src/components/crm/CrmCustomerAccountCockpit.tsx");
  const module_ = read("src/components/CrmModule.tsx");

  it("ganha a barra Ano/Mês (não existia nenhum seletor de período antes)", () => {
    assert.match(section, /CrmPeriodFilterBar/);
    assert.match(section, /testIdPrefix="crm-portfolio"/);
  });

  it("abre com 'Ano inteiro' (tela de carteira/relacionamento)", () => {
    assert.match(module_, /crmPeriodFilterFromSearchParams\(searchParams, "portfolio", "all"\)/);
  });

  it("avisa que o período filtra o resumo comercial, não os totais de cadastro", () => {
    assert.match(section, /O período filtra os pedidos\/venda do resumo comercial/);
  });

  it("o grid da carteira não lista clientes — vira o resumo do cliente resolvido pelos filtros", () => {
    // Missão de redesign (10/09/2026): a tabela operacional de linhas foi
    // substituída por um cartão-resumo único, com desambiguação leve (chips)
    // só quando a busca ainda é ambígua. Nunca mais uma tabela de dados aqui.
    assert.match(section, /CrmCustomerPortfolioFinder/);
    assert.doesNotMatch(section, /CrmCustomerPortfolioTable/);
    assert.match(section, /xl:grid-cols-2/);
  });

  it("resolve para 1 cliente automaticamente e mostra o cartão de identidade", () => {
    assert.match(finder, /customers\.length === 1/);
    assert.match(finder, /CrmCustomerIdentityCard/);
  });

  it("2+ resultados viram chips clicáveis, nunca uma tabela", () => {
    assert.doesNotMatch(finder, /<table/);
    assert.match(finder, /onSelectCustomer\(c\.id\)/);
  });

  it("'Trocar cliente' limpa a seleção e os filtros para uma nova busca", () => {
    assert.match(cockpit, /onChangeCustomer/);
    assert.match(module_, /handleChangeCrmPortfolioCustomer/);
    assert.match(module_, /setSelectedId\(null\)/);
  });

  it("cada linha tem ação explícita para o Cliente 360", () => {
    assert.match(cockpit, /Inteligência/);
    assert.match(module_, /buildCustomerIntelligencePath/);
  });

  it("toda mudança de filtro (busca, chip, responsável, período, limpar) zera a paginação", () => {
    const handlers = [
      "handleSearch",
      "applyCustomerFilter",
      "handlePortfolioSellerChange",
      "handlePortfolioPeriodChange",
      "handleClearPortfolioSearch",
      "handleClearPortfolioFilters",
    ];
    for (const name of handlers) {
      const start = module_.indexOf(`const ${name} =`);
      assert.ok(start > 0, `handler não encontrado: ${name}`);
      const end = module_.indexOf("};", start);
      const body = module_.slice(start, end);
      assert.match(body, /setPortfolioOffset\(0\)/, `${name} não zera portfolioOffset`);
    }
  });
});

describe("Invariantes da V2 preservados (não regredir)", () => {
  const customersList = read("src/lib/crmCustomersList.ts");
  const customersListTypes = read("src/lib/crmCustomersListTypes.ts");
  const qualityTotals = read("src/lib/crmCustomersListQualityTotals.ts");
  const dashboardBasic = read("src/lib/crmDashboardBasicService.ts");
  const cockpit = read("src/components/crm/CrmCustomerAccountCockpit.tsx");
  const section = read("src/components/crm/CrmCustomerPortfolioSection.tsx");

  it("crmCustomersList.ts e crmCustomersListTypes.ts não foram tocados por esta missão", () => {
    // O motor de totais (universo via customer.count/agregação, $transaction,
    // divergência reusando ownerDiffersFromOrderSellers) é da V2 — esta
    // missão só consome os campos, nunca reimplementa o cálculo.
    assert.doesNotMatch(customersList, /customers\.filter\(\(c\) => !c\.hasCommercialOwner\)/);
    assert.match(customersList, /prisma\.\$transaction\(\[/);
    assert.match(customersList, /ownerDiffersFromOrderSellers\(owners\.get\(id\), enrichment\)/);
  });

  it("totalCustomersInScope e qualityTotalsTruncated continuam vindos do universo, não da página", () => {
    assert.match(customersListTypes, /totalCustomersInScope: number/);
    assert.match(customersListTypes, /qualityTotalsTruncated: boolean/);
    assert.match(qualityTotals, /prismaClient\.customer\.count/);
  });

  it("dashboard/basic continua fail-closed pelo Responsável Comercial, não pelo vendedor Nomus", () => {
    assert.doesNotMatch(dashboardBasic, /buildCrmSellerCustomerExistsSql/);
    assert.match(dashboardBasic, /fetchCrmManualOwnerCustomerIds/);
  });

  it("os rótulos 'Na lista:' do cockpit (V2) continuam intactos", () => {
    assert.match(cockpit, /Na lista: carteira aberta/);
    assert.match(cockpit, /Na lista: follow-up atrasado/);
    assert.match(cockpit, /Na lista: sem contato/);
  });

  it("a faixa de auditoria da Carteira (V2) continua expondo o total do universo e o aviso de truncamento", () => {
    assert.match(section, /totals\.totalCustomersInScope/);
    assert.match(section, /qualityTotalsTruncated/);
    assert.match(section, /data-testid="crm-portfolio-truncated-warning"/);
    assert.match(section, /listIsWholeScope/);
  });
});

describe("Cliente 360 — não duplicado", () => {
  it("o cartão de resumo da Carteira aponta para o Cliente 360 canônico existente, não cria um novo", () => {
    const module_ = read("src/components/CrmModule.tsx");
    const cockpit = read("src/components/crm/CrmCustomerAccountCockpit.tsx");
    assert.match(module_, /from "@\/src\/lib\/customerIntelligenceNavigation"/);
    assert.doesNotMatch(cockpit, /CustomerIntelligencePage/);
  });
});
