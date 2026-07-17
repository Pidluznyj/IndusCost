import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowSalesOrderFlowNavigation,
  isSalesOrderFlowEnabled,
  requireSalesOrderFlowEnabled,
  SALES_ORDER_FLOW_ENABLED_ENV,
  SALES_ORDER_FLOW_FEATURE_RESOURCE,
} from "./salesOrderFlowFeatureFlags.js";

describe("salesOrderFlowFeatureFlags (OP-58)", () => {
  it("ausente ou inválida fica desabilitada (fail closed)", () => {
    assert.equal(isSalesOrderFlowEnabled({}), false);
    assert.equal(
      isSalesOrderFlowEnabled({ [SALES_ORDER_FLOW_ENABLED_ENV]: "" }),
      false
    );
    assert.equal(
      isSalesOrderFlowEnabled({
        [SALES_ORDER_FLOW_ENABLED_ENV]: "unexpected",
      }),
      false
    );
  });

  it("aceita somente valores explícitos de ativação", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", "enabled"]) {
      assert.equal(
        isSalesOrderFlowEnabled({
          [SALES_ORDER_FLOW_ENABLED_ENV]: value,
        }),
        true,
        value
      );
    }
  });

  it("valores explícitos de desligamento permanecem desabilitados", () => {
    for (const value of ["0", "false", "FALSE", "no", "off", "disabled"]) {
      assert.equal(
        isSalesOrderFlowEnabled({
          [SALES_ORDER_FLOW_ENABLED_ENV]: value,
        }),
        false,
        value
      );
    }
  });

  it("guard bloqueia rota com 404 quando ausente/desligada", () => {
    for (const env of [
      {},
      { [SALES_ORDER_FLOW_ENABLED_ENV]: "false" },
    ]) {
      let statusCode = 0;
      let payload: unknown;
      let nextCalled = false;
      const middleware = requireSalesOrderFlowEnabled(env);
      middleware(
        {} as never,
        {
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(value: unknown) {
            payload = value;
            return this;
          },
        } as never,
        () => {
          nextCalled = true;
        }
      );
      assert.equal(statusCode, 404);
      assert.deepEqual(payload, { error: "API route not found" });
      assert.equal(nextCalled, false);
    }
  });

  it("guard libera rota somente quando ligada", () => {
    let nextCalled = false;
    const middleware = requireSalesOrderFlowEnabled({
      [SALES_ORDER_FLOW_ENABLED_ENV]: "true",
    });
    middleware({} as never, {} as never, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("menu exige flag e permissão simultaneamente", () => {
    assert.equal(
      canShowSalesOrderFlowNavigation({
        featureEnabled: true,
        hasSalesOrdersViewAccess: true,
      }),
      true
    );
    assert.equal(
      canShowSalesOrderFlowNavigation({
        featureEnabled: false,
        hasSalesOrdersViewAccess: true,
      }),
      false
    );
    assert.equal(
      canShowSalesOrderFlowNavigation({
        featureEnabled: true,
        hasSalesOrdersViewAccess: false,
      }),
      false
    );
    assert.equal(
      SALES_ORDER_FLOW_FEATURE_RESOURCE,
      "commercial.salesOrderFlow.enabled"
    );
  });
});
