import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  COMMISSIONS_LEGACY_PATH_REDIRECTS,
  COMMISSIONS_SECTION_PATHS,
  COMMISSIONS_SECTIONS,
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
  it("expõe 10 seções alinhadas ao menu gerencial", () => {
    assert.equal(COMMISSIONS_SECTIONS.length, 10);
    assert.equal(COMMISSIONS_SECTION_PATHS.dashboard, "/commissions");
    assert.equal(COMMISSIONS_SECTION_PATHS.payable, "/commissions/payable");
    assert.equal(COMMISSIONS_SECTION_PATHS.generated, "/commissions/generated");
    assert.equal(COMMISSIONS_SECTION_PATHS.exceptions, "/commissions/exceptions");
    assert.equal(COMMISSIONS_SECTION_PATHS.settings, "/commissions/settings");
  });

  it("redireciona rotas legadas", () => {
    assert.equal(resolveCommissionsLegacyRedirect("forecast"), "/commissions/future");
    assert.equal(resolveCommissionsLegacyRedirect("confirmed"), "/commissions/generated");
    assert.equal(resolveCommissionsLegacyRedirect("releases"), "/commissions/payable");
    assert.ok(COMMISSIONS_LEGACY_PATH_REDIRECTS.apuracao);
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

  it("dashboard exige permissão de dashboard ou view", () => {
    assert.equal(canViewCommissionsSection("dashboard", checker(["commissions.view"])), true);
    assert.equal(
      canViewCommissionsSection("dashboard", checker(["commissions.dashboard.view"])),
      true
    );
    assert.equal(canViewCommissionsSection("payable", checker(["commissions.dashboard.view"])), false);
    assert.equal(canViewCommissionsSection("payable", checker(["commissions.release.view"])), true);
  });

  it("resolveFirstAccessibleCommissionsPath retorna primeira seção permitida", () => {
    assert.equal(
      resolveFirstAccessibleCommissionsPath(checker(["commissions.forecast.view"])),
      "/commissions/future"
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
