/**
 * PERM-26 — hierarquia oficial MODULE / PAGE / TAB / ACTION.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSION_CONTRACT_RESOURCES } from "./resources.ts";
import {
  getPermissionHierarchyNode,
  inferPermissionHierarchyType,
  isHierarchyParentVisible,
  isHierarchySuperAdminBypass,
  listPermissionHierarchyNodes,
  pageViewDoesNotGrantFullCrud,
  resolveUnknownResourceDeny,
  tabGrantDoesNotBleedToSibling,
  toLegacyResourceStorageType,
  toOfficialHierarchyType,
  toPermissionHierarchyNode,
} from "./resourceHierarchy.ts";
import { buildPermissionContractCatalog } from "./helpers.ts";
import type { PermissionTruthSubject } from "./types.ts";

describe("PERM-26 resource hierarchy types", () => {
  it("mapeia MENU/SUBMENU ↔ MODULE/PAGE", () => {
    assert.equal(toOfficialHierarchyType("MENU"), "MODULE");
    assert.equal(toOfficialHierarchyType("SUBMENU"), "PAGE");
    assert.equal(toOfficialHierarchyType("TAB"), "TAB");
    assert.equal(toOfficialHierarchyType("ACTION"), "ACTION");
    assert.equal(toLegacyResourceStorageType("MODULE"), "MENU");
    assert.equal(toLegacyResourceStorageType("PAGE"), "SUBMENU");
  });

  it("classifica recursos do contrato sem segundo catálogo", () => {
    const engineering = PERMISSION_CONTRACT_RESOURCES.find(
      (r) => r.resourceKey === "engineering"
    )!;
    const products = PERMISSION_CONTRACT_RESOURCES.find(
      (r) => r.resourceKey === "engineering.products"
    )!;
    const bom = PERMISSION_CONTRACT_RESOURCES.find(
      (r) => r.resourceKey === "engineering.products.tab.bom"
    )!;
    const assign = PERMISSION_CONTRACT_RESOURCES.find(
      (r) => r.resourceKey === "commercial.crm.assign_seller"
    );

    assert.equal(inferPermissionHierarchyType(engineering), "MODULE");
    assert.equal(inferPermissionHierarchyType(products), "PAGE");
    assert.equal(inferPermissionHierarchyType(bom), "TAB");
    if (assign) {
      assert.equal(inferPermissionHierarchyType(assign), "ACTION");
    }

    const nodes = listPermissionHierarchyNodes();
    assert.equal(nodes.length, PERMISSION_CONTRACT_RESOURCES.length);
    assert.ok(nodes.every((n) => n.key && n.label && n.type));
    assert.ok(nodes.some((n) => n.type === "MODULE" && n.parentKey === null));
    assert.ok(nodes.some((n) => n.type === "PAGE" && n.route != null));
    assert.ok(nodes.some((n) => n.type === "TAB"));
  });

  it("catálogo normalizado expõe hierarchyType + isActive", () => {
    const catalog = buildPermissionContractCatalog();
    const products = catalog.find((e) => e.resourceKey === "engineering.products");
    assert.ok(products);
    assert.equal(products!.hierarchyType, "PAGE");
    assert.equal(products!.isActive, true);
    assert.ok(products!.supportedActions.includes("view"));
  });

  it("nós têm campos oficiais (key, label, type, parent, route, order, description, isActive)", () => {
    const node = getPermissionHierarchyNode("engineering.materials");
    assert.ok(node);
    assert.equal(node!.type, "PAGE");
    assert.equal(node!.parentKey, "engineering");
    assert.equal(node!.route, "/materials");
    assert.ok(typeof node!.order === "number");
    assert.ok(node!.description.length > 0);
    assert.equal(node!.isActive, true);
    assert.equal(node!.legacyStorageType, "SUBMENU");
  });
});

describe("PERM-26 hierarchy policies", () => {
  it("recurso desconhecido resulta em DENY", () => {
    const subject: PermissionTruthSubject = { role: "ADMIN", baseline: {} };
    assert.equal(
      resolveUnknownResourceDeny(subject, "not.a.real.resource", "view"),
      true
    );
  });

  it("SUPER_ADMIN mantém bypass", () => {
    const subject: PermissionTruthSubject = { role: "SUPER_ADMIN" };
    assert.equal(
      isHierarchySuperAdminBypass(subject, "engineering.products", "view"),
      true
    );
  });

  it("pai visível quando filho permitido (sem conceder view no pai)", () => {
    const subject: PermissionTruthSubject = {
      role: "VIEWER",
      baseline: {},
      overrides: {
        "finance.accounts_payable": { view: "allow" },
      },
    };
    assert.equal(isHierarchyParentVisible(subject, "finance"), true);
    assert.equal(
      pageViewDoesNotGrantFullCrud({
        subject: {
          role: "VIEWER",
          baseline: {
            "engineering.products": { view: true },
          },
        },
        pageKey: "engineering.products",
      }),
      true
    );
  });

  it("acesso a uma aba não concede as demais", () => {
    const subject: PermissionTruthSubject = {
      role: "VIEWER",
      baseline: {},
      overrides: {
        "engineering.products.tab.bom": { view: "allow" },
      },
    };
    assert.equal(
      tabGrantDoesNotBleedToSibling({
        subject,
        tabKey: "engineering.products.tab.bom",
        siblingTabKey: "engineering.products.tab.cost",
      }),
      true
    );
  });

  it("toPermissionHierarchyNode marca deprecated como inativo", () => {
    const deprecated = PERMISSION_CONTRACT_RESOURCES.find((r) => r.deprecated);
    if (!deprecated) return;
    const node = toPermissionHierarchyNode(deprecated);
    assert.equal(node.isActive, false);
  });
});
