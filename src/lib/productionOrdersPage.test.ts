import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  buildGroupedNavigationStructure,
  flattenGroupedNavigationItems,
  getModulePath,
  MODULE_MENU_PERMISSION_KEYS,
} from "@/src/lib/navigationGroups.js";
import {
  canAccessModule,
  resolveModuleIdFromPath,
  type PermissionChecker,
} from "@/src/lib/modulePermissions.js";
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import {
  buildProductionOrdersListQueryString,
  PRODUCTION_ORDERS_LIST_API_PATH,
} from "@/src/lib/productionOrdersClient.js";
import {
  buildStatusChipEntries,
  canAccessProductionOrdersModule,
  canViewProductionOrders,
  classifyProductionOrdersListError,
  formatProductionOrderQuantity,
  hasActiveProductionOrdersFilters,
  PRODUCTION_ORDERS_BREADCRUMB,
  PRODUCTION_ORDERS_PAGE_SUBTITLE,
  PRODUCTION_ORDERS_PAGE_TITLE,
  PRODUCTION_ORDERS_ROUTE_PATH,
  productionOrderStatusBadgeClass,
  resolveProductionOrderStatusTone,
  resolveLatestSyncedAt,
} from "@/src/lib/productionOrdersUi.js";
import { HttpError } from "@/src/lib/http.js";
import { ProductionOrderGridTableRow } from "@/src/components/operations/ProductionOrdersModule.js";
import type { ProductionOrderGridRow } from "@/src/lib/productionOrdersList.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

function gridRow(overrides: Partial<ProductionOrderGridRow> = {}): ProductionOrderGridRow {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    externalId: 30347,
    name: "OP 05800 - 003",
    status: "Encerrada",
    tipo: "Injeção",
    priority: "Normal",
    companyName: "KOPPETEL",
    productCode: "311.32AA",
    productDescription: "Produto fixture OP 05800",
    quantity: "15400.000000",
    unit: "PC",
    stockSector: "PRODUCAO",
    openedAt: "2026-03-10T11:15:00.000Z",
    plannedAt: "2026-03-12T21:00:00.000Z",
    closedAt: "2026-03-12T20:40:22.000Z",
    nomusUpdatedAt: "2026-03-12T20:40:22.000Z",
    syncedAt: "2026-07-16T12:00:00.000Z",
    currentLinkCount: 1,
    currentSalesOrders: [
      {
        externalSalesOrderId: 2530,
        salesOrderId: "00000000-0000-4000-8000-000000000301",
        orderCode: "PD 02534",
        customerName: "Esmaltec S/A",
      },
    ],
    hasPendingLink: false,
    ...overrides,
  };
}

function renderRow(row: ProductionOrderGridRow): string {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        "table",
        null,
        React.createElement(
          "tbody",
          null,
          React.createElement(ProductionOrderGridTableRow, {
            row,
            selected: false,
            onOpen: () => {},
          })
        )
      )
    )
  );
}

describe("production orders navigation", () => {
  it("App.tsx registra rota /production-orders", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="production-orders"/);
    assert.match(app, /ProductionOrdersModule/);
    assert.match(app, /Ordens de Produção/);
  });

  it("menu Operações inclui production-orders", () => {
    const structure = buildGroupedNavigationStructure();
    const operacoes = structure.groups.find((g) => g.id === "operacoes");
    assert.ok(operacoes);
    const item = operacoes!.items.find((i) => i.itemId === "production-orders");
    assert.ok(item);
    assert.equal(item!.path, "/production-orders");
    assert.equal(item!.label, "Ordens de Produção");
    assert.equal(item!.resourceKey, ResourceKeys.OPERACOES_ORDENS_PRODUCAO);
    assert.deepEqual([...MODULE_MENU_PERMISSION_KEYS["production-orders"]], [
      "operations.production-orders.view",
    ]);
  });

  it("getModulePath e resolveModuleIdFromPath alinhados", () => {
    assert.equal(getModulePath("production-orders"), PRODUCTION_ORDERS_ROUTE_PATH);
    assert.equal(resolveModuleIdFromPath("/production-orders"), "production-orders");
  });

  it("resource key sidebar e contrato batem", () => {
    assert.equal(
      resolveSidebarModuleResourceKey("production-orders"),
      OPERATIONS_RESOURCE_KEYS.productionOrders
    );
  });

  it("menu oculto sem permissão", () => {
    const denied = canAccessModule("production-orders", checker(["inventory.view"]));
    const allowed = canAccessModule(
      "production-orders",
      checker(["operations.production-orders.view"])
    );
    assert.equal(denied, false);
    assert.equal(allowed, true);
    assert.equal(canAccessProductionOrdersModule(checker([])), false);
    assert.equal(
      canAccessProductionOrdersModule(checker(["operations.production-orders.view"])),
      true
    );
  });

  it("aparece no flatten do grupo Operações", () => {
    const flat = flattenGroupedNavigationItems();
    assert.ok(flat.some((item) => item.itemId === "production-orders"));
  });
});

