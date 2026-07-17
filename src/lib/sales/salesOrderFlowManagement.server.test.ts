import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySalesOrderFlowManagement } from "./salesOrderFlowManagement.server.js";
import type { SalesOrderFlowManagementDb } from "./salesOrderFlowManagement.server.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTOR_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UPDATED_AT = new Date("2026-07-17T12:00:00.000Z");

type ManagementRow = {
  id: string;
  salesOrderId: string;
  priority: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  responsibleArea: string | null;
  isBlocked: boolean;
  blockReason: string | null;
  reason: string | null;
  expectedResolutionAt: Date | null;
  internalNote: string | null;
  updatedAt: Date;
  createdAt: Date;
};

function createDb(options?: {
  missingOrder?: boolean;
  customerId?: string;
  existing?: ManagementRow | null;
  activeUser?: boolean;
  userExists?: boolean;
  forceConflictOnUpdate?: boolean;
}) {
  const customerId = options?.customerId ?? CUSTOMER_ID;
  let management = options?.existing === undefined ? null : options.existing;
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let updateManyCalls = 0;

  const api = {
    salesOrder: {
      findUnique: async () =>
        options?.missingOrder ? null : { id: ORDER_ID, customerId },
    },
    appUser: {
      findUnique: async () => {
        if (options?.userExists === false) return null;
        return {
          id: USER_ID,
          name: "User Login",
          isActive: options?.activeUser !== false,
          person: { displayName: "Ana Person", socialName: null },
          employee: { name: "Ana Emp", socialName: null },
        };
      },
    },
    salesOrderFlowManagement: {
      findUnique: async () => management,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (management) {
          const err = new Error("Unique") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        management = {
          id: "m1",
          salesOrderId: ORDER_ID,
          priority: String(data.priority ?? "NORMAL"),
          responsibleUserId: (data.responsibleUserId as string | null) ?? null,
          responsibleName: (data.responsibleName as string | null) ?? null,
          responsibleArea: (data.responsibleArea as string | null) ?? null,
          isBlocked: Boolean(data.isBlocked),
          blockReason: (data.blockReason as string | null) ?? null,
          reason: (data.reason as string | null) ?? null,
          expectedResolutionAt:
            (data.expectedResolutionAt as Date | null) ?? null,
          internalNote: (data.internalNote as string | null) ?? null,
          updatedAt: new Date("2026-07-17T13:00:00.000Z"),
          createdAt: new Date("2026-07-17T13:00:00.000Z"),
        };
        return management;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { salesOrderId: string; updatedAt: Date };
        data: Record<string, unknown>;
      }) => {
        updateManyCalls += 1;
        if (
          options?.forceConflictOnUpdate ||
          !management ||
          management.updatedAt.getTime() !== where.updatedAt.getTime()
        ) {
          return { count: 0 };
        }
        management = {
          ...management,
          ...data,
          updatedAt: new Date("2026-07-17T14:00:00.000Z"),
        } as ManagementRow;
        return { count: 1 };
      },
    },
    salesOrderFlowEvent: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `e-${events.length + 1}`, ...data };
        events.push(row);
        return { id: row.id };
      },
    },
    commercialAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return { id: `a-${audits.length}` };
      },
    },
    $transaction: async <T>(fn: (tx: typeof api) => Promise<T>) => fn(api),
    _state: {
      get management() {
        return management;
      },
      events,
      audits,
      get updateManyCalls() {
        return updateManyCalls;
      },
    },
  };

  return api as unknown as SalesOrderFlowManagementDb & {
    _state: {
      management: ManagementRow | null;
      events: Array<Record<string, unknown>>;
      audits: Array<Record<string, unknown>>;
      updateManyCalls: number;
    };
  };
}

