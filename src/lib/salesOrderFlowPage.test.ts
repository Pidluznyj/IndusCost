import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildGroupedNavigationStructure,
  getModulePath,
  MODULE_MENU_PERMISSION_KEYS,
} from "@/src/lib/navigationGroups.js";
import {
  canAccessModule,
  resolveModuleIdFromPath,
  type PermissionChecker,
} from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import { SIDEBAR_MODULE_CONTRACT_KEYS } from "@/src/lib/sidebarEffectiveAccess.js";
import {
  buildSalesOrderFlowQueryString,
  SALES_ORDER_FLOW_FEATURE_STATUS_API_PATH,
  SALES_ORDER_FLOW_LIST_API_PATH,
  SALES_ORDER_FLOW_SUMMARY_API_PATH,
} from "@/src/lib/salesOrderFlowClient.js";
import {
  areSalesOrderFlowFilterDateRangesInvalid,
  buildSalesOrderFlowSearchParams,
  canAccessSalesOrderFlowModule,
  canViewSalesOrderFlow,
  classifySalesOrderFlowListError,
  EMPTY_SALES_ORDER_FLOW_FILTERS,
  hasActiveSalesOrderFlowFilters,
  parseSalesOrderFlowBooleanParam,
  parseSalesOrderFlowFiltersFromSearchParams,
  parseSalesOrderFlowPriorityParam,
  parseSalesOrderFlowStagesParam,
  SALES_ORDER_FLOW_BREADCRUMB,
  SALES_ORDER_FLOW_PAGE_SUBTITLE,
  SALES_ORDER_FLOW_PAGE_TITLE,
  SALES_ORDER_FLOW_ROUTE_PATH,
  SALES_ORDER_FLOW_SEARCH_DEBOUNCE_MS,
  resolveSalesOrderFlowExecutiveIndicators,
  salesOrderFlowFiltersToClientQuery,
} from "@/src/lib/salesOrderFlowUi.js";
import { filterSalesOrderFlowMenuNavigation } from "@/src/lib/salesOrderFlowNavigation.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";
import { buildAccessibleSidebarNavigation } from "@/src/lib/sidebarNavigation.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (permission) => set.has(permission),
    hasAnyPermission: (permissions) =>
      permissions.some((permission) => set.has(permission)),
  };
}

describe("sales order flow navigation (OP-64)", () => {
  it("registra a rota e o ModulePageShell", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="commercial\/sales-order-flow"/);
    assert.match(app, /SalesOrderFlowModule/);
    assert.match(app, /SALES_ORDER_FLOW_PAGE_TITLE/);
    assert.match(app, /SALES_ORDER_FLOW_PAGE_SUBTITLE/);
    assert.equal(SALES_ORDER_FLOW_PAGE_TITLE, "Fluxo de Pedidos");
    assert.equal(
      SALES_ORDER_FLOW_PAGE_SUBTITLE,
      "Kanban operacional dos pedidos de venda."
    );
  });

  it("inclui Fluxo de Pedidos no grupo Comercial", () => {
    const comercial = buildGroupedNavigationStructure().groups.find(
      (group) => group.id === "comercial"
    );
    const item = comercial?.items.find(
      (entry) => entry.itemId === "sales-order-flow"
    );
    assert.ok(item);
    assert.equal(item?.path, SALES_ORDER_FLOW_ROUTE_PATH);
    assert.equal(item?.label, SALES_ORDER_FLOW_PAGE_TITLE);
    assert.deepEqual(MODULE_MENU_PERMISSION_KEYS["sales-order-flow"], [
      "sales_orders.flow.view",
    ]);
  });

  it("alinha rota, módulo e recursos de proteção", () => {
    assert.equal(getModulePath("sales-order-flow"), SALES_ORDER_FLOW_ROUTE_PATH);
    assert.equal(
      resolveModuleIdFromPath(SALES_ORDER_FLOW_ROUTE_PATH),
      "sales-order-flow"
    );
    assert.equal(
      resolveSidebarModuleResourceKey("sales-order-flow"),
      ResourceKeys.COMERCIAL_FLUXO_PEDIDOS
    );
    assert.deepEqual(SIDEBAR_MODULE_CONTRACT_KEYS["sales-order-flow"], [
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
    ]);
  });

  it("oculta o módulo sem permissão e libera com flow.view", () => {
    assert.equal(canAccessModule("sales-order-flow", checker([])), false);
    assert.equal(
      canAccessModule("sales-order-flow", checker(["sales_orders.flow.view"])),
      true
    );
    assert.equal(canAccessSalesOrderFlowModule(checker([])), false);
    assert.equal(
      canAccessSalesOrderFlowModule(checker(["sales_orders.flow.view"])),
      true
    );
  });

  it("filtra o menu pela feature flag", () => {
    const nav = buildAccessibleSidebarNavigation({
      hasPermission: () => true,
      hasAnyPermission: () => true,
    });
    const hidden = filterSalesOrderFlowMenuNavigation(nav, {
      featureEnabled: false,
      hasFlowViewAccess: true,
    });
    const shown = filterSalesOrderFlowMenuNavigation(nav, {
      featureEnabled: true,
      hasFlowViewAccess: true,
    });
    assert.ok(
      shown.flatAccessibleItems.some((item) => item.id === "sales-order-flow")
    );
    assert.ok(
      !hidden.flatAccessibleItems.some((item) => item.id === "sales-order-flow")
    );
  });
});

