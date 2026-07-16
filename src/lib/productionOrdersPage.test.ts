import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
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
  resolveLatestSyncedAt,
} from "@/src/lib/productionOrdersUi.js";
import { HttpError } from "@/src/lib/http.js";

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
    assert.equal(formatProductionOrderQuantity("15400", "PC"), "15400 PC");
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
    assert.ok(chips.some((c) => c.label === "Sem status"));
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
});
