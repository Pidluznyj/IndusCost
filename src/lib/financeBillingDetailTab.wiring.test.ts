/**
 * Financeiro > Faturamento > Detalhamento — contrato de tela e de rota.
 *
 * Testes estáticos de fonte (mesma convenção de `financeBillingUx`,
 * `outputDocumentsRoutes` e `CommissionsOrderProvisionPage.wiring`): o repo não
 * tem jsdom/testing-library, e o componente importa CSS — então o que se trava
 * aqui é a fiação: preservação do conteúdo atual, filtros, paginação, estados e
 * reuso do modal canônico de Pedido de Venda.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FINANCE_BILLING_ANALYSIS_TABS,
  FINANCE_BILLING_PAGE_VIEWS,
} from "./financeBillingDashboardTypes.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "./financeModulesAccess.js";
import { FINANCE_BILLING_DETAIL_ORDERS_ENDPOINT } from "./finance/financeBillingDetailOrders.js";
import {
  extractFinanceMainContentExcludingAuditDrawer,
  financeExecutiveHeaderIncludes,
} from "./financePageSourceAudit.js";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const PAGE_PATH = "src/components/finance/FinanceBillingPage.tsx";
const TAB_PATH = "src/components/finance/billing/FinanceBillingDetailTab.tsx";
const ROUTES_PATH = "src/lib/financeBillingRoutes.ts";

describe("Faturamento > Detalhamento — subabas da página", () => {
  it("a página passa a ter Visão Geral + Detalhamento", () => {
    assert.deepEqual(
      FINANCE_BILLING_PAGE_VIEWS.map((v) => v.id),
      ["overview", "detail"]
    );
    assert.equal(FINANCE_BILLING_PAGE_VIEWS[1]!.label, "Detalhamento");
  });

  it("usa o mesmo componente de subabas de Contas a Receber (FinanceDetailTabs)", () => {
    const page = read(PAGE_PATH);
    assert.match(
      page,
      /<FinanceDetailTabs\s+tabs=\{FINANCE_BILLING_PAGE_VIEWS\}/
    );
    assert.match(page, /activeId=\{pageView\}/);
    assert.match(page, /onChange=\{setPageView\}/);
  });

  it("as abas de análise gráfica atuais continuam intactas", () => {
    assert.deepEqual(
      FINANCE_BILLING_ANALYSIS_TABS.map((t) => t.id),
      ["overview", "accumulated", "monthly", "projection", "forecast"]
    );
    const page = read(PAGE_PATH);
    assert.match(page, /tabs=\{FINANCE_BILLING_ANALYSIS_TABS\}/);
  });

  it("conteúdo executivo atual é preservado (só passa a ser condicional)", () => {
    const page = read(PAGE_PATH);
    const main = extractFinanceMainContentExcludingAuditDrawer(page);
    // Painel de filtros executivo, KPIs, horizonte, gráficos e centro de ações.
    assert.ok(main.includes("<FinanceBiFilterPanel"));
    assert.ok(main.includes("<ExecutiveSummarySection"));
    assert.ok(main.includes("<FinanceHorizonSection"));
    assert.ok(main.includes("<FinanceBillingActionCenter"));
    assert.ok(main.includes("<FinanceBillingCustomersTab"));
    assert.ok(main.includes("FinanceFilterScopeBanner"));
    // A subaba nova convive com o conteúdo atual dentro do mesmo <main>.
    assert.ok(main.includes("pageView === \"detail\""));
    assert.ok(main.includes("<FinanceBillingDetailTab />"));
  });

  it("header, exportações e auditoria da tela seguem no lugar", () => {
    const page = read(PAGE_PATH);
    assert.ok(financeExecutiveHeaderIncludes(page, 'title="Faturamento"'));
    assert.ok(page.includes('label: "Exportar composição"'));
    assert.ok(page.includes('label: "Exportar CSV NF-e"'));
    assert.ok(page.includes("FinanceDataAuditDrawer"));
    assert.ok(page.includes("FinanceBillingNfeSyncPanel"));
  });

  it("a subaba entra por lazy import (não engorda o chunk inicial)", () => {
    const page = read(PAGE_PATH);
    assert.match(
      page,
      /React\.lazy\(\(\) =>\s*\n\s*import\("@\/src\/components\/finance\/billing\/FinanceBillingDetailTab"\)/
    );
    assert.match(page, /<React\.Suspense fallback=\{<FinanceApLoadingBlock/);
  });

  it("não cria rota nova nem segunda estratégia de navegação", () => {
    const page = read(PAGE_PATH);
    assert.doesNotMatch(page, /useNavigate|useSearchParams|<Route\b/);
    const financeModule = read("src/components/FinanceModule.tsx");
    assert.doesNotMatch(financeModule, /billing\/detail|Detalhamento/);
  });
});

describe("Faturamento > Detalhamento — filtros da subaba", () => {
  const tab = read(TAB_PATH);

  it("expõe exatamente os 6 filtros pedidos", () => {
    for (const testId of [
      "finance-billing-detail-filter-year",
      "finance-billing-detail-filter-month",
      "finance-billing-detail-filter-sales-order",
      "finance-billing-detail-filter-output-document",
      "finance-billing-detail-filter-invoice",
    ]) {
      assert.ok(tab.includes(testId), `filtro ausente: ${testId}`);
    }
    assert.ok(tab.includes("<CustomerAutocompleteFilter"));
  });

  it("cliente usa o autocomplete remoto existente (sem carregar a base no browser)", () => {
    assert.ok(tab.includes("CustomerAutocompleteFilter"));
    assert.ok(tab.includes("financePersonFieldsFromSelection"));
    assert.doesNotMatch(tab, /\/api\/customers\?/);
  });

  it("reaproveita os selects de Ano e Mês já usados em Faturamento", () => {
    assert.ok(tab.includes("buildFinanceBillingYearOptions"));
    assert.ok(tab.includes("FINANCE_BILLING_MONTH_OPTIONS"));
  });

  it("padrão draft × applied: consulta só dispara no botão Aplicar", () => {
    assert.ok(tab.includes("draftFilters"));
    assert.ok(tab.includes("appliedFilters"));
    assert.ok(tab.includes("finance-billing-detail-apply-filters"));
    assert.ok(tab.includes("setAppliedFilters(normalized)"));
    // A query memoizada depende de appliedFilters, nunca do draft.
    assert.match(
      tab,
      /buildFinanceBillingDetailOrdersQuery\(appliedFilters,[\s\S]*?\[appliedFilters, page, pageSize, sortBy, sortDir\]/
    );
    assert.doesNotMatch(
      tab,
      /buildFinanceBillingDetailOrdersQuery\(draftFilters/
    );
  });

  it("limpar filtros volta ao default (mês corrente) e à primeira página", () => {
    assert.ok(tab.includes("Limpar filtros"));
    assert.match(
      tab,
      /handleClearFilters[\s\S]*?createDefaultFinanceBillingDetailFilters\(\)[\s\S]*?setPage\(1\)/
    );
  });

  it("aplicar filtros reseta a paginação", () => {
    assert.match(tab, /handleApplyFilters[\s\S]*?setPage\(1\)/);
  });
});

describe("Faturamento > Detalhamento — grid, estados e paginação", () => {
  const tab = read(TAB_PATH);

  it("colunas do grid: faturamento, pedido, cliente, documento(s), NF(s)", () => {
    const thead = tab.slice(tab.indexOf("<thead>"), tab.indexOf("</thead>"));
    assert.ok(thead.includes("Faturamento"));
    assert.ok(thead.includes("Pedido de venda"));
    assert.ok(thead.includes("Cliente"));
    assert.ok(thead.includes("Documento(s) de saída"));
    assert.ok(thead.includes("NF(s)"));
  });

  it("não inventa colunas financeiras no grid", () => {
    const table = tab.slice(tab.indexOf("<thead>"), tab.indexOf("</table>"));
    for (const forbidden of [
      "Valor",
      "Margem",
      "Comissão",
      "Saldo",
      "Recebido",
    ]) {
      assert.equal(
        table.includes(forbidden),
        false,
        `coluna financeira indevida: ${forbidden}`
      );
    }
  });

  it("reaproveita o padrão visual do grid de Títulos (Contas a Receber)", () => {
    assert.ok(
      tab.includes(
        'import "@/src/components/finance/finance-ar-analytical-titles-table.css"'
      )
    );
    assert.ok(tab.includes("finance-ar-titles-list-table"));
    assert.ok(tab.includes("finance-ar-titles-list-section"));
  });

  it("estados de loading, vazio e erro usam os componentes compartilhados", () => {
    assert.ok(tab.includes("<FinanceArLoadingBlock"));
    assert.ok(tab.includes("<FinanceArErrorBanner"));
    assert.ok(tab.includes("finance-billing-detail-empty"));
    assert.ok(tab.includes("Nenhum pedido faturado encontrado"));
    assert.ok(tab.includes("buildFinanceTabLoadError"));
  });

  it("paginação e ordenação server-side (nada é reordenado no cliente)", () => {
    assert.ok(tab.includes("FINANCE_BILLING_DETAIL_PAGE_SIZE_OPTIONS"));
    assert.ok(tab.includes("FINANCE_BILLING_DETAIL_SORT_OPTIONS"));
    assert.ok(tab.includes("data?.pagination.totalPages"));
    assert.ok(tab.includes("Anterior"));
    assert.ok(tab.includes("Próxima"));
    assert.doesNotMatch(tab, /items\.sort\(|\.slice\(\s*\(page/);
  });

  it("aborta requisição anterior ao trocar filtros/página", () => {
    assert.ok(tab.includes("AbortController"));
    assert.ok(tab.includes("abortRef.current?.abort()"));
    assert.ok(tab.includes('e.name === "AbortError"'));
  });
});

describe("Faturamento > Detalhamento — reuso do modal de Pedido de Venda", () => {
  const tab = read(TAB_PATH);

  it("usa o SalesOrderDetailDialog canônico, carregado sob demanda", () => {
    assert.match(
      tab,
      /React\.lazy\(\(\) =>\s*\n\s*import\("@\/src\/components\/sales\/SalesOrderDetailDialog"\)/
    );
    assert.ok(tab.includes("<SalesOrderDetailDialog"));
  });

  it("passa o id canônico do SalesOrder e o código do pedido", () => {
    assert.match(tab, /salesOrderId=\{detailOrderId\}/);
    assert.match(tab, /orderCode=\{detailOrderCode\}/);
    assert.match(tab, /openOrderDetail\(row\.salesOrderId, row\.orderCode\)/);
  });

  it("clique e teclado abrem o mesmo detalhe", () => {
    assert.ok(tab.includes("onClick={() => openOrderDetail(row.salesOrderId, row.orderCode)}"));
    assert.match(tab, /event\.key === "Enter" \|\| event\.key === " "/);
  });

  it("fechar o modal não recarrega nem perde a consulta atual", () => {
    // closeOrderDetail só zera o estado do modal; não toca filtros/página/dados.
    const close = tab.slice(
      tab.indexOf("const closeOrderDetail"),
      tab.indexOf("const items =")
    );
    assert.ok(close.includes("setDetailOrderId(null)"));
    assert.ok(close.includes("setDetailOrderCode(null)"));
    assert.doesNotMatch(close, /setAppliedFilters|setPage\(|void load\(/);
  });

  it("não reimplementa o detalhe do pedido dentro da subaba", () => {
    assert.doesNotMatch(tab, /SalesOrderDetailView|SalesOrderTributosTab/);
    assert.doesNotMatch(tab, /\/api\/sales-orders\//);
  });
});

describe("Faturamento > Detalhamento — rota e permissão", () => {
  const routes = read(ROUTES_PATH);

  it("endpoint fica sob o prefixo de Faturamento", () => {
    assert.equal(
      FINANCE_BILLING_DETAIL_ORDERS_ENDPOINT,
      "/api/finance/billing/detail/orders"
    );
    assert.ok(routes.includes('"/api/finance/billing/detail/orders"'));
  });

  it("usa exatamente o guard de leitura já existente da tela (finance.billing view)", () => {
    assert.equal(FINANCE_MODULE_RESOURCE_KEYS.billing, "finance.billing");
    assert.equal(FINANCE_MODULE_ACTIONS.view, "view");
    assert.match(
      routes,
      /app\.get\("\/api\/finance\/billing\/detail\/orders", \.\.\.viewGuard/
    );
    assert.match(
      routes,
      /const viewGuard = \[\s*requireAppAuth,\s*requireResource\(FINANCE_MODULE_RESOURCE_KEYS\.billing, FINANCE_MODULE_ACTIONS\.view\)/
    );
  });

  it("exige autenticação e devolve 401 sem usuário", () => {
    const handler = routes.slice(
      routes.indexOf('"/api/finance/billing/detail/orders"'),
      routes.indexOf('app.get("/api/finance/billing/export"')
    );
    assert.ok(handler.includes("await getCurrentAppUser(req)"));
    assert.match(handler, /res\.status\(401\)\.json\(\{ error: "Não autenticado\." \}\)/);
  });

  it("filtro inválido vira 400 e falha inesperada vira 500", () => {
    const handler = routes.slice(
      routes.indexOf('"/api/finance/billing/detail/orders"'),
      routes.indexOf('app.get("/api/finance/billing/export"')
    );
    assert.ok(handler.includes("FinanceBillingDetailQueryError"));
    assert.ok(handler.includes("res.status(400)"));
    assert.ok(handler.includes("res.status(500)"));
  });

  it("rota é read-only e não abre permissão nova", () => {
    assert.doesNotMatch(
      routes,
      /app\.(post|put|patch|delete)\("\/api\/finance\/billing\/detail/
    );
    const detailBlock = routes.slice(
      routes.indexOf('"/api/finance/billing/detail/orders"'),
      routes.indexOf('app.get("/api/finance/billing/export"')
    );
    assert.doesNotMatch(detailBlock, /exportGuard|executeGuard|requireAnyPermission/);
  });
});

describe("Faturamento > Detalhamento — fronteiras preservadas", () => {
  it("o loader é read-only: nenhuma escrita Prisma", () => {
    const server = read("src/lib/finance/financeBillingDetailOrders.server.ts");
    assert.doesNotMatch(
      server,
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw)\b/
    );
    assert.ok(server.includes("findMany"));
  });

  it("não consulta o Nomus nem toca sincronização", () => {
    const server = read("src/lib/finance/financeBillingDetailOrders.server.ts");
    const tab = read(TAB_PATH);
    for (const source of [server, tab]) {
      assert.doesNotMatch(
        source,
        /nomusClient|nomusHttp|fetchNomus|nomusNfesSync|startNomus|SyncRunner|\/api\/[\w/-]*sync/i
      );
    }
  });

  it("usa a cadeia oficial SalesOrderNfeLink → NomusNfe → NomusStockDocument", () => {
    const server = read("src/lib/finance/financeBillingDetailOrders.server.ts");
    assert.ok(server.includes("salesOrderNfeLink"));
    assert.ok(server.includes("nomusNfe"));
    assert.ok(server.includes("nomusStockDocument"));
    assert.ok(server.includes("NOMUS_STOCK_DOCUMENT_TIPO_SAIDA"));
    assert.ok(server.includes("isNomusNfeCancelled"));
    // Sem fuzzy/adivinhação e sem depender de corrida de auditoria O2C.
    assert.doesNotMatch(server, /orderToCashAuditFact/);
  });

  it("Contas a Receber e Tesouraria não foram tocadas por esta feature", () => {
    const arTab = read("src/components/finance/FinanceArAnalyticalTitlesTab.tsx");
    assert.doesNotMatch(arTab, /FinanceBillingDetail/);
    const arCss = read("src/components/finance/finance-ar-analytical-titles-table.css");
    assert.doesNotMatch(arCss, /finance-billing-detail/);
  });
});
