import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerSettingsSalesOrderFlowRoutes } from "./settingsSalesOrderFlowRoutes.js";

describe("settingsSalesOrderFlowRoutes (OP-58)", () => {
  it("registra status no recurso admin.settings e sem cache", async () => {
    let path = "";
    let handler: ((req: unknown, res: unknown) => Promise<unknown>) | null = null;
    let guardResource = "";
    let guardAction = "";

    const app = {
      get(
        routePath: string,
        _guard: unknown,
        routeHandler: (req: unknown, res: unknown) => Promise<unknown>
      ) {
        path = routePath;
        handler = routeHandler;
      },
    };

    registerSettingsSalesOrderFlowRoutes(
      app as never,
      {
        requireBootstrapOrResource: (_isBootstrap, resourceKey, action) => {
          guardResource = resourceKey;
          guardAction = action ?? "";
          return (_req, _res, next) => next();
        },
      },
      {
        buildStatus: async () =>
          ({
            feature: {
              resource: "commercial.salesOrderFlow.enabled",
              enabled: false,
              defaultWhenAbsent: false,
            },
          }) as never,
      }
    );

    assert.equal(path, "/api/settings/system/sales-order-flow/status");
    assert.equal(guardResource, "admin.settings");
    assert.equal(guardAction, "view");

    let cacheControl = "";
    let response: unknown;
    await handler!({}, {
      setHeader(name: string, value: string) {
        if (name === "Cache-Control") cacheControl = value;
      },
      json(value: unknown) {
        response = value;
        return value;
      },
    });

    assert.equal(cacheControl, "no-store");
    assert.deepEqual(response, {
      feature: {
        resource: "commercial.salesOrderFlow.enabled",
        enabled: false,
        defaultWhenAbsent: false,
      },
    });
  });
});
