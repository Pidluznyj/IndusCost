import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSoldProductCustomersCsv,
  soldProductCustomersExportFilename,
} from "./soldProductCustomersExport.js";
import type { SoldProductCustomersPayload } from "./soldProductCustomersTypes.js";

const mockPayload: SoldProductCustomersPayload = {
  generatedAt: "2026-06-17T12:00:00.000Z",
  product: {
    id: "p1",
    code: "BH-001",
    name: "Boia Horizontal",
    description: null,
  },
  filters: {
    periodLabel: "2026",
    dateBasis: "issueDate",
    dateBasisLabel: "Data de emissão do pedido",
    company: "all",
    companyLabel: "Todas",
    orderStatus: "valid",
    orderStatusLabel: "Válidos",
    customerScope: "external",
    customerScopeLabel: "Clientes externos",
    sortBy: "quantity",
    sortByLabel: "Quantidade vendida",
    topN: "all",
    topNLabel: "Todos",
    startDate: "2026-01-01",
    endDate: "2026-06-17",
    activityFilter: "all",
    onlyWithoutOverdue: false,
    customerSortBy: "totalRevenue",
    customerSortDirection: "desc",
    customerTopN: null,
  },
  summary: {
    customersCount: 1,
    totalQuantity: 10,
    totalRevenue: 1000,
    averageUnitPrice: 100,
    minUnitPrice: 100,
    maxUnitPrice: 100,
    lastSaleDate: "2026-03-10",
    inactiveCustomersCount: 0,
    recurringCustomersCount: 1,
  },
  customers: [
    {
      customerId: "c1",
      customerCode: "12345678000199",
      customerName: "Cliente Alpha",
      customerCnpj: "12.345.678/0001-99",
      city: "São Paulo",
      state: "SP",
      region: "Sudeste",
      commercialOwner: "Maria",
      ordersCount: 2,
      quantity: 10,
      totalRevenue: 1000,
      averageUnitPrice: 100,
      minUnitPrice: 90,
      maxUnitPrice: 110,
      lastUnitPrice: 105,
      firstPurchaseDate: "2026-01-10",
      lastPurchaseDate: "2026-03-10",
      daysSinceLastPurchase: 99,
      averageDaysBetweenPurchases: 30,
      averageDaysBetweenPurchasesLabel: "30 dias",
      shareOfProductRevenue: 100,
      shareOfCustomerRevenue: 40,
      openPortfolioAmount: 0,
      overdueAmount: 0,
      commercialHealth: "Recorrente",
      suggestedAction: "Bom alvo para promoção",
    },
  ],
  dataQuality: { warnings: [], sources: ["SalesOrder"] },
};

describe("soldProductCustomersPage", () => {
  it("página possui colunas principais e botões Cadastro/Inteligência", () => {
    const pageSrc = readFileSync(
      join(process.cwd(), "src/components/commercial/SoldProductCustomersPage.tsx"),
      "utf8"
    );
    assert.ok(pageSrc.includes("Cliente"));
    assert.ok(pageSrc.includes("Último preço"));
    assert.ok(pageSrc.includes("Dias s/ compra"));
    assert.ok(pageSrc.includes("Ação sugerida"));
    assert.ok(pageSrc.includes("Cadastro"));
    assert.ok(pageSrc.includes("Inteligência"));
    assert.ok(pageSrc.includes("buildCustomerIntelligencePath"));
    assert.ok(pageSrc.includes("buildCustomerRegistrationPath"));
    assert.ok(pageSrc.includes("Exportar lista"));
  });

  it("exportação CSV inclui cliente e ação sugerida", () => {
    const csv = buildSoldProductCustomersCsv(mockPayload);
    assert.ok(csv.includes("Cliente Alpha"));
    assert.ok(csv.includes("Bom alvo para promoção"));
    assert.ok(csv.startsWith("\uFEFF"));
  });

  it("query de filtros montada via buildSoldProductsDashboardQuery + extras", () => {
    const pageSrc = readFileSync(
      join(process.cwd(), "src/components/commercial/SoldProductCustomersPage.tsx"),
      "utf8"
    );
    assert.ok(pageSrc.includes("buildSoldProductsDashboardQuery"));
    assert.ok(pageSrc.includes("minDaysSinceLastPurchase"));
    assert.ok(pageSrc.includes("buildSoldProductCustomersApiPath"));
  });

  it("página define KPI cards e header do produto", () => {
    const kpiSrc = readFileSync(
      join(process.cwd(), "src/components/commercial/SoldProductCustomersPage.tsx"),
      "utf8"
    );
    assert.ok(kpiSrc.includes("FinanceBiKpiCard"));
    assert.ok(kpiSrc.includes("Clientes compradores do produto"));
  });

  it("export filename usa código do produto", () => {
    assert.match(
      soldProductCustomersExportFilename("BH-001", new Date(2026, 5, 17)),
      /^clientes-compradores-BH-001-2026-06-17\.csv$/
    );
  });
});
