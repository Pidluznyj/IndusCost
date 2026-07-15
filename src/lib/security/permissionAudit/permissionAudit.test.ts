import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isKnownGap,
  PERMISSION_AUDIT_KNOWN_GAPS,
} from "./knownGaps.ts";
import {
  formatPermissionAuditMarkdown,
  runPermissionAudit,
} from "./runPermissionAudit.ts";
import { scanFileCalls, scanExpressRoutes } from "./scanAst.ts";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("permissionAudit knownGaps", () => {
  it("reconhece gaps remanescentes documentados (RC Prompt 16)", () => {
    assert.equal(
      isKnownGap("MUTATION_AUTH_ONLY", "DELETE /api/finance/suppliers/x"),
      true
    );
    assert.equal(
      isKnownGap(
        "MUTATION_AUTH_ONLY",
        "POST /api/fleet/admin/reservations-cleanup"
      ),
      true
    );
    assert.equal(
      isKnownGap("MUTATION_WITHOUT_PERMISSION_GUARD", "GET /api/test-db"),
      false
    );
    assert.equal(
      isKnownGap("FE_BE_GUARD_STYLE_MISMATCH", "settings.view|settings.nomus.sync"),
      false
    );
    assert.equal(isKnownGap("USED_NOT_IN_CATALOG", "finance.executiveReport.view"), false);
    assert.equal(isKnownGap("USED_NOT_IN_CATALOG", "fantasma.x"), false);
  });

  it("lista de known gaps não está vazia", () => {
    assert.ok(PERMISSION_AUDIT_KNOWN_GAPS.length >= 5);
  });
});

describe("permissionAudit AST helpers", () => {
  it("extrai hasPermission e requirePermission via AST", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "perm-audit-"));
    const file = path.join(dir, "sample.ts");
    writeFileSync(
      file,
      `
      export function demo(check: { hasPermission: (k: string) => boolean }) {
        return check.hasPermission("products.view") && check.hasPermission('products.edit');
      }
      export function route(app: any, requirePermission: any, requireAppAuth: any, g: any) {
        app.post("/api/demo", requireAppAuth, requirePermission("products.create"), async () => {});
        app.post("/api/fleet-like", ...g.checklistOps, async () => {});
      }
      `,
      "utf8"
    );
    try {
      const calls = scanFileCalls(dir, file);
      assert.ok(calls.some((c) => c.stringArgs.includes("products.view")));
      assert.ok(calls.some((c) => c.stringArgs.includes("products.create")));
      const routes = scanExpressRoutes(dir, file);
      assert.equal(routes.length, 2);
      const demo = routes.find((r) => r.pathPattern === "/api/demo");
      assert.ok(demo?.permissionKeys.includes("products.create"));
      const fleetLike = routes.find((r) => r.pathPattern === "/api/fleet-like");
      assert.ok(fleetLike?.guardCallees.some((g) => g.includes("checklistOps")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("permissionAudit run (repo)", () => {
  it("modo report sempre ok e produz markdown", () => {
    const report = runPermissionAudit({ mode: "report" });
    assert.equal(report.summary.ok, true);
    assert.ok(report.summary.catalogKeyCount > 100);
    assert.ok(report.summary.contractResourceCount >= 60);
    assert.ok(report.summary.routeScanCount > 50);
    const md = formatPermissionAuditMarkdown(report);
    assert.ok(md.includes("validador automático"));
    assert.ok(md.includes("Findings"));
  });

  it("modo strict está verde no baseline atual (erros só known gaps)", () => {
    const report = runPermissionAudit({ mode: "strict" });
    assert.equal(report.summary.actionableErrorCount, 0);
    assert.equal(report.summary.ok, true);
  });

  it("contrato inválido aparece como CONTRACT_ISSUE", () => {
    // Smoke: validatePermissionContract no run real não deve gerar CONTRACT_ISSUE.
    const report = runPermissionAudit({ mode: "report" });
    assert.equal(
      report.findings.filter((f) => f.code === "CONTRACT_ISSUE").length,
      0
    );
  });
});
