/**
 * Testes estruturais de performance da superfície Financeiro.
 *
 * Travam as fronteiras de code-splitting conquistadas na auditoria
 * (`docs/performance/finance-performance-audit.md`): as 9 seções do
 * `FinanceModule` e as bibliotecas pesadas acionadas por exportação não
 * podem voltar para o bundle inicial via import estático.
 *
 * Não testam número nenhum: apenas estrutura de carregamento. Nenhuma
 * semântica financeira depende deles.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FINANCE_UI_SECTIONS } from "./internalSurfaceAccess.js";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const FINANCE_MODULE = "src/components/FinanceModule.tsx";

/** Componente de página de cada seção, na ordem de `FINANCE_UI_SECTIONS`. */
const SECTION_PAGE_COMPONENTS: Record<string, string> = {
  "one-page": "FinanceOnePage",
  "cash-flow": "FinanceCashFlowPage",
  "accounts-receivable": "FinanceAccountsReceivablePage",
  "accounts-payable": "FinanceAccountsPayablePage",
  billing: "FinanceBillingPage",
  "sales-orders": "FinanceSalesOrdersPage",
  "cost-centers": "FinanceCostCentersPage",
  "executive-report": "FinanceExecutiveReportPage",
  dre: "FinanceManagerialDrePage",
};

/** Rotas internas que também não devem entrar no bundle inicial. */
const NESTED_LAZY_COMPONENTS = [
  "FinanceCostCenterDetailPage",
  "FinanceDreCostCenterMappingPage",
];

describe("financeLazyBoundaries", () => {
  it("o inventário de seções cobre exatamente as páginas mapeadas", () => {
    const inventoryIds = FINANCE_UI_SECTIONS.map((section) => section.id).sort();
    const mappedIds = Object.keys(SECTION_PAGE_COMPONENTS).sort();
    assert.deepEqual(
      inventoryIds,
      mappedIds,
      "FINANCE_UI_SECTIONS mudou: atualize SECTION_PAGE_COMPONENTS e o inventário do audit doc"
    );
  });

  it("cada seção do Financeiro é carregada sob demanda (React.lazy)", () => {
    const mod = read(FINANCE_MODULE);
    for (const component of Object.values(SECTION_PAGE_COMPONENTS)) {
      const lazyDeclaration = new RegExp(
        `const\\s+${component}\\s*=\\s*React\\.lazy\\(`
      );
      assert.match(
        mod,
        lazyDeclaration,
        `${component} deve ser declarado com React.lazy em ${FINANCE_MODULE}`
      );
    }
  });

  it("rotas aninhadas de Centros de Custo e DRE também são sob demanda", () => {
    const mod = read(FINANCE_MODULE);
    for (const component of NESTED_LAZY_COMPONENTS) {
      assert.match(mod, new RegExp(`const\\s+${component}\\s*=\\s*React\\.lazy\\(`));
    }
  });

  it("nenhuma página de seção volta a ser import estático no módulo", () => {
    const mod = read(FINANCE_MODULE);
    const staticPageImport =
      /^import\s+\{[^}]*\}\s+from\s+"@\/src\/components\/finance\/[^"]*Page(\.js)?";$/gm;
    const offenders = mod.match(staticPageImport) ?? [];
    assert.deepEqual(
      offenders,
      [],
      `imports estáticos de página reintroduzidos: ${offenders.join(", ")}`
    );
  });

  it("existe fronteira de Suspense para as seções carregadas sob demanda", () => {
    const mod = read(FINANCE_MODULE);
    assert.match(mod, /<React\.Suspense\s+fallback=\{<FinanceModuleLoadingFallback\s*\/>\}>/);
    assert.match(mod, /export function FinanceModuleLoadingFallback\(\)/);
  });

  it("gate de permissão continua antes do mount da seção (sem request indevido)", () => {
    const mod = read(FINANCE_MODULE);
    // Cada seção resolve para a página OU para o gate — nunca monta a página
    // sem grant, e portanto nenhuma request de seção negada é disparada.
    assert.match(mod, /useAuthorizedTabs/);
    assert.match(mod, /UnauthorizedAccessGate forceDenied/);
    for (const component of Object.values(SECTION_PAGE_COMPONENTS)) {
      const guarded = new RegExp(
        `<${component}\\s*/>[\\s\\S]{0,80}<UnauthorizedAccessGate forceDenied />`
      );
      assert.match(
        mod,
        guarded,
        `${component} deve ficar atrás do gate de permissão`
      );
    }
  });

  it("html2canvas é carregado apenas ao exportar imagens do Relatório Presidencial", () => {
    const capture = read("src/lib/financeExecutiveReportImageCapture.ts");
    assert.doesNotMatch(
      capture,
      /^import\s+html2canvas\s+from\s+"html2canvas";$/m,
      "html2canvas voltou a ser import estático e entra no carregamento da tela"
    );
    assert.match(capture, /await import\("html2canvas"\)/);
  });
});
