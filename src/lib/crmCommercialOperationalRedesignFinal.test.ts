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
 * 30/09/2026: a pedido do usuário, a Carteira voltou a listar os clientes do
 * filtro num grid (dados de cadastro + último contato, follow-up e última
 * compra, com ações na linha) e o detalhe do cliente — identidade, resumo
 * comercial, relacionamento, agenda, histórico, próximas ações e linha do
 * tempo — passou para um modal aberto por "Ver cliente". O cartão-resumo único
 * e os chips de desambiguação saíram.
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
  const table = read("src/components/crm/CrmCustomerPortfolioTable.tsx");
  const modal = read("src/components/crm/CrmCustomerAccountModal.tsx");
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

  it("o grid lista os clientes do filtro numa tabela, na largura toda, abaixo dos filtros", () => {
    assert.match(section, /<CrmCustomerPortfolioTable/);
    assert.doesNotMatch(section, /CrmCustomerPortfolioFinder/);
    assert.doesNotMatch(section, /xl:grid-cols-2/);
    assert.match(table, /<table/);
    assert.ok(section.indexOf('aria-label="Filtros da carteira"') < section.indexOf("<CrmCustomerPortfolioTable"));
  });

  it("o grid traz cadastro e CRM: último contato, próximo follow-up e última compra", () => {
    for (const column of ["Cliente", "Cidade / UF", "Responsável", "Situação", "Último contato", "Próximo follow-up", "Última compra", "Compras no período", "Ações"]) {
      assert.ok(table.includes(`>${column}</th>`), `coluna ausente: ${column}`);
    }
    assert.match(table, /customer\.lastContactAt/);
    assert.match(table, /customer\.nextFollowUpAt/);
    assert.match(table, /customer\.lastOrderAt/);
  });

  it("cada linha tem as ações do dia a dia: registrar contato, ver cliente e Cliente 360", () => {
    assert.match(table, /Registrar contato/);
    assert.match(table, /Ver cliente/);
    assert.match(table, /intelligencePathFor\(customer\.id\)/);
    assert.match(module_, /buildCustomerIntelligencePath/);
    // As ações não disparam o clique da linha.
    assert.match(table, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
    // Registrar contato pela linha usa o mesmo modal e recarrega a Carteira, não os Relatórios.
    assert.match(module_, /openContactFromPortfolio/);
    assert.match(module_, /contactFromPortfolioRef/);
  });

  it("'Ver cliente' abre o detalhe num modal: identidade, cockpit e abas do cliente", () => {
    assert.match(section, /<CrmCustomerAccountModal/);
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-modal="true"/);
    const open = section.indexOf("<CrmCustomerAccountModal");
    const close = section.indexOf("</CrmCustomerAccountModal>");
    assert.ok(open > 0 && close > open);
    const body = section.slice(open, close);
    assert.match(body, /<CrmCustomerIdentityCard/);
    assert.match(body, /<CrmCustomerAccountCockpit/);
    assert.match(body, /\{children\}/);
    // Nada do cliente fica solto na página, fora do modal.
    assert.equal(section.split("<CrmCustomerAccountCockpit").length - 1, 1);
    assert.match(cockpit, /Inteligência/);
  });

  it("uma busca que acha um único cliente não abre o modal sozinha", () => {
    assert.doesNotMatch(section, /customers\.length === 1/);
    assert.doesNotMatch(table, /customers\.length === 1/);
  });

  it("fechar o modal só desfaz a seleção: filtros, busca e página ficam como estavam", () => {
    const start = module_.indexOf("const handleCloseCrmPortfolioCustomer =");
    assert.ok(start > 0);
    const body = module_.slice(start, module_.indexOf("}, []);", start));
    assert.match(body, /setSelectedId\(null\)/);
    assert.doesNotMatch(body, /handleClearPortfolioFilters|setPortfolioOffset/);
    assert.doesNotMatch(module_, /handleChangeCrmPortfolioCustomer/);
  });

  it("o grid pagina o universo do filtro com a mesma busca e os mesmos filtros", () => {
    assert.match(module_, /hasMore: data\?\.pagination\?\.hasMore === true/);
    const start = module_.indexOf("const handlePortfolioPageChange =");
    assert.ok(start > 0);
    const body = module_.slice(start, module_.indexOf("};", start));
    assert.match(body, /loadCrmCustomers\(searchApplied, crmCustomerFilter, offset, portfolioSellerKey, portfolioPeriod\)/);
    assert.match(table, /Anterior/);
    assert.match(table, /Próxima/);
    assert.match(table, /disabled=\{!hasMore \|\| loading\}/);
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

  it("os rótulos 'Na lista:' (V2) continuam intactos, agora no cabeçalho do grid", () => {
    const table = read("src/components/crm/CrmCustomerPortfolioTable.tsx");
    assert.match(table, /Na lista: carteira aberta/);
    assert.match(table, /Na lista: follow-up atrasado/);
    assert.match(table, /Na lista: sem contato/);
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

describe("Detalhe do Pedido no cockpit — mesmo modal de Pedidos de venda", () => {
  const cockpit = read("src/components/crm/CrmCustomerAccountCockpit.tsx");

  it("carrega o SalesOrderDetailDialog sob demanda (React.lazy), não estático", () => {
    assert.doesNotMatch(
      cockpit,
      /import\s*\{[^}]*SalesOrderDetailDialog[^}]*\}\s*from\s*["'][^"']*SalesOrderDetailDialog["']/
    );
    assert.match(
      cockpit,
      /React\.lazy\(\(\) =>\s*\n\s*import\("@\/src\/components\/sales\/SalesOrderDetailDialog"\)/
    );
  });

  it("clicar num pedido de 'Últimos pedidos' abre o modal sem navegar — mesma tela por trás", () => {
    assert.match(cockpit, /onClick=\{\(\) => openOrderDetail\(o\.id, o\.orderCode\)\}/);
    assert.match(cockpit, /<SalesOrderDetailDialog\s*\n\s*open\s*\n\s*salesOrderId=\{detailOrderId\}/);
    assert.match(cockpit, /onClose=\{closeOrderDetail\}/);
  });
});