describe("productionOrdersUi", () => {
  it("canViewProductionOrders usa resource action", () => {
    assert.equal(
      canViewProductionOrders({
        canPerformAction: (resource, action) =>
          resource === OPERATIONS_RESOURCE_KEYS.productionOrders && action === "view",
      }),
      true
    );
    assert.equal(canViewProductionOrders({ canPerformAction: () => false }), false);
  });

  it("classifica erros de acesso e API", () => {
    assert.equal(classifyProductionOrdersListError(new HttpError(403, "nope")).kind, "access_denied");
    assert.equal(
      classifyProductionOrdersListError(new HttpError(503, "down")).kind,
      "api_unavailable"
    );
    assert.equal(classifyProductionOrdersListError(new TypeError("network")).kind, "api_unavailable");
  });

  it("helpers de formatação e filtros", () => {
    assert.equal(formatProductionOrderQuantity("15400", "PC"), "15.400 PC");
    assert.equal(formatProductionOrderQuantity(null, null), "—");
    assert.equal(
      resolveLatestSyncedAt([
        { syncedAt: "2026-07-01T10:00:00.000Z" },
        { syncedAt: "2026-07-16T12:00:00.000Z" },
        { syncedAt: null },
      ]),
      "2026-07-16T12:00:00.000Z"
    );
    assert.equal(
      hasActiveProductionOrdersFilters({
        search: "",
        status: null,
        tipo: "",
        company: "",
      }),
      false
    );
    assert.equal(
      hasActiveProductionOrdersFilters({
        search: "05800",
        status: null,
        tipo: "",
        company: "",
      }),
      true
    );
    const chips = buildStatusChipEntries({ Encerrada: 2, "": 1 });
    assert.equal(chips[0]?.label, "Encerrada");
    assert.equal(chips.some((c) => c.label === "Sem status"), false);
  });

  it("mapeia badges claros e preserva status desconhecido", () => {
    assert.equal(resolveProductionOrderStatusTone("Encerrada"), "completed");
    assert.equal(resolveProductionOrderStatusTone("Liberada"), "released");
    assert.equal(resolveProductionOrderStatusTone("Planejada"), "pending");
    assert.equal(resolveProductionOrderStatusTone("Cancelada"), "cancelled");
    assert.equal(resolveProductionOrderStatusTone("Status futuro"), "unknown");
    assert.match(productionOrderStatusBadgeClass("Encerrada"), /emerald-50/);
    assert.match(productionOrderStatusBadgeClass("Liberada"), /sky-50/);
    assert.match(productionOrderStatusBadgeClass("Planejada"), /amber-50/);
    assert.match(productionOrderStatusBadgeClass("Cancelada"), /rose-50/);
    assert.match(productionOrderStatusBadgeClass("Status futuro"), /slate-50/);
    const chips = buildStatusChipEntries({ Encerrada: 2, "Status futuro": 1 });
    assert.ok(chips.some((chip) => chip.label === "Status futuro"));
  });
});