describe("applySalesOrderFlowManagement (OP-62)", () => {
  it("cria overlay com prioridade e registra auditoria/evento", async () => {
    const db = createDb();
    const result = await applySalesOrderFlowManagement({
      prisma: db,
      salesOrderId: ORDER_ID,
      body: { expectedUpdatedAt: null, priority: "HIGH" },
      actor: { id: ACTOR_ID, name: "Gestor" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.management.priority, "HIGH");
    assert.ok(result.payload.eventId);
    assert.equal(db._state.events[0]?.eventType, "MANAGEMENT_UPDATED");
    assert.ok(
      db._state.audits.some((a) => a.action === "SET_PRIORITY")
    );
    const details = db._state.events[0]?.payloadJson as {
      before: { priority: string };
      after: { priority: string };
    };
    assert.equal(details.before.priority, "NORMAL");
    assert.equal(details.after.priority, "HIGH");
  });

  it("atribui responsável ativo e rejeita pessoa inválida", async () => {
    const okDb = createDb();
    const ok = await applySalesOrderFlowManagement({
      prisma: okDb,
      salesOrderId: ORDER_ID,
      body: {
        expectedUpdatedAt: null,
        responsibleUserId: USER_ID,
        responsibleArea: "PCP",
      },
      actor: { id: ACTOR_ID, name: "Gestor" },
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.payload.management.responsibleName, "Ana Person");
    assert.equal(ok.payload.management.responsibleArea, "PCP");

    const badDb = createDb({ userExists: false });
    const bad = await applySalesOrderFlowManagement({
      prisma: badDb,
      salesOrderId: ORDER_ID,
      body: { expectedUpdatedAt: null, responsibleUserId: USER_ID },
      actor: { id: ACTOR_ID, name: "Gestor" },
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "INVALID_RESPONSIBLE");
  });

  it("remove bloqueio preservando histórico em auditoria", async () => {
    const existing: ManagementRow = {
      id: "m1",
      salesOrderId: ORDER_ID,
      priority: "NORMAL",
      responsibleUserId: null,
      responsibleName: null,
      responsibleArea: null,
      isBlocked: true,
      blockReason: "Crédito",
      reason: null,
      expectedResolutionAt: new Date("2026-07-20T00:00:00Z"),
      internalNote: "nota viva",
      updatedAt: UPDATED_AT,
      createdAt: UPDATED_AT,
    };
    const db = createDb({ existing });
    const result = await applySalesOrderFlowManagement({
      prisma: db,
      salesOrderId: ORDER_ID,
      body: {
        expectedUpdatedAt: UPDATED_AT.toISOString(),
        isBlocked: false,
      },
      actor: { id: ACTOR_ID, name: "Gestor" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.management.isBlocked, false);
    assert.equal(result.payload.management.blockReason, null);
    assert.equal(result.payload.management.internalNote, "nota viva");
    assert.ok(
      db._state.audits.some((a) => a.action === "REMOVE_BLOCK")
    );
    const details = db._state.events[0]?.payloadJson as {
      before: { isBlocked: boolean; blockReason: string };
      after: { isBlocked: boolean; blockReason: null };
    };
    assert.equal(details.before.isBlocked, true);
    assert.equal(details.before.blockReason, "Crédito");
    assert.equal(details.after.isBlocked, false);
  });

  it("concorrência: expectedUpdatedAt divergente → 409", async () => {
    const existing: ManagementRow = {
      id: "m1",
      salesOrderId: ORDER_ID,
      priority: "NORMAL",
      responsibleUserId: null,
      responsibleName: null,
      responsibleArea: null,
      isBlocked: false,
      blockReason: null,
      reason: null,
      expectedResolutionAt: null,
      internalNote: null,
      updatedAt: UPDATED_AT,
      createdAt: UPDATED_AT,
    };
    const db = createDb({ existing });
    const result = await applySalesOrderFlowManagement({
      prisma: db,
      salesOrderId: ORDER_ID,
      body: {
        expectedUpdatedAt: "2026-07-17T11:00:00.000Z",
        priority: "URGENT",
      },
      actor: { id: ACTOR_ID, name: "Gestor" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "MANAGEMENT_UPDATE_CONFLICT");
    assert.equal(db._state.updateManyCalls, 0);
  });

  it("escopo comercial: pedido fora da carteira → 403", async () => {
    const db = createDb();
    const result = await applySalesOrderFlowManagement({
      prisma: db,
      salesOrderId: ORDER_ID,
      body: { expectedUpdatedAt: null, priority: "HIGH" },
      actor: { id: ACTOR_ID, name: "Gestor" },
      scopeCustomerIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 403);
    assert.equal(result.body.code, "SALES_ORDER_FLOW_SCOPE_DENIED");
  });

  it("pedido inexistente → 404", async () => {
    const db = createDb({ missingOrder: true });
    const result = await applySalesOrderFlowManagement({
      prisma: db,
      salesOrderId: ORDER_ID,
      body: { expectedUpdatedAt: null, priority: "HIGH" },
      actor: { id: ACTOR_ID, name: "Gestor" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
  });
});
