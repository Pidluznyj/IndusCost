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

  it("cards existem no topo", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /indus-kpi-grid/);
    assert.match(page, /MANAGEMENT_KPI_CARDS/);
    assert.match(page, /FinanceBiKpiCard/);
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

  it("tabela mostra ação sugerida", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /Ação sugerida/);
    assert.match(page, /suggestedActionLabel/);
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

  it("filtro de cliente usa autocomplete", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /CustomerAutocompleteFilter/);
  });

  it("clique na linha abre drawer", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /SalesOrderIntelligenceDrawer/);
    assert.match(page, /openDrawer/);
    assert.match(page, /onClick=\{\(\) => void openDrawer\(row\)\}/);
  });

  it("botão Ver inteligência abre drawer", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /Ver inteligência/);
    assert.match(page, /sales-order-view-intelligence/);
  });

  it("drawer chama endpoint sob demanda", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /getSalesOrderIntelligenceApiPath/);
    assert.equal(getSalesOrderIntelligenceApiPath("abc"), "/api/sales-orders/abc/intelligence");
  });

  it("drawer mostra resumo com riscos e ação", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    assert.match(drawer, /sales-order-intelligence-summary/);
    assert.match(drawer, /Riscos principais/);
    assert.match(drawer, /Ação sugerida/);
  });

  it("drawer mostra timeline", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    const ui = read("src/lib/salesOrderManagementUi.ts");
    assert.match(drawer, /sales-order-intelligence-timeline/);
    assert.match(ui, /id: "timeline"/);
  });

  it("drawer mostra itens com NF e situação", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    assert.match(drawer, /sales-order-intelligence-items/);
    assert.match(drawer, /formatItemSituation/);
    assert.match(drawer, />NF</);
    assert.match(drawer, /Situação/);
  });

  it("drawer mostra OP/Produção com avisos", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    assert.match(drawer, /sales-order-intelligence-production/);
    assert.match(drawer, /Nenhuma OP vinculada encontrada/);
    assert.match(drawer, /OP não sincronizada/);
  });

  it("drawer mostra NF/Faturamento", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    assert.match(drawer, /sales-order-intelligence-invoicing/);
    assert.match(drawer, /NF após prazo|Timing/);
  });

  it("drawer mostra riscos e ações", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    assert.match(drawer, /sales-order-intelligence-risks/);
    assert.match(drawer, /suggestedActions/);
  });

  it("drawer mostra dados e auditoria", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    assert.match(drawer, /sales-order-intelligence-audit/);
    assert.match(drawer, /Fontes de dados/);
    assert.match(drawer, /SalesOrder/);
  });

  it("não há import de Prisma no frontend", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    assert.doesNotMatch(page, /@prisma\/client/);
    assert.doesNotMatch(drawer, /@prisma\/client/);
    assert.doesNotMatch(page, /from ["'].*prisma/);
    assert.doesNotMatch(drawer, /from ["'].*prisma/);
  });

  it("rota App para gestão", () => {
    const app = read("src/App.tsx");
    assert.match(app, /sales-orders\/management/);
    assert.match(app, /SalesOrderManagementPage/);
    assert.match(app, /Gestão de Pedidos/);
  });
});
