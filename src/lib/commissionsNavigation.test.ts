import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  COMMISSIONS_LEGACY_PATH_REDIRECTS,
  COMMISSIONS_SECTION_PATHS,
  COMMISSIONS_SECTIONS,
  COMMISSIONS_SIMPLIFIED_UI,
  getCommissionsDefaultPath,
  isCommissionsCanonicalPath,
  resolveCommissionsLegacyRedirect,
} from "./commissionsNavigation.js";
import { canAccessCommissionsModule, canViewCommissionsSection, resolveFirstAccessibleCommissionsPath } from "./commissionsModulePermissions.js";
import { canAccessModule, type PermissionChecker } from "./modulePermissions.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

describe("commissionsNavigation", () => {
  it("modo simplificado expõe apenas auditoria visual", () => {
    assert.equal(COMMISSIONS_SIMPLIFIED_UI, true);
    assert.equal(COMMISSIONS_SECTIONS.length, 1);
    assert.equal(COMMISSIONS_SECTIONS[0]?.id, "visualAudit");
    assert.equal(COMMISSIONS_SECTION_PATHS.visualAudit, "/commissions");
  });

  it("redireciona rotas legadas para /commissions", () => {
    assert.equal(resolveCommissionsLegacyRedirect("forecast"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("confirmed"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("releases"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("dashboard"), "/commissions");
    assert.ok(COMMISSIONS_LEGACY_PATH_REDIRECTS.apuracao);
    assert.equal(COMMISSIONS_LEGACY_PATH_REDIRECTS.payable, "/commissions");
  });

  it("paths canônicos", () => {
    assert.equal(isCommissionsCanonicalPath("/commissions"), true);
    assert.equal(isCommissionsCanonicalPath("/commissions/payable"), true);
    assert.equal(isCommissionsCanonicalPath("/commissions/forecast"), true);
    assert.equal(isCommissionsCanonicalPath("/commissions/unknown"), false);
    assert.equal(getCommissionsDefaultPath(), "/commissions");
  });
});

describe("commissions frontend wiring", () => {
  it("App.tsx registra rota commissions/*", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="commissions\/\*"/);
    assert.match(app, /CommissionsModule/);
  });

  it("CommissionsModule usa auditoria visual e redirects legados", () => {
    const moduleSrc = read("src/components/CommissionsModule.tsx");
    assert.match(moduleSrc, /CommissionsVisualAuditPage/);
    assert.match(moduleSrc, /COMMISSIONS_LEGACY_PATH_REDIRECTS/);
    assert.match(moduleSrc, /CommissionsLegacyRedirect/);
  });

  it("Sidebar inclui item Comissões", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /commissions:\s*HandCoins/);
    assert.match(sidebar, /buildAccessibleSidebarNavigation/);
  });
});

describe("commissionsModulePermissions", () => {
  it("commissions.view abre módulo", () => {
    assert.equal(canAccessCommissionsModule(checker(["commissions.view"])), true);
    assert.equal(canAccessModule("commissions", checker(["commissions.view"])), true);
  });

  it("sem permissão não abre módulo", () => {
    assert.equal(canAccessModule("commissions", checker(["finance.view"])), false);
  });

  it("visualAudit exige commissions.view", () => {
    assert.equal(canViewCommissionsSection("visualAudit", checker(["commissions.view"])), true);
    assert.equal(canViewCommissionsSection("visualAudit", checker(["finance.view"])), false);
  });

  it("resolveFirstAccessibleCommissionsPath retorna /commissions", () => {
    assert.equal(
      resolveFirstAccessibleCommissionsPath(checker(["commissions.view"])),
      "/commissions"
    );
  });
});

describe("commissionsStatusLabels", () => {
  it("padroniza labels de status", async () => {
    const { COMMISSION_RECORD_STATUS_LABELS } = await import(
      "../components/commissions/commissionsStatusLabels.js"
    );
    assert.equal(COMMISSION_RECORD_STATUS_LABELS.FORECAST_FROM_ORDER, "Prevista pelo Pedido");
    assert.equal(
      COMMISSION_RECORD_STATUS_LABELS.CONFIRMED_BY_OUTPUT_DOCUMENT,
      "Confirmada por Documento de Saída"
    );
    assert.equal(COMMISSION_RECORD_STATUS_LABELS.ERROR, "Erro/Auditoria");
  });
});