describe("salesOrderFlowUi", () => {
  it("protege pelo recurso canônico ou fallback legado", () => {
    assert.equal(
      canViewSalesOrderFlow({
        canPerformAction: (resource, action) =>
          resource === COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow &&
          action === "view",
      }),
      true
    );
    assert.equal(
      canViewSalesOrderFlow({
        hasPermission: (permission) =>
          permission === "sales_orders.flow.view",
      }),
      true
    );
    assert.equal(canViewSalesOrderFlow({}), false);
  });

  it("classifica erros de lista/resumo", () => {
    assert.equal(
      classifySalesOrderFlowListError(new HttpError(403, "negado")).kind,
      "access_denied"
    );
    assert.equal(
      classifySalesOrderFlowListError(new HttpError(404, "missing")).kind,
      "feature_disabled"
    );
    assert.equal(
      classifySalesOrderFlowListError(new HttpError(503, "down")).kind,
      "api_unavailable"
    );
    assert.equal(SALES_ORDER_FLOW_BREADCRUMB, "Comercial / Fluxo de Pedidos");
  });
});

describe("salesOrderFlowClient", () => {
  it("expõe paths tipados e monta query string", () => {
    assert.equal(
      SALES_ORDER_FLOW_SUMMARY_API_PATH,
      "/api/commercial/sales-order-flow/summary"
    );
    assert.equal(
      SALES_ORDER_FLOW_LIST_API_PATH,
      "/api/commercial/sales-order-flow"
    );
    assert.equal(
      SALES_ORDER_FLOW_FEATURE_STATUS_API_PATH,
      "/api/commercial/sales-order-flow/feature-status"
    );
    assert.equal(
      buildSalesOrderFlowQueryString({
        q: "  ABC  ",
        overdue: true,
        stages: ["WAITING_RELEASE", "CANCELED"],
        limit: 20,
      }),
      "?q=ABC&overdue=true&stages=WAITING_RELEASE%2CCANCELED&limit=20"
    );
  });

  it("módulo shell cobre estados básicos", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    assert.match(mod, /sales-order-flow-module/);
    assert.match(mod, /sales-order-flow-breadcrumb/);
    assert.match(mod, /sales-order-flow-denied/);
    assert.match(mod, /sales-order-flow-loading/);
    assert.match(mod, /sales-order-flow-empty/);
    assert.match(mod, /sales-order-flow-feature-disabled/);
    assert.doesNotMatch(mod, /\bDrawer\b|KanbanColumn/);
  });
});

