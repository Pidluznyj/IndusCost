import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPermissionsTreeFixture,
  buildPermissionsTreeFixtureDecisions,
  collectPermissionTreeIds,
  countPermissionTreeDecisions,
  filterPermissionTreeNodes,
  mapPermissionTreeEffectives,
  resolvePermissionTreeEffective,
  setPermissionTreeDecision,
} from "./index.ts";

describe("permissionsTreeUi — estado puro", () => {
  it("fixture tem módulos → páginas → abas → ações", () => {
    const nodes = buildPermissionsTreeFixture();
    assert.ok(nodes.some((n) => n.kind === "module"));
    const eng = nodes.find((n) => n.id === "engineering");
    assert.ok(eng);
    assert.ok(eng!.children.some((c) => c.kind === "page"));
    const products = eng!.children.find((c) => c.id === "engineering.products");
    assert.ok(products?.children.some((c) => c.kind === "tab"));
    const bom = products!.children.find(
      (c) => c.id === "engineering.products.tab.bom"
    );
    assert.ok(bom?.children.some((c) => c.kind === "action"));
  });

  it("contadores allow/deny/inherit", () => {
    const nodes = buildPermissionsTreeFixture();
    const decisions = buildPermissionsTreeFixtureDecisions();
    const c = countPermissionTreeDecisions(nodes, decisions);
    assert.equal(c.denied, 1);
    assert.equal(c.allowed, 1);
    assert.ok(c.inherited >= 1);
    assert.equal(c.total, collectPermissionTreeIds(nodes).length);
  });

  it("busca por nome filtra árvore", () => {
    const nodes = buildPermissionsTreeFixture();
    const filtered = filterPermissionTreeNodes(nodes, { search: "BOM" });
    assert.ok(filtered.some((n) => n.id === "engineering"));
    assert.ok(!filtered.some((n) => n.id === "dashboard"));
  });

  it("pai com DENY explícito força efetivo denied nos filhos", () => {
    const nodes = buildPermissionsTreeFixture();
    const decisions = setPermissionTreeDecision({}, "finance", "deny");
    const map = mapPermissionTreeEffectives(nodes, decisions);
    assert.equal(map.get("finance"), "denied");
    assert.equal(map.get("finance.suppliers"), "denied");
    assert.equal(map.get("finance.suppliers.view"), "denied");
  });

  it("pai só baseline Negado NÃO bloqueia filho com ALLOW (alinha resolvedor)", () => {
    const nodes = buildPermissionsTreeFixture();
    const decisions = setPermissionTreeDecision({}, "finance.suppliers", "allow");
    const map = mapPermissionTreeEffectives(nodes, decisions);
    // finance herda baseline denied do fixture sem DENY explícito
    assert.equal(map.get("finance"), "denied");
    assert.equal(map.get("finance.suppliers"), "allowed");
  });

  it("resolvePermissionTreeEffective — herdar usa baseline; DENY explícito do pai bloqueia", () => {
    assert.equal(
      resolvePermissionTreeEffective("inherit", "allowed", null),
      "allowed"
    );
    assert.equal(
      resolvePermissionTreeEffective("allow", "denied", null),
      "allowed"
    );
    assert.equal(
      resolvePermissionTreeEffective("inherit", "allowed", "denied", false),
      "allowed"
    );
    assert.equal(
      resolvePermissionTreeEffective("inherit", "allowed", "denied", true),
      "denied"
    );
    assert.equal(
      resolvePermissionTreeEffective("allow", "denied", "denied", true),
      "denied"
    );
  });
});
