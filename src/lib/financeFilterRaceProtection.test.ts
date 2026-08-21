/**
 * Proteção de corrida nos filtros do Financeiro.
 *
 * Cenário protegido: o usuário aplica julho e imediatamente agosto. Se a
 * resposta de julho chegar depois, ela NÃO pode sobrescrever o estado do
 * período agora selecionado — a tela exibiria números de um período diferente
 * do filtro visível.
 *
 * O contrato é: toda página de seção que carrega dados a partir dos filtros
 * aplicados aborta a requisição anterior antes de disparar a próxima, ignora
 * a resposta abortada e não trata `AbortError` como erro de tela.
 *
 * Teste estrutural — não altera nem verifica valor financeiro nenhum.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

/** Páginas de seção do Financeiro que carregam dados por filtro aplicado. */
const FILTERED_SECTION_PAGES = [
  "src/components/finance/FinanceCashFlowPage.tsx",
  "src/components/finance/FinanceAccountsReceivablePage.tsx",
  "src/components/finance/FinanceAccountsPayablePage.tsx",
  "src/components/finance/FinanceBillingPage.tsx",
  "src/components/finance/FinanceSalesOrdersPage.tsx",
  "src/components/finance/FinanceExecutiveReportPage.tsx",
  "src/components/finance/FinanceManagerialDrePage.tsx",
  "src/components/finance/cost-centers/FinanceCostCentersPage.tsx",
];

describe("financeFilterRaceProtection", () => {
  for (const page of FILTERED_SECTION_PAGES) {
    const name = page.split("/").pop() ?? page;

    describe(name, () => {
      it("aborta a requisição anterior antes de disparar a próxima", () => {
        const src = read(page);
        assert.match(
          src,
          /AbortRef\.current\?\.abort\(\)|abortRef\.current\?\.abort\(\)/,
          `${name} deve abortar a requisição em voo antes de recarregar`
        );
        assert.match(
          src,
          /new AbortController\(\)/,
          `${name} deve criar um AbortController por carregamento`
        );
      });

      it("propaga o signal para o fetch e descarta a resposta abortada", () => {
        const src = read(page);
        assert.match(
          src,
          /signal: \w+\.signal/,
          `${name} deve enviar o signal do controller na requisição`
        );
        assert.match(
          src,
          /\w+\.signal\.aborted/,
          `${name} deve verificar signal.aborted antes de aplicar o resultado`
        );
      });

      it("não exibe AbortError como falha de carregamento", () => {
        const src = read(page);
        assert.match(
          src,
          /name === "AbortError"/,
          `${name} deve ignorar AbortError em vez de mostrar erro ao usuário`
        );
      });
    });
  }

  it("Relatório Presidencial e DRE usam o mesmo contrato de abort das demais seções", () => {
    // Regressão específica: estas duas seções carregavam sem AbortController e
    // uma resposta antiga podia sobrescrever o período recém-selecionado.
    for (const page of [
      "src/components/finance/FinanceExecutiveReportPage.tsx",
      "src/components/finance/FinanceManagerialDrePage.tsx",
    ]) {
      const src = read(page);
      assert.match(src, /reportAbortRef\.current\?\.abort\(\)/);
      assert.match(src, /reportAbortRef = useRef<AbortController \| null>\(null\)/);
    }
  });
});
