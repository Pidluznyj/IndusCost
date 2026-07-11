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
    assert.match(section, /FinanceModuleLoadingBlock/);
    assert.match(section, /FinanceModuleErrorBanner/);
    assert.match(section, /FinanceModuleEmptyState/);
    assert.doesNotMatch(section, /openReceivableValue\s*\+/);
  });

  it("página registra aba Inteligência da Carteira", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    assert.match(page, /portfolio-tab-intelligence/);
    assert.match(page, /PortfolioIntelligenceSection/);
    assert.match(page, /activeView/);
  });
});
