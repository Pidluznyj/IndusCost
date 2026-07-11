import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_TO_CASH_AUDIT_API_PATH,
  ORDER_TO_CASH_AUDIT_EMPTY_MESSAGE,
  ORDER_TO_CASH_AUDIT_ERROR_MESSAGE,
  ORDER_TO_CASH_AUDIT_HEAVY_WARNING,
  ORDER_TO_CASH_AUDIT_LOADING_MESSAGE,
  ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE,
  ORDER_TO_CASH_AUDIT_SELECT_MESSAGE,
  ORDER_TO_CASH_AUDIT_TAB_TITLE,
  buildOrderToCashAuditListQuery,
  canSearchOrderToCashAudit,
  createDefaultOrderToCashAuditUiFilters,
  nextOrderToCashAuditSort,
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
    assert.match(page, /portfolio-tab-order-to-cash-audit/);
    assert.match(page, /Auditoria Pedido → Caixa/);
    assert.match(page, /OrderToCashAuditTab/);
    assert.match(page, /order-to-cash-audit/);
    assert.equal(ORDER_TO_CASH_AUDIT_TAB_TITLE, "Auditoria Pedido → Caixa");
  });

  it("2. aba não chama API ao abrir sem cliente/ano", () => {
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    assert.match(tab, /applied != null|applied == null|!applied/);
    assert.match(tab, /if \(!applied\) return/);
    assert.match(tab, /canSearchOrderToCashAudit/);
    assert.doesNotMatch(tab, /useEffect\(\(\) => \{\s*void load\(\)/);
    assert.equal(canSearchOrderToCashAudit({ year: "2026" }), false);
    assert.equal(canSearchOrderToCashAudit({ customerId: "x" }), false);
  });

  it("3. mostra mensagem para selecionar cliente e ano", () => {
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    const filters = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
    );
    assert.match(tab, /ORDER_TO_CASH_AUDIT_SELECT_MESSAGE/);
    assert.match(filters, /ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE/);
    assert.equal(
      ORDER_TO_CASH_AUDIT_SELECT_MESSAGE,
      "Selecione Cliente e Ano para carregar a auditoria."
    );
    assert.equal(
      ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE,
      "Selecione um cliente e um ano para pesquisar."
    );
  });

  it("4. botão Pesquisar fica desabilitado sem filtros obrigatórios", () => {
    const filters = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
    );
    assert.match(filters, /disabled=\{!canSearch\}/);
    assert.match(filters, /order-to-cash-audit-search/);
    assert.equal(
      canSearchOrderToCashAudit({ customerId: "", customerExternalId: "", year: "" }),
      false
    );
  });

  it("5. com cliente+ano, chama API", () => {
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    assert.match(tab, /ORDER_TO_CASH_AUDIT_API_PATH/);
    assert.match(tab, /buildOrderToCashAuditListQuery/);
    assert.match(tab, /handleSearch/);
    assert.equal(
      canSearchOrderToCashAudit({ customerId: "cust-1", year: "2026" }),
      true
    );
    assert.equal(
      canSearchOrderToCashAudit({ customerExternalId: "200", year: "2026" }),
      true
    );
    const qs = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        customerId: "cust-1",
        year: "2026",
      })
    );
    assert.match(qs, /customerId=cust-1/);
    assert.match(qs, /year=2026/);
    assert.equal(ORDER_TO_CASH_AUDIT_API_PATH.includes("order-to-cash-audit"), true);
  });

  it("6. tabela renderiza colunas principais", () => {
    const table = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTable.tsx"
    );
    for (const label of [
      "Pedido",
      "Data pedido",
      "Cliente",
      "Vendedor",
      "Produto/SKU",
      "Documento saída",
      "NF",
      "CR total",
      "Status pagamento",
      "Estágio Pedido → Caixa",
      "Alertas",
      "Ação recomendada",
    ]) {
      assert.match(table, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("7. clique em coluna altera sort", () => {
    const table = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTable.tsx"
    );
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    assert.match(table, /onSort/);
    assert.match(table, /Clique para ordenar/);
    assert.match(tab, /nextOrderToCashAuditSort/);
    const next = nextOrderToCashAuditSort("orderIssueDate", "desc", "sellerName");
    assert.equal(next.sortBy, "sellerName");
    assert.equal(next.sortDirection, "desc");
  });

  it("8. segundo clique na mesma coluna inverte direção", () => {
    const a = nextOrderToCashAuditSort("orderCode", "desc", "orderCode");
    assert.equal(a.sortBy, "orderCode");
    assert.equal(a.sortDirection, "asc");
    const b = nextOrderToCashAuditSort("orderCode", "asc", "orderCode");
    assert.equal(b.sortDirection, "desc");
  });

  it("9. troca de sort volta para página 1", () => {
    const next = nextOrderToCashAuditSort("orderIssueDate", "desc", "nfeNumber");
    assert.equal(next.page, 1);
    const same = nextOrderToCashAuditSort("nfeNumber", "asc", "nfeNumber");
    assert.equal(same.page, 1);
  });

  it("10. paginação funciona", () => {
    const table = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTable.tsx"
    );
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    assert.match(table, /order-to-cash-audit-pagination/);
    assert.match(table, /order-to-cash-audit-prev/);
    assert.match(table, /order-to-cash-audit-next/);
    assert.match(tab, /handlePageChange/);
    const qs = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        customerExternalId: "200",
        year: "2026",
        page: 3,
      })
    );
    assert.match(qs, /page=3/);
  });

  it("11. pageSize funciona", () => {
    const table = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTable.tsx"
    );
    const client = read("src/lib/finance/orderToCashAuditClient.ts");
    assert.match(table, /order-to-cash-audit-page-size/);
    assert.match(table, /ORDER_TO_CASH_AUDIT_PAGE_SIZE_OPTIONS/);
    assert.match(client, /\[50, 100, 200\]/);
    const qs = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        customerId: "c1",
        year: "2026",
        pageSize: 100,
      })
    );
    assert.match(qs, /pageSize=100/);
  });

  it("12. filtros avançados alteram query", () => {
    const filters = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
    );
    assert.match(filters, /order-to-cash-audit-advanced/);
    assert.match(filters, /hasAlerts/);
    assert.match(filters, /onlyWithExcess/);
    assert.match(filters, /onlyOverdue/);
    const qs = buildOrderToCashAuditListQuery(
      createDefaultOrderToCashAuditUiFilters({
        customerId: "c1",
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
    assert.match(qs, /sellerName=/);
  });

  it("13. estados loading/empty/error aparecem", () => {
    const tab = read(
      "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
    );
    assert.match(tab, /ORDER_TO_CASH_AUDIT_LOADING_MESSAGE/);
    assert.match(tab, /ORDER_TO_CASH_AUDIT_EMPTY_MESSAGE/);
    assert.match(tab, /ORDER_TO_CASH_AUDIT_ERROR_MESSAGE/);
    assert.match(tab, /order-to-cash-audit-loading/);
    assert.match(tab, /FinanceModuleLoadingBlock/);
    assert.match(tab, /FinanceModuleEmptyState/);
    assert.match(tab, /FinanceModuleErrorBanner/);
    assert.ok(ORDER_TO_CASH_AUDIT_LOADING_MESSAGE.includes("Carregando"));
    assert.ok(ORDER_TO_CASH_AUDIT_EMPTY_MESSAGE.includes("rebuild"));
    assert.ok(ORDER_TO_CASH_AUDIT_ERROR_MESSAGE.includes("Não foi possível"));
    assert.ok(ORDER_TO_CASH_AUDIT_HEAVY_WARNING.includes("não carrega automaticamente"));
  });

  it("14. não existe import de Prisma no frontend", () => {
    for (const f of UI_FILES) {
      const src = read(f);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from ["'][^"']*prisma\.js["']/);
      assert.doesNotMatch(src, /financeOrderToCashAuditApi\.server/);
    }
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    assert.doesNotMatch(page, /@prisma\/client/);
  });

  it("15. não usa proposta", () => {
    for (const f of UI_FILES) {
      const src = read(f);
      assert.doesNotMatch(src, /from ["'][^"']*proposta/i);
      assert.doesNotMatch(src, /\bProposal\b/);
    }
  });

  it("16. não usa comissão", () => {
    for (const f of UI_FILES) {
      const src = read(f);
      assert.doesNotMatch(src, /from ["'][^"']*comiss/i);
      assert.doesNotMatch(src, /from ["'][^"']*commission/i);
      assert.doesNotMatch(src, /\bCommission\b/);
    }
  });
});
