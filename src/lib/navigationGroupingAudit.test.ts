import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import {
  buildNavigationGroupingSnapshot,
  formatNavigationGroupingAuditReport,
  loadNavigationGroupingBaseline,
  NAVIGATION_GROUPING_BASELINE_PATH,
  runNavigationGroupingAudit,
  type NavigationGroupingBaseline,
} from "./navigationGroupingAudit.js";
import { SIDEBAR_MODULE_ORDER } from "./modulePermissions.js";
import { getModulePath, MODULE_MENU_PERMISSION_KEYS } from "./navigationGroups.js";

describe("navigationGroupingAudit — snapshot", () => {
  it("baseline versionado contém todos os módulos com path canônico", () => {
    const baseline = loadNavigationGroupingBaseline(NAVIGATION_GROUPING_BASELINE_PATH);
    assert.equal(baseline.version, 1);
    assert.equal(baseline.items.length, SIDEBAR_MODULE_ORDER.length);
    for (const item of baseline.items) {
      assert.equal(item.path, getModulePath(item.itemId));
      assert.ok(item.label.length > 0);
      assert.ok(item.requiredPermissions.length > 0);
    }
  });

  it("snapshot atual coincide com estrutura esperada de ordem", () => {
    const snapshot = buildNavigationGroupingSnapshot();
    assert.deepEqual(
      snapshot.items.map((item) => item.itemId),
      [...SIDEBAR_MODULE_ORDER]
    );
  });
});

describe("navigationGroupingAudit — execução contra baseline", () => {
  it("auditoria passa com status OK usando baseline oficial", () => {
    const result = runNavigationGroupingAudit();
    assert.equal(result.status, "OK");
    assert.ok(result.findings.some((f) => f.code === "ALL_CHECKS_PASSED"));
    assert.equal(
      result.findings.filter((f) => f.severity === "BLOQUEANTE").length,
      0
    );
  });

  it("detecta BLOQUEANTE quando path muda no baseline", () => {
    const baseline = loadNavigationGroupingBaseline(NAVIGATION_GROUPING_BASELINE_PATH);
    const tampered: NavigationGroupingBaseline = {
      ...baseline,
      items: baseline.items.map((item) =>
        item.itemId === "products" ? { ...item, path: "/produtos" } : item
      ),
    };
    const dir = mkdtempSync(join(tmpdir(), "nav-audit-"));
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(baselinePath, JSON.stringify(tampered));
    const result = runNavigationGroupingAudit({ baselinePath });
    assert.equal(result.status, "BLOQUEANTE");
    assert.ok(result.findings.some((f) => f.code === "PATH_CHANGED"));
  });

  it("detecta BLOQUEANTE quando permissões mudam no baseline", () => {
    const baseline = loadNavigationGroupingBaseline(NAVIGATION_GROUPING_BASELINE_PATH);
    const tampered: NavigationGroupingBaseline = {
      ...baseline,
      permissionKeysByModule: {
        ...baseline.permissionKeysByModule,
        products: ["products.view", "invented.permission"],
      },
      items: baseline.items.map((item) =>
        item.itemId === "products"
          ? { ...item, requiredPermissions: ["products.view", "invented.permission"] }
          : item
      ),
    };
    const dir = mkdtempSync(join(tmpdir(), "nav-audit-"));
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(baselinePath, JSON.stringify(tampered));
    const result = runNavigationGroupingAudit({ baselinePath });
    assert.equal(result.status, "BLOQUEANTE");
    assert.ok(result.findings.some((f) => f.code === "PERMISSIONS_CHANGED"));
  });

  it("detecta BLOQUEANTE quando baseline referencia item inexistente no menu", () => {
    const baseline = loadNavigationGroupingBaseline(NAVIGATION_GROUPING_BASELINE_PATH);
    const phantomItem = {
      ...baseline.items[0]!,
      order: 99,
      itemId: "phantom-module" as AppModuleId,
      path: "/phantom-module",
    };
    const tampered: NavigationGroupingBaseline = {
      ...baseline,
      items: [...baseline.items, phantomItem],
    };
    const dir = mkdtempSync(join(tmpdir(), "nav-audit-"));
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(baselinePath, JSON.stringify(tampered));
    const result = runNavigationGroupingAudit({ baselinePath });
    assert.equal(result.status, "BLOQUEANTE");
    assert.ok(result.findings.some((f) => f.code === "BASELINE_ITEM_REMOVED"));
  });
});

describe("navigationGroupingAudit — integridade de permission keys", () => {
  it("baseline permissionKeysByModule espelha MODULE_MENU_PERMISSION_KEYS", () => {
    const baseline = loadNavigationGroupingBaseline(NAVIGATION_GROUPING_BASELINE_PATH);
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      assert.deepEqual(baseline.permissionKeysByModule[moduleId], MODULE_MENU_PERMISSION_KEYS[moduleId]);
    }
  });
});

describe("navigationGroupingAudit — script npm", () => {
  it("package.json expõe audit:navigation-grouping", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts["audit:navigation-grouping"], /audit-navigation-grouping/);
  });

  it("formatNavigationGroupingAuditReport inclui status", () => {
    const result = runNavigationGroupingAudit();
    const text = formatNavigationGroupingAuditReport(result);
    assert.match(text, /Status: OK/);
  });
});
