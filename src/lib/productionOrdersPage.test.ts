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
  isProductionOrdersDateRangeInvalid,
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
import type {
  ProductionOrderDetailResponse,
  ProductionOrderDetailSalesLink,
} from "@/src/lib/productionOrdersDetail.js";
import {
  ProductionOrderAuditContent,
  buildProductionOrderTechnicalEvidence,
  copyProductionOrderTechnicalEvidence,
  stringifyProductionOrderTechnicalEvidence,
} from "@/src/components/operations/ProductionOrderQuickDetailOverlay.js";

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
    releasedAt: "2026-03-10T12:00:00.000Z",
    plannedAt: "2026-03-12T21:00:00.000Z",
    deliveryAt: "2026-03-15T21:00:00.000Z",
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

function detailLink(
  overrides: Partial<ProductionOrderDetailSalesLink> = {}
): ProductionOrderDetailSalesLink {
  return {
    id: "link-1",
    linkState: "current_resolved",
    isCurrent: true,
    externalSalesOrderId: 2530,
    externalSalesOrderItemId: 11324,
    itemNumber: "10",
    customerName: "Esmaltec S/A",
    linkedQuantity: "15000",
    salesOrderId: "00000000-0000-4000-8000-000000000301",
    salesOrderItemId: "00000000-0000-4000-8000-000000000401",
    orderCode: "PD 02534",
    localItem: {
      id: "00000000-0000-4000-8000-000000000401",
      skuSnapshot: "311.32AA",
      productNameSnapshot: "Produto fixture",
      quantity: "15000",
      unit: "PC",
      nomusItemExternalId: 11324,
      nomusItemSequence: "10",
    },
    firstSeenAt: "2026-03-10T11:15:00.000Z",
    lastSeenAt: "2026-07-16T12:00:00.000Z",
    removedAt: null,
    rawJson: { id: 11324, idPedido: 2530 },
    ...overrides,
  };
}

function detailResponse(
  overrides: Partial<ProductionOrderDetailResponse> = {}
): ProductionOrderDetailResponse {
  return {
    identification: {
      id: "00000000-0000-4000-8000-000000000101",
      externalId: 30347,
      name: "OP 05800 - 003",
      status: "Encerrada",
      tipo: "Injeção",
      priority: "Normal",
    },
    product: {
      externalProductId: 5800,
      productCode: "311.32AA",
      productDescription: "Produto fixture OP 05800",
      productAdditionalInfo: null,
      productConfigId: null,
      productConfigCode: null,
      quantity: "15400",
      unit: "PC",
      stockSector: "PRODUCAO",
    },
    company: { externalCompanyId: 1, companyName: "KOPPETEL" },
    dates: {
      openedAt: "2026-03-10T11:15:00.000Z",
      releasedAt: null,
      plannedAt: "2026-03-12T21:00:00.000Z",
      deliveryAt: null,
      closedAt: "2026-03-12T20:40:22.000Z",
      nomusUpdatedAt: "2026-03-12T20:40:22.000Z",
      firstSeenAt: "2026-03-10T11:15:00.000Z",
      lastSeenAt: "2026-07-16T12:00:00.000Z",
      lastChangedAt: "2026-03-12T20:40:22.000Z",
      syncedAt: "2026-07-16T12:00:00.000Z",
      createdAt: "2026-03-10T11:15:00.000Z",
      updatedAt: "2026-07-16T12:00:00.000Z",
    },
    salesLinks: [detailLink()],
    auditSummary: {
      currentLinkCount: 1,
      removedLinkCount: 0,
      resolvedLinkCount: 1,
      pendingLinkCount: 0,
    },
    payloadHash: "sha256:op-05800",
    rawJson: { id: 30347, nome: "OP 05800 - 003", html: "<script>não executar</script>" },
    ...overrides,
  };
}

