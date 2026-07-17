/**
 * OP-77 — Matriz integrada de validação das APIs do Kanban (contratos + loaders).
 * Sem Express/e2e; reutiliza parsers, permissões, flag e loaders mockados.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  isSalesOrderFlowEnabled,
  requireSalesOrderFlowEnabled,
  SALES_ORDER_FLOW_ENABLED_ENV,
} from "./salesOrderFlowFeatureFlags.js";
import { SALES_ORDER_FLOW_RESOURCE_MATRIX } from "./salesOrderFlowPermissions.js";
import { resolveSalesOrderFlowAccessScope } from "./salesOrderFlowAccessScope.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildSalesOrderFlowSummaryPayload,
  parseSalesOrderFlowSummaryQuery,
} from "./salesOrderFlowSummary.js";
import { loadSalesOrderFlowSummary } from "./salesOrderFlowSummary.server.js";
import type { SalesOrderFlowSummaryDb } from "./salesOrderFlowSummary.server.js";
import {
  compareSalesOrderFlowSortRows,
  decodeSalesOrderFlowListCursor,
  encodeSalesOrderFlowListCursor,
  parseSalesOrderFlowListQuery,
  SalesOrderFlowListQueryError,
  type SalesOrderFlowSortRow,
} from "./salesOrderFlowList.js";
import { loadSalesOrderFlowList } from "./salesOrderFlowList.server.js";
import type { SalesOrderFlowListDb } from "./salesOrderFlowList.server.js";
import {
  assertSalesOrderFlowDetailId,
  parseSalesOrderFlowEventsQuery,
  SalesOrderFlowDetailQueryError,
} from "./salesOrderFlowDetail.js";
import {
  applySalesOrderFlowManagementPatch,
  parseSalesOrderFlowManagementPatch,
} from "./salesOrderFlowManagement.js";
import {
  buildSalesOrderFlowRecomputeDraft,
  planSalesOrderFlowRecompute,
} from "./salesOrderFlowRecompute.js";
import { resolveSalesOrderItemFlow } from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import { registerSalesOrderFlowRoutes } from "../salesOrderFlowRoutes.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function makeUser(
  partial: Partial<AppAuthContext> & { role: AppAuthContext["role"] }
): AppAuthContext {
  const permissions = new Set<string>();
  return {
    id: "user-1",
    email: "t@test.com",
    name: "Test",
    role: partial.role,
    permissions: [],
    hasPermission: (key: string) => permissions.has(key),
    hasAnyPermission: (keys: string[]) => keys.some((k) => permissions.has(k)),
    externalSellerId: null,
    sellerIdentityKey: null,
    sellerResponsibleName: null,
    ...partial,
  } as AppAuthContext;
}

describe("salesOrderFlowApiValidationMatrix (OP-77)", () => {
  it("summary: parseia filtros canônicos", () => {
    const parsed = parseSalesOrderFlowSummaryQuery({
      q: " PV 1 ",
      customerId: ORDER_ID,
      atrasado: "true",
      bloqueado: "false",
      inconsistente: "true",
      priority: "HIGH",
    });
    assert.equal(parsed.q, "PV 1");
    assert.equal(parsed.customerId, ORDER_ID);
    assert.equal(parsed.overdue, true);
    assert.equal(parsed.blocked, false);
    assert.equal(parsed.inconsistent, true);
    assert.equal(parsed.priority, "HIGH");
  });

  it("summary: loader agrega e payload oculta valores", async () => {
    const db = {
      salesOrderFlowSnapshot: {
        groupBy: async () => [
          {
            currentStage: "WAITING_RELEASE",
            _count: { _all: 2 },
            _sum: { orderValue: 100, activeResidualValue: 40 },
          },
        ],
        count: async () => 1,
        aggregate: async () => ({
          _max: { computedAt: new Date("2026-07-17T10:00:00Z") },
        }),
      },
    } as unknown as SalesOrderFlowSummaryDb;

    const visible = await loadSalesOrderFlowSummary(
      {},
      {
        prisma: db,
        canViewValues: true,
        resolveSellerWhere: async () => null,
      }
    );
    assert.equal(visible.valuesVisible, true);
    assert.equal(
      visible.columns.find((c) => c.stage === "WAITING_RELEASE")?.orderValue,
      100
    );

    const hidden = buildSalesOrderFlowSummaryPayload({
      filters: parseSalesOrderFlowSummaryQuery({}),
      aggregates: [
        {
          stage: "WAITING_RELEASE",
          orderCount: 2,
          orderValue: 100,
          activeResidualValue: 40,
        },
      ],
      totals: {
        overdueCount: 0,
        blockedCount: 0,
        inconsistentCount: 0,
        partiallyShippedCount: 0,
        completedWithCutCount: 0,
        canceledCount: 0,
      },
      lastUpdatedAt: "2026-07-17T10:00:00.000Z",
      canViewValues: false,
    });
    assert.equal(hidden.valuesVisible, false);
    assert.equal(
      hidden.columns.find((c) => c.stage === "WAITING_RELEASE")?.orderValue,
      null
    );
  });

  it("colunas/listagem: parse stages, limit e cursor cruzado inválido", () => {
    const parsed = parseSalesOrderFlowListQuery({
      stages: "WAITING_NFE",
      limit: "10",
    });
    assert.deepEqual(parsed.stages, ["WAITING_NFE"]);
    assert.equal(parsed.limit, 10);
    const cursor = encodeSalesOrderFlowListCursor({
      stage: "WAITING_NFE",
      afterOrderId: ORDER_ID,
    });
    assert.ok(cursor.length > 0);
    assert.throws(
      () => decodeSalesOrderFlowListCursor(cursor, "WAITING_RELEASE"),
      SalesOrderFlowListQueryError
    );
  });

  it("ordenação: crítica e prioridade antes de datas", () => {
    const critical: SalesOrderFlowSortRow = {
      salesOrderId: "a",
      orderCode: "PV-A",
      issueDate: new Date("2026-06-01"),
      promisedDeliveryAt: new Date("2026-08-01"),
      isOverdue: false,
      priority: "NORMAL",
      stageEnteredAt: new Date("2026-07-01"),
      hasCriticalInconsistency: true,
    };
    const urgent: SalesOrderFlowSortRow = {
      ...critical,
      salesOrderId: "b",
      orderCode: "PV-B",
      hasCriticalInconsistency: false,
      priority: "URGENT",
    };
    const normal: SalesOrderFlowSortRow = {
      ...critical,
      salesOrderId: "c",
      orderCode: "PV-C",
      hasCriticalInconsistency: false,
      priority: "NORMAL",
    };
    assert.ok(compareSalesOrderFlowSortRows(critical, urgent) < 0);
    assert.ok(compareSalesOrderFlowSortRows(urgent, normal) < 0);
  });

  it("paginação: lista carrega página sem N+1 de cards", async () => {
    const fullCalls: string[][] = [];
    const snapshots = [
      {
        salesOrderId: "o1",
        currentStage: "WAITING_RELEASE",
        isOverdue: false,
        promisedDeliveryAt: new Date("2026-08-01"),
        inconsistenciesJson: [],
        badgesJson: [],
        inconsistentItems: 0,
        cutValue: 0,
        bottleneckSalesOrderItemId: null,
        nextAction: "Liberar",
        responsibleArea: "COMERCIAL",
        totalItems: 1,
        activeItems: 1,
        completedItems: 0,
        pendingItems: 1,
        canceledItems: 0,
        progressProductionOrder: 0,
        progressProduced: null,
        progressDocumented: 0,
        progressInvoiced: 0,
        progressShipped: 0,
        orderValue: 50,
        fulfilledValue: 0,
        activeResidualValue: 50,
        canceledValue: 0,
        salesOrder: {
          orderCode: "PD 1",
          issueDate: new Date("2026-06-01"),
          nomusSellerName: "Ana",
          responsible: null,
          companyIssuer: "Laz",
          Customer: { companyName: "Cliente", tradeName: null },
          flowManagement: {
            priority: "NORMAL",
            isBlocked: false,
            blockReason: null,
          },
        },
      },
    ];
    const db = {
      salesOrderFlowSnapshot: {
        findMany: async (args: { where: unknown }) => {
          const whereJson = JSON.stringify(args.where ?? {});
          if (whereJson.includes('"in"')) {
            fullCalls.push(["page"]);
            return snapshots;
          }
          return snapshots;
        },
      },
      salesOrderItemFlowSnapshot: {
        findMany: async () => [],
      },
    } as unknown as SalesOrderFlowListDb;

    const page = await loadSalesOrderFlowList(
      { stages: "WAITING_RELEASE", limit: "20" },
      {
        prisma: db,
        canViewValues: true,
        resolveSellerWhere: async () => null,
      }
    );
    assert.equal(page.columns.length, 1);
    assert.equal(page.columns[0]!.cards.length, 1);
    assert.equal(fullCalls.length, 1);
  });

  it("escopo: SUPER_ADMIN unrestricted; sem acesso comercial 403", async () => {
    const open = await resolveSalesOrderFlowAccessScope(
      makeUser({ role: "SUPER_ADMIN" }),
      { salesOrder: {} as never }
    );
    assert.equal(open.ok, true);
    if (open.ok) assert.equal(open.mode, "unrestricted");

    const denied = await resolveSalesOrderFlowAccessScope(
      makeUser({ role: "VIEWER" }),
      { salesOrder: {} as never }
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.status, 403);
      assert.equal(denied.body.code, "SALES_ORDER_FLOW_SCOPE_DENIED");
    }
  });

  it("permissões: matriz canônica cobre kanban, valores, timeline, manage e rebuild", () => {
    assert.equal(
      SALES_ORDER_FLOW_RESOURCE_MATRIX.kanban.resourceKey,
      "commercial.sales_orders.flow"
    );
    assert.equal(
      SALES_ORDER_FLOW_RESOURCE_MATRIX.values.resourceKey,
      "commercial.sales_orders.flow.values"
    );
    assert.equal(
      SALES_ORDER_FLOW_RESOURCE_MATRIX.timeline.resourceKey,
      "commercial.sales_orders.flow.timeline"
    );
    assert.equal(
      SALES_ORDER_FLOW_RESOURCE_MATRIX.manualUpdate.action,
      "manage"
    );
    assert.equal(SALES_ORDER_FLOW_RESOURCE_MATRIX.rebuild.action, "execute");
    assert.equal(
      SALES_ORDER_FLOW_RESOURCE_MATRIX.rebuild.resourceKey,
      "commercial.sales_orders.flow_rebuild"
    );
  });

  it("detalhe: UUID inválido rejeitado; events parseia page", () => {
    assert.throws(
      () => assertSalesOrderFlowDetailId("not-a-uuid"),
      SalesOrderFlowDetailQueryError
    );
    assert.equal(assertSalesOrderFlowDetailId(ORDER_ID), ORDER_ID);
    const events = parseSalesOrderFlowEventsQuery({
      page: "1",
      pageSize: "25",
      eventType: "STAGE_CHANGED",
    });
    assert.equal(events.page, 1);
    assert.equal(events.pageSize, 25);
    assert.equal(events.eventType, "STAGE_CHANGED");
  });

  it("timeline: rota events exige recurso dedicado", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/salesOrderFlowRoutes.ts"),
      "utf8"
    );
    assert.match(source, /:salesOrderId\/events/);
    assert.match(source, /salesOrdersFlowTimeline/);
    assert.match(source, /loadSalesOrderFlowEvents/);
  });

  it("ações manuais: patch de prioridade e bloqueio", () => {
    const patch = parseSalesOrderFlowManagementPatch({
      priority: "URGENT",
      isBlocked: true,
      blockReason: "Aguardando material",
    });
    assert.equal(patch.priority, "URGENT");
    assert.equal(patch.isBlocked, true);
    const applied = applySalesOrderFlowManagementPatch(
      {
        priority: "NORMAL",
        isBlocked: false,
        blockReason: null,
        responsibleUserId: null,
        responsibleName: null,
        responsibleArea: null,
        reason: null,
        expectedResolutionAt: null,
        internalNote: null,
        updatedAt: new Date("2026-07-17T10:00:00.000Z"),
      },
      patch
    );
    assert.equal(applied.priority, "URGENT");
    assert.equal(applied.isBlocked, true);
    assert.match(applied.blockReason ?? "", /material/i);
  });

  it("feature flag: fail-closed e middleware 404", () => {
    assert.equal(isSalesOrderFlowEnabled({}), false);
    assert.equal(
      isSalesOrderFlowEnabled({ [SALES_ORDER_FLOW_ENABLED_ENV]: "true" }),
      true
    );
    let status = 0;
    const middleware = requireSalesOrderFlowEnabled({});
    middleware(
      {} as never,
      {
        status(code: number) {
          status = code;
          return { json: () => undefined };
        },
      } as never,
      () => {
        throw new Error("não deve avançar");
      }
    );
    assert.equal(status, 404);
  });

  it("recomputação individual: first_run e fingerprint_match", () => {
    const item = resolveSalesOrderItemFlow({
      salesOrderItemId: "i1",
      status: 1,
      statusNormalized: "PENDING",
      orderedQuantity: 1,
    });
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: ORDER_ID,
      referenceDate: "2026-07-17T12:00:00.000Z",
    });
    const draft = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: ORDER_ID,
      itemResults: [item],
      orderResult: order,
      existingItems: [],
      computedAt: new Date("2026-07-17T12:00:00.000Z"),
    });
    const first = planSalesOrderFlowRecompute({
      draft,
      existingOrder: null,
      existingItems: [],
    });
    assert.equal(first.reason, "first_run");
    const second = planSalesOrderFlowRecompute({
      draft,
      existingOrder: {
        currentStage: order.currentStage,
        fingerprint: draft.orderFingerprint,
      },
      existingItems: [...draft.itemFingerprints.entries()].map(
        ([salesOrderItemId, fingerprint]) => ({
          salesOrderItemId,
          currentStage: item.currentStage,
          fingerprint,
          stageEnteredAt: new Date("2026-07-17T12:00:00.000Z"),
        })
      ),
    });
    assert.equal(second.reason, "fingerprint_match");
    assert.equal(second.action, "unchanged");
  });

  it("acesso direto: rotas detail/events/management/recompute registradas", () => {
    const required: Array<{ resourceKey: string; action: string }> = [];
    const paths: string[] = [];
    const app = {
      get(path: string) {
        paths.push(`GET ${path}`);
      },
      patch(path: string) {
        paths.push(`PATCH ${path}`);
      },
      post(path: string) {
        paths.push(`POST ${path}`);
      },
    };
    registerSalesOrderFlowRoutes(app as never, {
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: (resourceKey, action = "view") => {
        required.push({ resourceKey, action });
        return (_req, _res, next) => next();
      },
      authorizeResource: async () =>
        ({
          ok: true,
          resourceKey: "test",
          action: "view",
          source: "SUPER_ADMIN",
        }) as never,
      getCurrentAppUser: async () => null,
    });
    assert.ok(paths.some((p) => p.includes("/summary")));
    assert.ok(paths.some((p) => p.includes("/:salesOrderId")));
    assert.ok(paths.some((p) => p.includes("/events")));
    assert.ok(paths.some((p) => p.includes("/management")));
    assert.ok(paths.some((p) => p.includes("/recompute")));
    assert.ok(
      required.some(
        (r) =>
          r.resourceKey === "commercial.sales_orders.flow_rebuild" &&
          r.action === "execute"
      )
    );
  });

  it("valores ocultos: summary payload nullifica money fields", () => {
    const payload = buildSalesOrderFlowSummaryPayload({
      filters: parseSalesOrderFlowSummaryQuery({}),
      aggregates: [
        {
          stage: "SHIPPED_COMPLETED",
          orderCount: 1,
          orderValue: 999,
          activeResidualValue: 0,
        },
      ],
      totals: {
        overdueCount: 0,
        blockedCount: 0,
        inconsistentCount: 0,
        partiallyShippedCount: 0,
        completedWithCutCount: 0,
        canceledCount: 0,
      },
      lastUpdatedAt: null,
      canViewValues: false,
    });
    assert.equal(payload.valuesVisible, false);
    for (const column of payload.columns) {
      assert.equal(column.orderValue, null);
      assert.equal(column.activeResidualValue, null);
    }
  });
});
