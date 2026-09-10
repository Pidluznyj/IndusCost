import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNomusPurchaseOrdersPath,
  NOMUS_PURCHASE_ORDER_VIEW_PERMISSIONS,
  NOMUS_PURCHASE_ORDERS_PATH,
  PURCHASES_INTERNAL_FALLBACK_PATH,
  resolvePurchasesMenuPath,
  userBagAllowsNomusPurchaseOrders,
} from "./nomusPurchaseOrderAccess.ts";

describe("nomusPurchaseOrderAccess", () => {
  it("reconhece a rota da tela Pedidos Nomus e o detalhe", () => {
    assert.equal(isNomusPurchaseOrdersPath("/purchases/nomus-orders"), true);
    assert.equal(isNomusPurchaseOrdersPath("/purchases/nomus-orders/abc"), true);
    assert.equal(isNomusPurchaseOrdersPath("/purchases/nomus-orders?q=1"), true);
    assert.equal(isNomusPurchaseOrdersPath("/purchases"), false);
    assert.equal(isNomusPurchaseOrdersPath("/purchases/performance"), false);
  });

  it("SUPER_ADMIN vê a tela mesmo com bag vazia", () => {
    assert.equal(userBagAllowsNomusPurchaseOrders({ role: "SUPER_ADMIN", permissions: [] }), true);
    assert.equal(resolvePurchasesMenuPath({ role: "SUPER_ADMIN", permissions: [] }), NOMUS_PURCHASE_ORDERS_PATH);
  });

  it("permissions[] conta mesmo se effectivePermissions vier vazio", () => {
    assert.equal(
      userBagAllowsNomusPurchaseOrders({
        role: "VIEWER",
        permissions: ["purchases.view"],
        effectivePermissions: [],
      }),
      true
    );
  });

  it("DTO/perfil sozinho NÃO libera — só a bag da API", () => {
    assert.equal(userBagAllowsNomusPurchaseOrders({ role: "VIEWER", permissions: [] }), false);
    assert.equal(
      userBagAllowsNomusPurchaseOrders({
        role: "VIEWER",
        permissions: [],
        effectivePermissions: [],
      }),
      false
    );
    assert.equal(
      resolvePurchasesMenuPath({ role: "VIEWER", permissions: [] }),
      PURCHASES_INTERNAL_FALLBACK_PATH
    );
  });

  it("qualquer chave da listagem libera landing Nomus", () => {
    for (const key of NOMUS_PURCHASE_ORDER_VIEW_PERMISSIONS) {
      assert.equal(
        userBagAllowsNomusPurchaseOrders({ role: "VIEWER", permissions: [key] }),
        true,
        key
      );
      assert.equal(
        resolvePurchasesMenuPath({ role: "VIEWER", permissions: [key] }),
        NOMUS_PURCHASE_ORDERS_PATH
      );
    }
  });
});
