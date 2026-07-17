import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { COMMERCIAL_RESOURCE_KEYS } from "./commercialAccess.js";
import { registerSalesOrderFlowRoutes } from "./salesOrderFlowRoutes.js";
import { SALES_ORDER_FLOW_ENABLED_ENV } from "./sales/salesOrderFlowFeatureFlags.js";

describe("salesOrderFlowRoutes (OP-59/OP-63)", () => {
  it("registra summary, lista, detalhe, events e management", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/salesOrderFlowRoutes.ts"),
      "utf8"
    );
    assert.match(source, /\/api\/commercial\/sales-order-flow\/summary/);
    assert.match(source, /\/api\/commercial\/sales-order-flow\/feature-status/);
    assert.match(source, /\/api\/commercial\/sales-order-flow"/);
    assert.match(source, /\/api\/commercial\/sales-order-flow\/:salesOrderId\/events/);
    assert.match(source, /\/api\/commercial\/sales-order-flow\/:salesOrderId"/);
    assert.match(
      source,
      /\/api\/commercial\/sales-order-flow\/:salesOrderId\/management/
    );
    assert.match(source, /requireSalesOrderFlowEnabled/);
    assert.match(source, /loadSalesOrderFlowDetail/);
    assert.match(source, /loadSalesOrderFlowEvents/);
    assert.match(source, /applySalesOrderFlowManagement/);
    assert.match(source, /salesOrdersFlowManagement/);
    assert.match(source, /resolveSalesOrderFlowCapabilities/);
    assert.match(source, /salesOrdersFlowTimeline/);
    assert.match(
      source,
      /\/api\/commercial\/sales-order-flow\/lookup\/responsible-users/
    );
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.salesOrders,
      "commercial.sales_orders"
    );
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowManagement,
      "commercial.sales_orders.flow_management"
    );
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
      "commercial.sales_orders.flow"
    );
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowTimeline,
      "commercial.sales_orders.flow.timeline"
    );
  });

  it("está registrado no server e no piloto comercial", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const access = readFileSync(
      join(process.cwd(), "src/lib/commercialAccess.ts"),
      "utf8"
    );
    assert.match(server, /registerSalesOrderFlowRoutes/);
    assert.match(access, /\/api\/commercial\/sales-order-flow\/summary/);
    assert.match(access, /\/api\/commercial\/sales-order-flow"/);
    assert.match(access, /\/api\/commercial\/sales-order-flow\/:salesOrderId"/);
    assert.match(
      access,
      /\/api\/commercial\/sales-order-flow\/:salesOrderId\/events/
    );
    assert.match(
      access,
      /\/api\/commercial\/sales-order-flow\/:salesOrderId\/management/
    );
  });

  it("PATCH management exige manage além de view", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/salesOrderFlowRoutes.ts"),
      "utf8"
    );
    assert.match(
      source,
      /salesOrdersFlowManagement[\s\S]*COMMERCIAL_ACTIONS\.manage/
    );
    assert.match(
      source,
      /app\.patch\(\s*"\/api\/commercial\/sales-order-flow\/:salesOrderId\/management"/
    );
    assert.match(source, /resolveSalesOrderFlowManagementRequirements/);
  });

  it("APIs usam recursos granulares oficiais", () => {
    const required: Array<{ resourceKey: string; action: string }> = [];
    const app = {
      get() {},
      patch() {},
    };
    registerSalesOrderFlowRoutes(app as never, {
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: (resourceKey, action = "view") => {
        required.push({ resourceKey, action });
        return (_req, _res, next) => next();
      },
      authorizeResource: async () =>
        ({ ok: true, resourceKey: "test", action: "view", source: "SUPER_ADMIN" }) as never,
      getCurrentAppUser: async () => null,
    });

    assert.ok(
      required.some(
        (entry) =>
          entry.resourceKey === "commercial.sales_orders.flow" &&
          entry.action === "view"
      )
    );
    assert.ok(
      required.some(
        (entry) =>
          entry.resourceKey === "commercial.sales_orders.flow.timeline" &&
          entry.action === "view"
      )
    );
    assert.ok(
      required.some(
        (entry) =>
          entry.resourceKey ===
            "commercial.sales_orders.flow_management" &&
          entry.action === "manage"
      )
    );
  });

  it("bloqueia com 404 quando feature flag ausente", async () => {
    const routes = new Map<
      string,
      Array<(req: unknown, res: unknown, next: () => void) => unknown>
    >();

    const app = {
      get(
        routePath: string,
        ...handlers: Array<(req: unknown, res: unknown, next: () => void) => unknown>
      ) {
        routes.set(routePath, handlers.slice(0, -1));
      },
      patch(
        routePath: string,
        ...handlers: Array<(req: unknown, res: unknown, next: () => void) => unknown>
      ) {
        routes.set(routePath, handlers.slice(0, -1));
      },
    };

    registerSalesOrderFlowRoutes(app as never, {
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: () => (_req, _res, next) => next(),
      authorizeResource: async () =>
        ({ ok: true, resourceKey: "test", action: "view", source: "SUPER_ADMIN" }) as never,
      getCurrentAppUser: async () => null,
    });

    assert.ok(routes.has("/api/commercial/sales-order-flow/summary"));
    assert.ok(routes.has("/api/commercial/sales-order-flow/feature-status"));
    assert.ok(routes.has("/api/commercial/sales-order-flow"));
    assert.ok(
      routes.has("/api/commercial/sales-order-flow/:salesOrderId/management")
    );

    const previous = process.env[SALES_ORDER_FLOW_ENABLED_ENV];
    delete process.env[SALES_ORDER_FLOW_ENABLED_ENV];
    try {
      for (const path of [
        "/api/commercial/sales-order-flow/summary",
        "/api/commercial/sales-order-flow",
        "/api/commercial/sales-order-flow/:salesOrderId/management",
      ]) {
        let statusCode = 0;
        const handlers = routes.get(path) ?? [];
        const first = handlers[0];
        assert.ok(first, path);
        first(
          {},
          {
            status(code: number) {
              statusCode = code;
              return {
                json() {
                  return undefined;
                },
              };
            },
          },
          () => {
            statusCode = 200;
          }
        );
        assert.equal(statusCode, 404, path);
      }

      let featureStatusCode = 0;
      const featureHandlers =
        routes.get("/api/commercial/sales-order-flow/feature-status") ?? [];
      const featureFirst = featureHandlers[0];
      assert.ok(featureFirst);
      featureFirst(
        {},
        {
          status(code: number) {
            featureStatusCode = code;
            return {
              json() {
                return undefined;
              },
            };
          },
          json() {
            featureStatusCode = 200;
          },
        },
        () => {
          featureStatusCode = 200;
        }
      );
      assert.notEqual(featureStatusCode, 404);
    } finally {
      if (previous === undefined) delete process.env[SALES_ORDER_FLOW_ENABLED_ENV];
      else process.env[SALES_ORDER_FLOW_ENABLED_ENV] = previous;
    }
  });
});
