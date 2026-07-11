import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("portfolio intelligence UI", () => {
  it("seção e cards não importam Prisma / server", () => {
    const files = [
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceCards.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceHelpPopover.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceAccordions.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrdersGrid.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrderDrawer.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceFiltersBar.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSellerKpis.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from ["'].*prisma/);
      assert.doesNotMatch(src, /portfolioMaturityAnalytics\.server/);
    }
  });

  it("cards consomem explanation da API e têm fallback", () => {
    const cards = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceCards.tsx"
    );
    const help = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceHelpPopover.tsx"
    );
    assert.match(cards, /PortfolioIntelligenceHelpPopover/);
    assert.match(cards, /CARD_ORDER/);
    assert.match(cards, /formatFinanceCurrencyCompact|formatFinancePercent/);
    assert.match(cards, /onCardClick/);
    assert.match(help, /O que significa/);
    assert.match(help, /Como calculamos/);
    assert.match(help, /FALLBACK|Informação não disponível/);
  });

  it("seção chama endpoint intelligence e trata loading/erro", () => {
    const section = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx"
    );
    assert.match(section, /\/api\/finance\/portfolio-reconciliation\/intelligence/);
    assert.match(section, /buildPortfolioIntelligenceListQuery/);
    assert.match(section, /pageSize:\s*200/);
    assert.match(section, /FinanceModuleLoadingBlock/);
    assert.match(section, /FinanceModuleErrorBanner/);
    assert.match(section, /FinanceModuleEmptyState/);
    assert.match(section, /PortfolioIntelligenceAccordions/);
    assert.match(section, /PortfolioIntelligenceOrderDrawer/);
    assert.match(section, /PortfolioIntelligenceFiltersBar/);
    assert.match(section, /portfolioIntelligenceUiFiltersToQueryArgs/);
    assert.match(section, /handleCardClick|onCardClick/);
    assert.doesNotMatch(section, /openReceivableValue\s*\+/);
  });

  it("barra de filtros cobre eixo de data, atalhos e limpar", () => {
    const bar = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceFiltersBar.tsx"
    );
    assert.match(bar, /FinanceBiFilterPanel/);
    assert.match(bar, /dateAxis|Eixo de data/);
    assert.match(bar, /PORTFOLIO_INTELLIGENCE_PERIOD_PRESETS/);
    assert.match(bar, /onlyWithoutNfe/);
    assert.match(bar, /Limpar|onClear/);
    assert.match(bar, /PORTFOLIO_INTELLIGENCE_DATE_AXIS_HELP/);
    assert.match(bar, /Pedidos por emissão|vencimento/);
  });

  it("sanfonas e grid de drilldown estão ligados", () => {
    const accordions = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceAccordions.tsx"
    );
    const grid = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrdersGrid.tsx"
    );
    assert.match(accordions, /INTELLIGENCE_ACCORDION_KEYS/);
    assert.match(accordions, /PortfolioIntelligenceOrdersGrid/);
    assert.match(accordions, /DIVERGENCIA_TECNICA/);
    assert.match(accordions, /Nenhum pedido|portfolio-intelligence-grid-empty|rowsForIntelligenceAccordion/);
    assert.match(grid, /Nenhum pedido neste status/);
    assert.match(grid, /CONFIDENCE_LABEL|Alta|Média|Baixa|Muito baixa/);
    assert.match(grid, /onOpenOrder/);
  });

  it("drawer de detalhe tem 7 abas e estados vazios sem inventar dados", () => {
    const drawer = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrderDrawer.tsx"
    );
    assert.match(
      drawer,
      /\/api\/finance\/portfolio-reconciliation\/intelligence\/orders\//
    );
    assert.match(drawer, /Resumo executivo/);
    assert.match(drawer, /Pedido de venda/);
    assert.match(drawer, /Itens/);
    assert.match(drawer, /NF \/ Documento de saída/);
    assert.match(drawer, /Contas a Receber/);
    assert.match(drawer, /Condição de pagamento/);
    assert.match(drawer, /Histórico \/ linha do tempo/);
    assert.match(
      drawer,
      /Não encontramos NF ou documento de saída vinculado a este pedido/
    );
    assert.match(drawer, /Nenhum Contas a Receber encontrado para este pedido/);
    assert.match(
      drawer,
      /Condição de pagamento não disponível na importação atual|Informação não disponível na importação atual/
    );
    assert.match(drawer, /formatFinanceCurrency/);
    assert.match(drawer, /formatFinanceDate/);
    assert.match(drawer, /buildFinanceTabLoadError/);
    assert.doesNotMatch(drawer, /stack|e\.stack|JSON\.stringify\(e/);
    assert.doesNotMatch(drawer, /@prisma\/client/);
  });

  it("KPIs por vendedor usam sellerKpis e não importam comissões", () => {
    const section = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx"
    );
    const table = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSellerKpis.tsx"
    );
    assert.match(section, /PortfolioIntelligenceSellerKpis/);
    assert.match(section, /handleSelectSeller|onSelectSeller/);
    assert.match(table, /Qualidade da Carteira por Vendedor/);
    assert.match(table, /SELLER_KPI_EXPLANATIONS/);
    assert.doesNotMatch(table, /from ["']@\/src\/lib\/commissions/);
    assert.doesNotMatch(section, /from ["']@\/src\/lib\/commissions/);
    assert.doesNotMatch(table, /commissionReceipt|commissionMaterialization/i);
  });

  it("página registra aba Inteligência da Carteira", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    assert.match(page, /portfolio-tab-intelligence/);
    assert.match(page, /PortfolioIntelligenceSection/);
    assert.match(page, /activeView/);
  });
});
