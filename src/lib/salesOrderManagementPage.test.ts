import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getSalesOrderIntelligenceApiPath } from "./salesOrderManagementTypes.js";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("salesOrderManagementPage", () => {
  it("tela existe", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /export function SalesOrderManagementPage/);
    assert.match(page, /data-testid="sales-order-management-page"/);
  });

  it("cards de status gerencial no topo com clique para filtrar", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    const status = read("src/lib/salesOrderManagementStatus.ts");
    assert.match(page, /displayDashboardCards/);
    assert.match(page, /toggleManagementStatusCard/);
    assert.match(page, /management-status-card-/);
    assert.match(status, /Total no filtro/);
    assert.doesNotMatch(page, /Pedidos em aberto/);
    assert.doesNotMatch(page, /Sem OP vinculada/);
  });

  it("card ativo e limpar filtro do card", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /data-active=/);
    assert.match(page, /clear-management-status-filter/);
    assert.match(page, /Limpar filtro do card/);
  });

  it("alertas operacionais como checkboxes separados", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /Alertas operacionais/);
    assert.match(page, /Com risco/);
    assert.match(page, /Sem OP/);
    assert.match(page, /NF após prazo/);
    assert.match(page, /OP atrasada/);
    assert.match(page, /noProductionOrder/);
  });

  it("tabela mostra status gerencial", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /Status gerencial/);
    assert.match(page, /executiveStatusLabel/);
  });

  it("tabela mostra NF", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, />NF</);
    assert.match(page, /formatInvoiceBadge/);
  });

  it("tabela mostra OP", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, />OP</);
    assert.match(page, /formatProductionBadge/);
  });

  it("tabela mostra prazo e completeza", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /formatDeadlineBadge/);
    assert.match(page, /Previsão entrega/);
    assert.match(page, /COMPLETION_STATUS_LABELS/);
  });

  it("filtros existem incluindo NF e OP", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /operationalStatus/);
    assert.match(page, /deadlineStatus/);
    assert.match(page, /completionStatus/);
    assert.match(page, /billingStatus/);
    assert.match(page, /productionFilter/);
    assert.match(page, /withRisk/);
    assert.match(page, /CustomerAutocompleteFilter/);
    assert.match(page, /invoiceAfterDeadline/);
    assert.match(page, /partialOrCut/);
    assert.match(page, /noProductionOrder/);
  });

  it("tabela não exibe colunas de alertas nem ação sugerida", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.doesNotMatch(page, />Alertas</);
    assert.doesNotMatch(page, />Ação sugerida</);
    assert.doesNotMatch(page, /suggestedActionLabel/);
  });

  it("clique na linha abre drawer", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /SalesOrderIntelligenceDrawer/);
    assert.match(page, /openDrawer/);
    assert.match(page, /sales-order-management-row-hint/);
    assert.match(page, /Ver detalhes/);
  });

  it("drawer possui abas de raio-x do pedido", () => {
    const ui = read("src/lib/salesOrderManagementUi.ts");
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    assert.match(ui, /nomus-data/);
    assert.match(ui, /rule-audit/);
    assert.match(drawer, /sales-order-intelligence-nomus-data/);
    assert.match(drawer, /sales-order-intelligence-rule-audit/);
    assert.match(drawer, /Status logístico/);
  });

  it("primeiro card é Total no filtro com quantidade e valor", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    const status = read("src/lib/salesOrderManagementStatus.ts");
    assert.match(status, /Total no filtro/);
    assert.match(page, /management-status-card-total/);
    assert.match(page, /formatCurrency\(card\.totalNetValue\)/);
    assert.match(page, /pedido/);
    assert.doesNotMatch(page, /Pedidos em aberto/);
  });

  it("clique no card total limpa filtro de status", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /clearManagementStatusCardFilter/);
    assert.match(page, /isTotal/);
  });

  it("não há import de Prisma no frontend", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.doesNotMatch(page, /@prisma\/client/);
    assert.doesNotMatch(page, /from ["'].*prisma/);
  });

  it("rota App para gestão", () => {
    const app = read("src/App.tsx");
    assert.match(app, /sales-orders\/management/);
    assert.match(app, /SalesOrderManagementPage/);
  });

  it("drawer chama endpoint sob demanda", () => {
    assert.equal(getSalesOrderIntelligenceApiPath("abc"), "/api/sales-orders/abc/intelligence");
  });
});
