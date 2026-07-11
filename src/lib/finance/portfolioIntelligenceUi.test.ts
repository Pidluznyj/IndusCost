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
    assert.match(section, /handleCardClick|onCardClick/);
    assert.doesNotMatch(section, /openReceivableValue\s*\+/);
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

  it("página registra aba Inteligência da Carteira", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    assert.match(page, /portfolio-tab-intelligence/);
    assert.match(page, /PortfolioIntelligenceSection/);
    assert.match(page, /activeView/);
  });
});