describe("productionOrdersClient e página base", () => {
  it("monta query string da API IndusCost", () => {
    const qs = buildProductionOrdersListQueryString({
      page: 2,
      pageSize: 50,
      search: "05800",
      status: "Encerrada",
    });
    assert.match(qs, /page=2/);
    assert.match(qs, /search=05800/);
    assert.equal(PRODUCTION_ORDERS_LIST_API_PATH, "/api/operations/production-orders");
  });

  it("módulo não importa cliente Nomus", () => {
    const moduleSrc = read("src/components/operations/ProductionOrdersModule.tsx");
    const clientSrc = read("src/lib/productionOrdersClient.ts");
    assert.match(moduleSrc, /fetchProductionOrdersList/);
    assert.doesNotMatch(moduleSrc, /fetchNomusJson|nomusRestClient|NOMUS_/);
    assert.doesNotMatch(clientSrc, /fetchNomusJson|nomusRestClient|NOMUS_/);
    assert.match(clientSrc, /\/api\/operations\/production-orders/);
  });

  it("página base contém estados obrigatórios e copy oficial", () => {
    const moduleSrc = read("src/components/operations/ProductionOrdersModule.tsx");
    const uiSrc = read("src/lib/productionOrdersUi.ts");
    assert.match(moduleSrc, /production-orders-denied/);
    assert.match(moduleSrc, /production-orders-loading/);
    assert.match(moduleSrc, /production-orders-empty/);
    assert.match(moduleSrc, /production-orders-empty-filters/);
    assert.match(moduleSrc, /production-orders-api-unavailable/);
    assert.match(moduleSrc, /production-orders-grid/);
    assert.match(moduleSrc, /production-orders-status-chips/);
    assert.match(moduleSrc, /PRODUCTION_ORDERS_BREADCRUMB/);
    assert.match(moduleSrc, /PRODUCTION_ORDERS_PAGE_TITLE/);
    assert.match(moduleSrc, /PRODUCTION_ORDERS_PAGE_SUBTITLE/);
    assert.match(uiSrc, new RegExp(PRODUCTION_ORDERS_BREADCRUMB.replace(/\//g, "\\/")));
    assert.match(uiSrc, new RegExp(PRODUCTION_ORDERS_PAGE_TITLE));
    assert.match(uiSrc, new RegExp(PRODUCTION_ORDERS_PAGE_SUBTITLE.replace(/\./g, "\\.")));
    assert.doesNotMatch(moduleSrc, /Criar ordem|Liberar|Encerrar|Cancelar|Sincronizar/);
  });

  it("Sidebar mapeia ícone do módulo", () => {
    assert.match(read("src/components/layout/Sidebar.tsx"), /"production-orders": Cog/);
  });

  it("implementa debounce, URL, cancelamento e paginação server-side", () => {
    const moduleSrc = read("src/components/operations/ProductionOrdersModule.tsx");
    const clientSrc = read("src/lib/productionOrdersClient.ts");
    assert.match(moduleSrc, /useSearchParams/);
    assert.match(moduleSrc, /SEARCH_DEBOUNCE_MS = 300/);
    assert.match(moduleSrc, /AbortController/);
    assert.match(moduleSrc, /controller\.abort/);
    assert.match(moduleSrc, /pageSize: PAGE_SIZE/);
    assert.match(moduleSrc, /production-orders-pagination/);
    assert.match(clientSrc, /\{ signal \}/);
  });
});

describe("ProductionOrderGridTableRow", () => {
  it("renderiza colunas, badge, pedido e quantidade inteira sem zeros inúteis", () => {
    const html = renderRow(gridRow());
    assert.match(html, /OP 05800 - 003/);
    assert.match(html, /311\.32AA/);
    assert.match(html, /Produto fixture OP 05800/);
    assert.match(html, /15\.400 PC/);
    assert.doesNotMatch(html, /15400\.000000/);
    assert.match(html, /Encerrada/);
    assert.match(html, /PD 02534/);
    assert.match(html, /\/sales-orders\/00000000-0000-4000-8000-000000000301/);
  });

  it("preserva decimal pequeno sem arredondar para zero", () => {
    const html = renderRow(gridRow({ quantity: "0.002925", unit: "KG" }));
    assert.match(html, /0,002925 KG/);
    assert.doesNotMatch(html, />0 KG</);
  });

  it("mostra primeiro pedido e +N para vários pedidos", () => {
    const html = renderRow(
      gridRow({
        currentSalesOrders: [
          ...gridRow().currentSalesOrders,
          {
            externalSalesOrderId: 3000,
            salesOrderId: "00000000-0000-4000-8000-000000000302",
            orderCode: "PD 03000",
            customerName: "Cliente B",
          },
          {
            externalSalesOrderId: 4000,
            salesOrderId: "00000000-0000-4000-8000-000000000303",
            orderCode: "PD 04000",
            customerName: "Cliente C",
          },
        ],
        currentLinkCount: 3,
      })
    );
    assert.match(html, /PD 02534/);
    assert.match(html, /\+2/);
  });

  it("mostra vínculo pendente explicitamente", () => {
    const html = renderRow(
      gridRow({
        hasPendingLink: true,
        currentSalesOrders: [
          {
            externalSalesOrderId: 2530,
            salesOrderId: null,
            orderCode: null,
            customerName: "Esmaltec S/A",
          },
        ],
      })
    );
    assert.match(html, /Pedido ainda não sincronizado/);
  });

  it("campos nulos aparecem como travessão e linha é clicável por teclado", () => {
    const html = renderRow(
      gridRow({
        name: null,
        tipo: null,
        companyName: null,
        productCode: null,
        productDescription: null,
        quantity: null,
        unit: null,
        priority: null,
        openedAt: null,
        plannedAt: null,
        status: null,
        currentSalesOrders: [],
        syncedAt: null,
      })
    );
    assert.match(html, /tabindex="0"/);
    assert.match(html, /Sem status/);
    assert.match(html, /—/);
  });
});