describe("sales order flow filters (OP-65)", () => {
  it("expõe barra de filtros, limpeza e debounce", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    assert.match(mod, /sales-order-flow-filters/);
    assert.match(mod, /sales-order-flow-filter-q/);
    assert.match(mod, /sales-order-flow-filter-customer/);
    assert.match(mod, /sales-order-flow-filter-seller/);
    assert.match(mod, /sales-order-flow-filter-company/);
    assert.match(mod, /sales-order-flow-filter-stage/);
    assert.match(mod, /sales-order-flow-filter-issue-from/);
    assert.match(mod, /sales-order-flow-filter-issue-to/);
    assert.match(mod, /sales-order-flow-filter-promised-from/);
    assert.match(mod, /sales-order-flow-filter-promised-to/);
    assert.match(mod, /sales-order-flow-filter-overdue/);
    assert.match(mod, /sales-order-flow-filter-blocked/);
    assert.match(mod, /sales-order-flow-filter-inconsistent/);
    assert.match(mod, /sales-order-flow-filter-partially-shipped/);
    assert.match(mod, /sales-order-flow-filter-with-cut/);
    assert.match(mod, /sales-order-flow-filter-with-active-residual/);
    assert.match(mod, /sales-order-flow-filter-priority/);
    assert.match(mod, /sales-order-flow-filter-product/);
    assert.match(mod, /sales-order-flow-filter-sector/);
    assert.match(mod, /sales-order-flow-clear-filters/);
    assert.match(mod, /CustomerAutocompleteFilter/);
    assert.match(mod, /getSalesOrderSellerFilterOptionsUrl/);
    assert.match(mod, /SALES_ORDER_FLOW_SEARCH_DEBOUNCE_MS/);
    assert.match(mod, /useSearchParams/);
    assert.match(mod, /setSearchParams\(next, \{ replace: true \}\)/);
    assert.match(mod, /fetchSalesOrderFlowSummary/);
    assert.match(mod, /fetchSalesOrderFlowList/);
    assert.match(mod, /Promise\.all/);
    assert.equal(SALES_ORDER_FLOW_SEARCH_DEBOUNCE_MS, 300);
  });

  it("normaliza URL inválida com segurança", () => {
    const parsed = parseSalesOrderFlowFiltersFromSearchParams(
      new URLSearchParams(
        "q=abc&priority=NOPE&stages=WAITING_RELEASE,FOO,CANCELED&overdue=maybe&issueFrom=not-a-date&issueTo=2026-01-15T12:00:00.000Z&blocked=1"
      )
    );
    assert.equal(parsed.q, "abc");
    assert.equal(parsed.priority, null);
    assert.deepEqual(parsed.stages, ["WAITING_RELEASE", "CANCELED"]);
    assert.equal(parsed.overdue, null);
    assert.equal(parsed.issueFrom, "");
    assert.equal(parsed.issueTo, "2026-01-15");
    assert.equal(parsed.blocked, true);
    assert.equal(parseSalesOrderFlowPriorityParam("urgent"), "URGENT");
    assert.equal(parseSalesOrderFlowBooleanParam("false"), false);
    assert.deepEqual(parseSalesOrderFlowStagesParam("in_production"), [
      "IN_PRODUCTION",
    ]);
  });

  it("serializa filtros canônicos e limpa estado vazio", () => {
    const params = buildSalesOrderFlowSearchParams({
      ...EMPTY_SALES_ORDER_FLOW_FILTERS,
      q: "  PV-1  ",
      overdue: true,
      blocked: false,
      priority: "HIGH",
      stages: ["WAITING_NFE"],
      issueFrom: "2026-01-01",
      issueTo: "2026-01-31",
    });
    assert.equal(params.get("q"), "PV-1");
    assert.equal(params.get("overdue"), "true");
    assert.equal(params.get("blocked"), null);
    assert.equal(params.get("priority"), "HIGH");
    assert.equal(params.get("stages"), "WAITING_NFE");
    assert.equal(params.get("issueFrom"), "2026-01-01");
    assert.equal(
      buildSalesOrderFlowSearchParams(EMPTY_SALES_ORDER_FLOW_FILTERS).toString(),
      ""
    );
    assert.equal(hasActiveSalesOrderFlowFilters(EMPTY_SALES_ORDER_FLOW_FILTERS), false);
    assert.equal(
      hasActiveSalesOrderFlowFilters({
        ...EMPTY_SALES_ORDER_FLOW_FILTERS,
        overdue: true,
      }),
      true
    );
  });

  it("detecta intervalos inválidos e monta query de cliente", () => {
    assert.equal(
      areSalesOrderFlowFilterDateRangesInvalid({
        issueFrom: "2026-02-01",
        issueTo: "2026-01-01",
        promisedFrom: "",
        promisedTo: "",
      }),
      true
    );
    assert.equal(
      areSalesOrderFlowFilterDateRangesInvalid({
        issueFrom: "2026-01-01",
        issueTo: "2026-02-01",
        promisedFrom: "2026-03-01",
        promisedTo: "2026-03-01",
      }),
      false
    );
    const query = salesOrderFlowFiltersToClientQuery({
      ...EMPTY_SALES_ORDER_FLOW_FILTERS,
      q: "x",
      customerId: "cust-1",
      sellerKey: "seller:1",
      stages: ["WAITING_RELEASE"],
      withActiveResidual: true,
    });
    assert.equal(query.q, "x");
    assert.equal(query.customerId, "cust-1");
    assert.equal(query.sellerKey, "seller:1");
    assert.deepEqual(query.stages, ["WAITING_RELEASE"]);
    assert.equal(query.withActiveResidual, true);
  });

  it("preserva filtros na URL ao recarregar (round-trip)", () => {
    const original = {
      ...EMPTY_SALES_ORDER_FLOW_FILTERS,
      q: "pedido",
      company: "KOPPETEL",
      product: "inj",
      sector: "auto",
      customerId: "c1",
      sellerKey: "s1",
      issueFrom: "2026-01-01",
      issueTo: "2026-01-31",
      promisedFrom: "2026-02-01",
      promisedTo: "2026-02-28",
      overdue: true,
      inconsistent: true,
      priority: "URGENT" as const,
      stages: ["IN_PRODUCTION" as const],
    };
    const restored = parseSalesOrderFlowFiltersFromSearchParams(
      buildSalesOrderFlowSearchParams(original)
    );
    assert.deepEqual(restored, original);
  });

  it("empty com filtros ativos tem testid dedicado", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    assert.match(mod, /sales-order-flow-empty-filters/);
    assert.match(mod, /sales-order-flow-date-range-invalid/);
  });
});