function renderAuditContent(detail: ProductionOrderDetailResponse): string {
  const technicalJson = stringifyProductionOrderTechnicalEvidence(detail);
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(ProductionOrderAuditContent, {
        detail,
        technicalJson,
        copyFeedback: null,
        onCopy: () => {},
      })
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
    assert.equal(isProductionOrdersDateRangeInvalid("2026-03-11", "2026-03-10"), true);
    assert.equal(isProductionOrdersDateRangeInvalid("2026-03-10", "2026-03-10"), false);
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
    const appSrc = read("src/App.tsx");
    assert.match(moduleSrc, /production-orders-denied/);
    assert.match(moduleSrc, /production-orders-loading/);
    assert.match(moduleSrc, /production-orders-empty/);
    assert.match(moduleSrc, /production-orders-empty-filters/);
    assert.match(moduleSrc, /production-orders-api-unavailable/);
    assert.match(moduleSrc, /production-orders-grid/);
    assert.match(moduleSrc, /production-orders-status-chips/);
    assert.match(moduleSrc, /PRODUCTION_ORDERS_BREADCRUMB/);
    assert.doesNotMatch(moduleSrc, /PRODUCTION_ORDERS_PAGE_TITLE/);
    assert.doesNotMatch(moduleSrc, /PRODUCTION_ORDERS_PAGE_SUBTITLE/);
    assert.match(appSrc, new RegExp(`title="${PRODUCTION_ORDERS_PAGE_TITLE}"`));
    assert.match(
      appSrc,
      new RegExp(`description="${PRODUCTION_ORDERS_PAGE_SUBTITLE.replace(/\./g, "\\.")}"`)
    );
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

  it("polimento evita request na página antiga e expõe semântica acessível", () => {
    const moduleSrc = read("src/components/operations/ProductionOrdersModule.tsx");
    assert.match(moduleSrc, /nextSearch === search/);
    assert.match(moduleSrc, /setPage\(1\);\s*setSearch\(nextSearch\)/);
    assert.doesNotMatch(
      moduleSrc,
      /useEffect\(\(\) => \{\s*setPage\(1\);\s*\}, \[search, status/
    );
    assert.match(moduleSrc, /role="group"/);
    assert.match(moduleSrc, /aria-pressed=\{selected\}/);
    assert.match(moduleSrc, /aria-busy=\{loading\}/);
    assert.match(moduleSrc, /role="status"/);
    assert.match(moduleSrc, /role="alert"/);
    assert.match(moduleSrc, /<caption className="sr-only">/);
    assert.match(moduleSrc, /Paginação das Ordens de Produção/);
    assert.match(moduleSrc, /focus:ring-2 focus:ring-primary\/20/);
    assert.match(moduleSrc, /dateRangeInvalid/);
    assert.match(moduleSrc, /A data inicial não pode ser posterior/);
    assert.match(moduleSrc, /loading && hasLoadedOnce/);
    assert.match(moduleSrc, /Atualizando…/);
    assert.match(moduleSrc, /!errorMessage \? \(/);
  });

  it("schema possui índices compostos para ordenação e filtros principais", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read(
      "prisma/migrations/20260730130000_production_orders_read_indexes/migration.sql"
    );
    assert.match(schema, /@@index\(\[openedAt, externalId\]\)/);
    assert.match(schema, /@@index\(\[status, openedAt, externalId\]\)/);
    assert.match(schema, /@@index\(\[tipo, openedAt, externalId\]\)/);
    assert.match(migration, /NomusProductionOrder_openedAt_externalId_idx/);
    assert.match(migration, /NomusProductionOrder_status_openedAt_externalId_idx/);
    assert.match(migration, /NomusProductionOrder_tipo_openedAt_externalId_idx/);
  });

  it("rota não expõe mensagem interna de banco no erro 500", () => {
    const routes = read("src/lib/productionOrdersRoutes.ts");
    assert.match(routes, /Não foi possível consultar Ordens de Produção\./);
    assert.doesNotMatch(routes, /res\.status\(500\)[\s\S]{0,200}error\.message/);
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
    assert.match(html, /KOPPETEL/);
    assert.match(html, /PD 02534/);
    assert.match(html, /\/sales-orders\/00000000-0000-4000-8000-000000000301/);
  });

  it("exibe datas normalizadas de abertura, planejada e entrega", () => {
    const html = renderRow(
      gridRow({
        openedAt: "2026-06-23T03:00:00.000Z",
        plannedAt: "2026-06-24T20:00:00.000Z",
        deliveryAt: "2026-07-08T20:00:00.000Z",
        companyName: "02 - KOPPETEL",
      })
    );
    assert.match(html, /02 - KOPPETEL/);
    // formatProductionOrderDateTime — não lê rawJson
    assert.match(html, /23\/06\/2026|23\/06/);
    assert.match(html, /24\/06\/2026|24\/06/);
    assert.match(html, /08\/07\/2026|08\/07/);
  });

  it("preserva decimal pequeno sem arredondar para zero", () => {
    const html = renderRow(gridRow({ quantity: "0.002925", unit: "KG" }));
    assert.match(html, /0,002925 KG/);
    assert.doesNotMatch(html, />0 KG</);
  });

  it("badges representativos mantêm contraste suave por situação", () => {
    assert.match(renderRow(gridRow({ status: "Liberada" })), /bg-sky-50/);
    assert.match(renderRow(gridRow({ status: "Encerrada" })), /bg-emerald-50/);
    assert.match(renderRow(gridRow({ status: "Cancelada" })), /bg-rose-50/);
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

describe("ProductionOrderAuditContent", () => {
  it("renderiza as seis seções e campos executivos completos", () => {
    const html = renderAuditContent(detailResponse());
    for (const section of [
      "Resumo",
      "Produto",
      "Datas",
      "Pedidos de Venda vinculados",
      "Auditoria interna",
      "Dados técnicos do Nomus",
    ]) {
      assert.match(html, new RegExp(section));
    }
    assert.match(html, /OP 05800 - 003/);
    assert.match(html, /15\.400/);
    assert.match(html, /sha256:op-05800/);
  });

  it("OP sem vínculo exibe estado explícito", () => {
    const html = renderAuditContent(
      detailResponse({
        salesLinks: [],
        auditSummary: {
          currentLinkCount: 0,
          removedLinkCount: 0,
          resolvedLinkCount: 0,
          pendingLinkCount: 0,
        },
      })
    );
    assert.match(html, /não possui vínculo de Pedido de Venda/);
  });

  it("um vínculo resolvido mostra pedido, item local e rota oficial", () => {
    const html = renderAuditContent(detailResponse());
    assert.match(html, /Atual/);
    assert.match(html, /PD 02534/);
    assert.match(html, /311\.32AA/);
    assert.match(html, /\/sales-orders\/00000000-0000-4000-8000-000000000301/);
  });

  it("vários vínculos mantêm removido e pendente visíveis", () => {
    const removed = detailLink({
      id: "link-removed",
      linkState: "removed",
      isCurrent: false,
      externalSalesOrderId: 3000,
      externalSalesOrderItemId: 13000,
      removedAt: "2026-07-15T12:00:00.000Z",
    });
    const pending = detailLink({
      id: "link-pending",
      linkState: "current_pending",
      salesOrderId: null,
      salesOrderItemId: null,
      orderCode: null,
      localItem: null,
      externalSalesOrderId: 4000,
      externalSalesOrderItemId: 14000,
    });
    const html = renderAuditContent(
      detailResponse({
        salesLinks: [detailLink(), removed, pending],
        auditSummary: {
          currentLinkCount: 2,
          removedLinkCount: 1,
          resolvedLinkCount: 1,
          pendingLinkCount: 1,
        },
      })
    );
    assert.match(html, /Removido/);
    assert.match(html, /Pendente de resolução local/);
    assert.match(html, /3000/);
    assert.match(html, /4000/);
  });

  it("rawJson fica em accordion fechado, escapado e inclui vínculos", () => {
    const detail = detailResponse();
    const evidence = buildProductionOrderTechnicalEvidence(detail);
    const text = stringifyProductionOrderTechnicalEvidence(detail);
    const html = renderAuditContent(detail);
    assert.equal(evidence.salesLinks.length, 1);
    assert.match(text, /"productionOrder"/);
    assert.match(text, /"salesLinks"/);
    assert.match(html, /Payload original do Nomus/);
    assert.match(html, /Copiar JSON/);
    assert.doesNotMatch(html, /<details[^>]* open/);
    assert.match(html, /&lt;script&gt;não executar&lt;\/script&gt;/);
  });

  it("copiar JSON usa exatamente a evidência técnica sanitizada", async () => {
    let copied = "";
    const detail = detailResponse();
    const returned = await copyProductionOrderTechnicalEvidence(detail, {
      writeText: async (text) => {
        copied = text;
      },
    });
    assert.equal(copied, stringifyProductionOrderTechnicalEvidence(detail));
    assert.equal(returned, copied);
  });

  it("campos nulos relevantes permanecem como travessão", () => {
    const html = renderAuditContent(
      detailResponse({
        identification: {
          ...detailResponse().identification,
          status: null,
          tipo: null,
          priority: null,
        },
        product: {
          ...detailResponse().product,
          productDescription: null,
          productAdditionalInfo: null,
        },
      })
    );
    assert.match(html, /—/);
  });

  it("drawer amplo preserva auditoria completa, fechamento e acessibilidade", () => {
    const drawer = read(
      "src/components/operations/ProductionOrderQuickDetailOverlay.tsx"
    );
    const overlay = read("src/components/ui/overlay/Overlay.tsx");
    assert.match(drawer, /size="xl"/);
    assert.match(drawer, /ml-auto h-full/);
    assert.match(drawer, /max-h-\[calc\(100vh-2rem\)\]/);
    assert.match(drawer, /OverlayTable/);
    assert.match(drawer, /Primeiro registro/);
    assert.match(drawer, /Último registro/);
    assert.match(drawer, /Remoção/);
    assert.match(drawer, /ariaLabelledBy=/);
    assert.match(drawer, /ariaDescribedBy=/);
    assert.match(drawer, /onClose=\{onClose\}/);
    assert.match(drawer, /production-order-detail-loading/);
    assert.match(drawer, /production-order-detail-error/);
    assert.match(drawer, /copyProductionOrderTechnicalEvidence\(detail, navigator\.clipboard\)/);
    assert.match(drawer, /aria-live="polite"/);
    assert.match(overlay, /event\.key === "Escape"/);
    assert.match(overlay, /event\.target === event\.currentTarget/);
    assert.match(overlay, /role="dialog"/);
  });
});
