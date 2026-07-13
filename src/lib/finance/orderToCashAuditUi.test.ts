import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_TO_CASH_AUDIT_API_PATH,
  ORDER_TO_CASH_AUDIT_EMPTY_FILTERED_MESSAGE,
  ORDER_TO_CASH_AUDIT_EMPTY_NO_RUN_MESSAGE,
  ORDER_TO_CASH_AUDIT_ERROR_MESSAGE,
  ORDER_TO_CASH_AUDIT_HEAVY_WARNING,
  ORDER_TO_CASH_AUDIT_LOADING_MESSAGE,
  ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE,
  ORDER_TO_CASH_AUDIT_SELECT_MESSAGE,
  ORDER_TO_CASH_AUDIT_TAB_TITLE,
  buildOrderToCashAuditListQuery,
  canSearchOrderToCashAudit,
  createDefaultOrderToCashAuditUiFilters,
  formatOrderToCashAuditRunScope,
  nextOrderToCashAuditSort,
  orderToCashAuditEmptyDescription,
  resolveOrderToCashAuditEmptyKind,
} from "./orderToCashAuditClient.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const UI_FILES = [
  "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx",
  "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx",
  "src/components/finance/portfolio-reconciliation/OrderToCashAuditTable.tsx",
  "src/components/finance/portfolio-reconciliation/OrderToCashAuditSummaryCards.tsx",
  "src/lib/finance/orderToCashAuditClient.ts",
];

