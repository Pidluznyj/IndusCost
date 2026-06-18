import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("salesOrderManagementPage", () => {
  it("tela existe", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /export function SalesOrderManagementPage/);
    assert.match(page, /data-testid="sales-order-management-page"/);
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

  it("tabela mostra prazo", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /formatDeadlineBadge/);
    assert.match(page, /Previsão entrega/);
  });

  it("filtros existem", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /operationalStatus/);
    assert.match(page, /deadlineStatus/);
    assert.match(page, /completionStatus/);
    assert.match(page, /withRisk/);
    assert.match(page, /CustomerAutocompleteFilter/);
  });

  it("clique abre drawer", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /SalesOrderIntelligenceDrawer/);
    assert.match(page, /openDrawer/);
    assert.match(page, /onClick=\{\(\) => void openDrawer\(row\)\}/);
  });

  it("drawer tem linha do tempo", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    const ui = read("src/lib/salesOrderManagementUi.ts");
    assert.match(drawer, /sales-order-intelligence-timeline/);
    assert.match(ui, /id: "timeline"/);
    assert.match(drawer, /INTELLIGENCE_DRAWER_TABS/);
  });

  it("drawer tem aba OP/Produção", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    const ui = read("src/lib/salesOrderManagementUi.ts");
    assert.match(drawer, /sales-order-intelligence-production/);
    assert.match(ui, /id: "production"/);
  });

  it("drawer tem riscos e ações", () => {
    const drawer = read("src/components/sales/SalesOrderIntelligenceDrawer.tsx");
    const ui = read("src/lib/salesOrderManagementUi.ts");
    assert.match(drawer, /sales-order-intelligence-risks/);
    assert.match(drawer, /suggestedActions/);
    assert.match(ui, /id: "risks"/);
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
  });
});