describe("sales order flow indicators (OP-66)", () => {
  const summary = {
    valuesVisible: true,
    inconsistenciesVisible: true,
    columns: [
      {
        stage: "WAITING_RELEASE" as const,
        label: "Aguardando liberação",
        isCanceledColumn: false,
        orderCount: 3,
        orderValue: 1_000,
        activeResidualValue: 600,
      },
      {
        stage: "IN_PRODUCTION" as const,
        label: "Em produção",
        isCanceledColumn: false,
        orderCount: 2,
        orderValue: 2_000,
        activeResidualValue: 800,
      },
      {
        stage: "SHIPPED_COMPLETED" as const,
        label: "Enviado / concluído",
        isCanceledColumn: false,
        orderCount: 4,
        orderValue: 4_000,
        activeResidualValue: 0,
      },
      {
        stage: "CANCELED" as const,
        label: "Cancelado",
        isCanceledColumn: true,
        orderCount: 1,
        orderValue: 500,
        activeResidualValue: 0,
      },
    ],
  };

  const list = {
    inconsistenciesVisible: true,
    columns: [
      {
        stage: "WAITING_RELEASE" as const,
        total: 3,
        totals: {
          overdueCount: 2,
          blockedCount: 1,
          inconsistentCount: 1,
          partiallyShippedCount: 0,
          withCutCount: 0,
        },
      },
      {
        stage: "IN_PRODUCTION" as const,
        total: 2,
        totals: {
          overdueCount: 1,
          blockedCount: 0,
          inconsistentCount: 1,
          partiallyShippedCount: 1,
          withCutCount: 1,
        },
      },
      {
        stage: "SHIPPED_COMPLETED" as const,
        total: 4,
        totals: {
          overdueCount: 0,
          blockedCount: 0,
          inconsistentCount: 0,
          partiallyShippedCount: 2,
          withCutCount: 1,
        },
      },
      {
        stage: "CANCELED" as const,
        total: 1,
        totals: {
          overdueCount: 0,
          blockedCount: 0,
          inconsistentCount: 0,
          partiallyShippedCount: 0,
          withCutCount: 0,
        },
      },
    ],
  };

  it("deriva os sete indicadores dos payloads já filtrados", () => {
    const result = resolveSalesOrderFlowExecutiveIndicators(summary, list);
    assert.equal(result.activeOrderCount, 5);
    assert.equal(result.processValue, 3_000);
    assert.equal(result.activeResidualValue, 1_400);
    assert.equal(result.overdueCount, 3);
    assert.equal(result.blockedCount, 1);
    assert.equal(result.inconsistentCount, 2);
    assert.equal(result.partiallyShippedCount, 3);
    assert.equal(result.columns.length, 4);
  });

  it("respeita filtro de etapa usando somente colunas retornadas pela lista", () => {
    const result = resolveSalesOrderFlowExecutiveIndicators(summary, {
      ...list,
      columns: [list.columns[1]!],
    });
    assert.equal(result.activeOrderCount, 2);
    assert.equal(result.processValue, 2_000);
    assert.equal(result.activeResidualValue, 800);
    assert.equal(result.columns[0]?.stage, "IN_PRODUCTION");
  });

  it("oculta valores e inconsistências sem permissão", () => {
    const result = resolveSalesOrderFlowExecutiveIndicators(
      {
        ...summary,
        valuesVisible: false,
        inconsistenciesVisible: false,
        columns: summary.columns.map((column) => ({
          ...column,
          orderValue: null,
          activeResidualValue: null,
        })),
      },
      {
        ...list,
        inconsistenciesVisible: false,
        columns: list.columns.map((column) => ({
          ...column,
          totals: { ...column.totals, inconsistentCount: null },
        })),
      }
    );
    assert.equal(result.processValue, null);
    assert.equal(result.activeResidualValue, null);
    assert.equal(result.inconsistentCount, null);
    assert.equal(result.columns[0]?.orderValue, null);
  });

  it("mantém zeros explícitos no estado vazio", () => {
    const result = resolveSalesOrderFlowExecutiveIndicators(
      { valuesVisible: true, inconsistenciesVisible: true, columns: [] },
      { inconsistenciesVisible: true, columns: [] }
    );
    assert.deepEqual(
      {
        active: result.activeOrderCount,
        value: result.processValue,
        residual: result.activeResidualValue,
        overdue: result.overdueCount,
        blocked: result.blockedCount,
        inconsistent: result.inconsistentCount,
        partial: result.partiallyShippedCount,
      },
      {
        active: 0,
        value: 0,
        residual: 0,
        overdue: 0,
        blocked: 0,
        inconsistent: 0,
        partial: 0,
      }
    );
  });

  it("reutiliza chamadas existentes, skeleton e erro sem limpar dados", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    assert.match(mod, /SystemTotalizerCard/);
    assert.match(mod, /SummaryKpiGrid/);
    assert.match(mod, /sales-order-flow-indicators/);
    assert.match(mod, /sales-order-flow-column-headers/);
    assert.match(mod, /loading=\{indicatorsLoading\}/);
    assert.match(mod, /Promise\.all\(\[/);
    assert.equal(
      (mod.match(/fetchSalesOrderFlowSummary\(query/g) ?? []).length,
      1
    );
    assert.equal(
      (mod.match(/fetchSalesOrderFlowList\(query/g) ?? []).length,
      1
    );
    assert.match(mod, /Mantém o último Kanban\/indicadores válidos/);
  });
});