describe("orderToCashAuditUi", () => {
  it("1. terceira aba existe com nome Auditoria Pedido → Caixa", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    const perms = read("src/lib/permissionsClient.ts");
    assert.match(page, /portfolio-tab-order-to-cash-audit/);
    assert.match(page, /PORTFOLIO_RECONCILIATION_UI_TABS|OrderToCashAuditTab/);
    assert.match(perms, /Auditoria Pedido → Caixa/);
    assert.match(page, /OrderToCashAuditTab/);
    assert.equal(ORDER_TO_CASH_AUDIT_TAB_TITLE, "Auditoria Pedido → Caixa");
  });

  it("2. aba não chama API ao abrir sem pesquisa manual", () => {
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    assert.match(tab, /if \(!applied\) return/);
    assert.match(tab, /canSearchOrderToCashAudit/);
    assert.doesNotMatch(tab, /useEffect\(\(\) => \{\s*void load\(\)/);
    assert.equal(canSearchOrderToCashAudit({ year: "2026" }), true);
    assert.equal(canSearchOrderToCashAudit({ customerId: "x" }), false);
    assert.equal(canSearchOrderToCashAudit({ year: "" }), false);
  });

  it("3. mostra mensagem de pesquisa obrigatória (ano; cliente opcional)", () => {
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    const filters = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
    );
    assert.match(tab, /ORDER_TO_CASH_AUDIT_SELECT_MESSAGE/);
    assert.match(filters, /ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE/);
    assert.match(ORDER_TO_CASH_AUDIT_SELECT_MESSAGE, /ano/i);
    assert.match(ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE, /opcional/i);
  });

  it("4. botão Pesquisar fica desabilitado sem ano", () => {
    const filters = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
    );
    assert.match(filters, /disabled=\{!canSearch\}/);
    assert.equal(
      canSearchOrderToCashAudit({ customerId: "", customerExternalId: "", year: "" }),
      false
    );
  });

  it("5. Pesquisar envia customerExternalId + year (não UUID quando há código)", () => {
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    assert.match(tab, /ORDER_TO_CASH_AUDIT_API_PATH/);
    assert.match(tab, /buildOrderToCashAuditListQuery/);
    assert.match(tab, /handleSearch/);

    const qsExternal = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        customerId: "cust-1",
        customerExternalId: "200",
        customerName: "Britânia",
        year: "2026",
        page: 1,
        pageSize: 50,
        sortBy: "orderIssueDate",
        sortDirection: "desc",
      })
    );
    assert.match(qsExternal, /customerExternalId=200/);
    assert.match(qsExternal, /year=2026/);
    assert.match(qsExternal, /page=1/);
    assert.match(qsExternal, /pageSize=50/);
    assert.match(qsExternal, /sortBy=orderIssueDate/);
    assert.match(qsExternal, /sortDirection=desc/);
    assert.doesNotMatch(qsExternal, /customerId=/);
    assert.doesNotMatch(qsExternal, /customerName=/);

    const qsName = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        customerId: "cust-1",
        customerName: "Britânia",
        year: "2026",
      })
    );
    assert.match(qsName, /customerName=/);
    assert.doesNotMatch(qsName, /customerId=/);

    const qsYearOnly = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({ year: "2026" })
    );
    assert.match(qsYearOnly, /year=2026/);
    assert.doesNotMatch(qsYearOnly, /customer/);

    assert.equal(ORDER_TO_CASH_AUDIT_API_PATH.includes("order-to-cash-audit"), true);
    assert.match(
      read("src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"),
      /order-to-cash-audit-external-id/
    );
  });

  it("6. tabela renderiza colunas principais pedidas", () => {
    const table = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTable.tsx"
    );
    for (const label of [
      "Pedido",
      "Data pedido",
      "Entrega estimada",
      "Cliente",
      "Vendedor",
      "Produto/SKU",
      "Tipo linha",
      "Documento saída",
      "NF",
      "Valor item pedido",
      "Valor atribuído ao pedido",
      "Valor cobrado linha",
      "Fonte valor cobrado",
      "CR total título",
      "CR aberto",
      "Recebido",
      "Status pagamento",
      "Status operacional",
      "Status financeiro",
      "Estágio Pedido → Caixa",
      "Temperatura",
      "Confiança",
      "Alertas",
      "Responsável",
      "Ação recomendada",
    ]) {
      assert.match(table, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(
      table,
      /Valor total do título financeiro\. Pode se repetir em várias linhas/
    );
    assert.match(table, /Valor do item no documento de saída ou NF/);
    assert.match(table, /Valor atribuído ao pedido respeitando o limite/);
  });

  it("6b. tabela tem barra de rolagem horizontal única no topo e área limitada", () => {
    const table = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTable.tsx"
    );
    assert.match(table, /order-to-cash-audit-scroll-top/);
    assert.match(table, /order-to-cash-audit-scroll-main/);
    assert.match(table, /max-h-\[min\(70vh,720px\)\]/);
    assert.match(table, /useTableHorizontalScrollSync/);
    assert.match(table, /TABLE_HORIZONTAL_TOP_SCROLL_CLASS/);
    // Padrão único adotado — sem slider, sem setas de nudge.
    assert.doesNotMatch(table, /order-to-cash-audit-scroll-range/);
    assert.doesNotMatch(table, /order-to-cash-audit-scroll-left/);
    assert.doesNotMatch(table, /order-to-cash-audit-scroll-right/);
    assert.doesNotMatch(table, /nudgeHorizontal/);
  });

  it("7–9. sort server-side", () => {
    const next = nextOrderToCashAuditSort("orderIssueDate", "desc", "sellerName");
    assert.equal(next.sortBy, "sellerName");
    assert.equal(next.sortDirection, "desc");
    assert.equal(next.page, 1);
    const a = nextOrderToCashAuditSort("orderCode", "desc", "orderCode");
    assert.equal(a.sortDirection, "asc");
  });

  it("10. paginação funciona", () => {
    const qs = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        customerExternalId: "200",
        year: "2026",
        page: 3,
      })
    );
    assert.match(qs, /page=3/);
    assert.match(
      read("src/components/finance/portfolio-reconciliation/OrderToCashAuditTable.tsx"),
      /order-to-cash-audit-pagination/
    );
  });

  it("11. pageSize funciona", () => {
    const qs = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        year: "2026",
        pageSize: 100,
      })
    );
    assert.match(qs, /pageSize=100/);
  });

  it("12. filtros avançados alteram query", () => {
    const qs = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        customerExternalId: "200",
        year: "2026",
        orderToCashStage: "BLOQUEADO_REVISAO",
        hasAlerts: true,
        onlyOverdue: true,
        sellerName: "João",
      })
    );
    assert.match(qs, /orderToCashStage=BLOQUEADO_REVISAO/);
    assert.match(qs, /hasAlerts=true/);
    assert.match(qs, /onlyOverdue=true/);
  });

  it("13. estados vazios diferenciados + run meta + summary da API", () => {
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    assert.match(tab, /order-to-cash-audit-run-meta/);
    assert.match(tab, /formatOrderToCashAuditRunScope/);
    assert.match(tab, /Sem run materializada/);
    assert.match(tab, /Nenhuma linha para os filtros/);
    assert.match(tab, /console\.warn\(\s*"\[order-to-cash-audit\]"/);

    assert.equal(
      resolveOrderToCashAuditEmptyKind({
        searched: true,
        error: null,
        payload: {
          ok: true,
          message: ORDER_TO_CASH_AUDIT_EMPTY_NO_RUN_MESSAGE,
          filters: {},
          requiredSelection: {
            customerRequired: true,
            yearRequired: true,
            readyToSearch: true,
            message: null,
          },
          run: null,
          summary: {
            totalRows: 0,
            totalOrders: 0,
            totalOrderValue: 0,
            totalAllocatedValue: 0,
            totalReceivableValue: 0,
            totalReceivedValue: 0,
            totalOpenValue: 0,
            totalBlockedValue: 0,
            alertCounts: {},
            stageCounts: {},
            paymentStatusCounts: {},
            summarySource: "filtered_facts",
          },
          rows: [],
          pagination: { page: 1, pageSize: 50, totalRows: 0, totalPages: 1 },
          sorting: {
            sortBy: "orderIssueDate",
            sortDirection: "desc",
            whitelist: [],
          },
          availableFilters: {
            sellers: [],
            stages: [],
            paymentStatuses: [],
            products: [],
            alertTypes: [],
          },
        },
      }),
      "no_run"
    );

    assert.match(
      orderToCashAuditEmptyDescription("filtered"),
      /run materializada existe/i
    );
    assert.ok(ORDER_TO_CASH_AUDIT_EMPTY_FILTERED_MESSAGE.length > 10);
    assert.ok(ORDER_TO_CASH_AUDIT_ERROR_MESSAGE.includes("Não foi possível"));
    assert.ok(ORDER_TO_CASH_AUDIT_HEAVY_WARNING.includes("não carrega automaticamente"));
    assert.ok(ORDER_TO_CASH_AUDIT_LOADING_MESSAGE.includes("Carregando"));

    const cards = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditSummaryCards.tsx"
    );
    assert.match(cards, /summarySource/);
    assert.match(cards, /Não recalcula nem soma CR/);
    assert.equal(
      formatOrderToCashAuditRunScope({
        runId: "41c2470a-b685-4765-a954-77110fd8cf5c",
        startedAt: null,
        finishedAt: null,
        status: "SUCCESS",
        mode: "APPLY",
        year: null,
        customerFilter: null,
        periodFrom: null,
        periodTo: null,
        totalOrders: 1283,
        totalFacts: 5860,
        totalOrderValue: null,
        totalAllocatedValue: null,
        totalReceivableValue: null,
        totalReceivedValue: null,
        totalOpenValue: null,
        totalBlockedValue: null,
        createdAt: null,
        isGeneralRun: true,
      }),
      "Run geral"
    );
  });

  it("14. não existe import de Prisma no frontend", () => {
    for (const f of UI_FILES) {
      const src = read(f);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from ["'][^"']*prisma\.js["']/);
      assert.doesNotMatch(src, /financeOrderToCashAuditApi\.server/);
    }
  });

  it("15. não usa proposta", () => {
    for (const f of UI_FILES) {
      assert.doesNotMatch(read(f), /from ["'][^"']*proposta/i);
      assert.doesNotMatch(read(f), /\bProposal\b/);
    }
  });

  it("16. não usa comissão", () => {
    for (const f of UI_FILES) {
      assert.doesNotMatch(read(f), /from ["'][^"']*comiss/i);
      assert.doesNotMatch(read(f), /\bCommission\b/);
    }
  });
});
