import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveNestedBreadcrumbSegments } from "./appHeaderBreadcrumbNesting.ts";

describe("appHeaderBreadcrumbNesting", () => {
  it("lista de pedidos não adiciona nest", () => {
    assert.deepEqual(resolveNestedBreadcrumbSegments("/sales-orders"), []);
  });

  it("abas de pedidos", () => {
    assert.deepEqual(resolveNestedBreadcrumbSegments("/sales-orders/result"), [
      { label: "Resultado" },
    ]);
    assert.deepEqual(resolveNestedBreadcrumbSegments("/sales-orders/management"), [
      { label: "Gestão de Pedidos" },
    ]);
  });

  it("estoque e materiais", () => {
    assert.deepEqual(resolveNestedBreadcrumbSegments("/inventory/items"), [
      { label: "Itens" },
    ]);
    assert.deepEqual(resolveNestedBreadcrumbSegments("/materials/market-intelligence"), [
      { label: "Inteligência de Mercado" },
    ]);
  });

  it("comissões: landing sem nest; fechamentos com nest", () => {
    assert.deepEqual(resolveNestedBreadcrumbSegments("/commissions"), []);
    assert.deepEqual(resolveNestedBreadcrumbSegments("/commissions/fechamentos"), [
      { label: "Fechamentos" },
    ]);
  });
});
