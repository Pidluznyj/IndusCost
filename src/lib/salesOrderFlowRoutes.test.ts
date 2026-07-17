import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { COMMERCIAL_RESOURCE_KEYS } from "./commercialAccess.js";
import { registerSalesOrderFlowRoutes } from "./salesOrderFlowRoutes.js";
import { SALES_ORDER_FLOW_ENABLED_ENV } from "./sales/salesOrderFlowFeatureFlags.js";

describe("salesOrderFlowRoutes (OP-59)", () => {
  it("registra summary com flag + requireResource commercial.sales_orders", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/salesOrderFlowRoutes.ts"),
      "utf8"
    );
    assert.match(source, /\/api\/commercial\/sales-order-flow\/summary/);
    assert.match(source, /requireSalesOrderFlowEnabled/);
    assert.match(source, /requireAppAuth/);
    assert.match(
      source,
      /requireResource\(\s*COMMERCIAL_RESOURCE_KEYS\.salesOrders/
    );
    assert.match(source, /resolveSalesOrderFlowAccessScope/);
    assert.match(source, /canViewSalesOrderFlowMonetaryValues/);
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.salesOrders,
      "commercial.sales_orders"
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
  });

  it("bloqueia com 404 quando feature flag ausente", async () => {
    let path = "";
    let middlewares: Array<(req: unknown, res: unknown, next: () => void) => unknown> = [];

    const app = {
      get(routePath: string, ...handlers: Array<(req: unknown, res: unknown, next: () => void) => unknown>) {
        path = routePath;
        middlewares = handlers.slice(0, -1);
      },
    };

    registerSalesOrderFlowRoutes(app as never, {
      requireAppAuth: (_req, _res, next) => next(),
      requireResource: () => (_req, _res, next) => next(),
      getCurrentAppUser: async () => null,
    });

    assert.equal(path, "/api/commercial/sales-order-flow/summary");

    const previous = process.env[SALES_ORDER_FLOW_ENABLED_ENV];
    delete process.env[SALES_ORDER_FLOW_ENABLED_ENV];
    try {
      let statusCode = 0;
      let payload: unknown;
      await new Promise<void>((resolve) => {
        middlewares[0]!({}, {
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(value: unknown) {
            payload = value;
            resolve();
            return this;
          },
        }, () => resolve());
      });
      assert.equal(statusCode, 404);
      assert.deepEqual(payload, { error: "API route not found" });
    } finally {
      if (previous === undefined) delete process.env[SALES_ORDER_FLOW_ENABLED_ENV];
      else process.env[SALES_ORDER_FLOW_ENABLED_ENV] = previous;
    }
  });
});
