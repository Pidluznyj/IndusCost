import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("materialIntelligenceRecentQuotes UI", () => {
  it("seção ocupa largura total no grid 360º", () => {
    const detail = read("src/components/materials/MaterialsMarketIntelligenceDetailPage.tsx");
    assert.match(detail, /material-intelligence-recent-quotes-full-width/);
    assert.match(detail, /xl:col-span-2/);
    assert.match(detail, /MaterialIntelligenceRecentQuotesSection/);
  });

  it("tabela principal mantém colunas financeiras e fornecedor", () => {
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    assert.match(quotes, /material-intelligence-market-quotes-table/);
    assert.match(quotes, />Preço base</);
    assert.match(quotes, />Líquido</);
    assert.match(quotes, />Líquido BRL</);
    assert.match(quotes, />Fornecedor</);
    assert.match(quotes, />Câmbio</);
    assert.match(quotes, /table-fixed/);
    assert.match(quotes, /lg:overflow-x-visible/);
  });

  it("detalhes secundários ficam na linha expandida", () => {
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    assert.match(quotes, /material-market-quote-detail-/);
    assert.match(quotes, /Detalhes comerciais/);
    assert.match(quotes, /Composição de preço/);
    assert.match(quotes, /Condições de pagamento/);
    assert.match(quotes, /Frete/);
    assert.match(quotes, /Impostos/);
    assert.match(quotes, /material-market-quote-governance-/);
  });

  it("botão Registrar cotação e estado vazio permanecem", () => {
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    assert.match(quotes, /material-intelligence-register-quote-section/);
    assert.match(quotes, /material-intelligence-360-recent-quotes-empty/);
    assert.match(quotes, /Registrar cotação/);
  });

  it("ações editar e excluir com confirmação", () => {
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    const modal = read("src/components/materials/MaterialIntelligenceMarketQuoteModal.tsx");
    const form = read("src/components/materials/MaterialIntelligenceMarketQuoteForm.tsx");
    assert.match(quotes, /material-market-quote-edit-/);
    assert.match(quotes, /material-market-quote-delete-open-/);
    assert.match(quotes, /material-market-quote-delete-confirm-modal/);
    assert.match(quotes, /Tem certeza que deseja excluir esta cotação/);
    assert.match(modal, /Editar cotação manual/);
    assert.match(form, /getMaterialMarketQuoteApiPath/);
    assert.match(form, /method: "PATCH"/);
    assert.match(form, /Salvar alterações/);
  });

  it("rotas PATCH e DELETE no backend", () => {
    const routes = read("src/lib/materialMarketAuditRoutes.ts");
    assert.match(routes, /app\.patch\(/);
    assert.match(routes, /app\.delete\(/);
    assert.match(routes, /status: "CANCELLED"/);
    assert.match(routes, /guardMaterialMarketQuoteEdit/);
    assert.match(routes, /guardMaterialMarketQuoteDelete/);
  });

  it("contador de cotações e dados financeiros sem hardcode", () => {
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    assert.match(quotes, /material-intelligence-recent-quotes-count/);
    assert.match(quotes, /formatCurrency\(quote\.netPriceBrl/);
    assert.match(quotes, /quotes\.map\(\(quote\)/);
    assert.doesNotMatch(quotes, /netPrice:\s*12\.5/);
  });

  it("payload vazio não quebra renderização", () => {
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    assert.match(quotes, /quotes\.length === 0/);
    assert.match(quotes, /loading \?/);
  });
});
