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
  isCommissionsHiddenSection,
  resolveCommissionsCanonicalPath,
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
  it("modo simplificado expõe apenas fechamento mensal e exclusões por cliente", () => {
    assert.equal(COMMISSIONS_SIMPLIFIED_UI, true);
    assert.equal(COMMISSIONS_SECTIONS.length, 2);
    assert.equal(COMMISSIONS_SECTIONS[0]?.id, "monthlyClosing");
    assert.equal(COMMISSIONS_SECTIONS[1]?.id, "customerExclusions");
    assert.equal(COMMISSIONS_SECTIONS.some((s) => s.id === "receivableForecast"), false);
    assert.equal(COMMISSIONS_SECTIONS.some((s) => s.id === "visualAudit"), false);
    assert.equal(COMMISSIONS_SECTION_PATHS.monthlyClosing, "/commissions");
    assert.equal(COMMISSIONS_SECTION_PATHS.customerExclusions, "/commissions/exclusoes-cliente");
    assert.equal(isCommissionsHiddenSection("receivableForecast"), true);
    assert.equal(isCommissionsHiddenSection("visualAudit"), true);
  });

  it("redireciona rotas legadas e abas removidas para fechamento", () => {
    assert.equal(resolveCommissionsLegacyRedirect("forecast"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("previsao"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("auditoria"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("confirmed"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("releases"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("dashboard"), "/commissions");
    assert.equal(resolveCommissionsLegacyRedirect("exceptions"), "/commissions/exclusoes-cliente");
    assert.ok(COMMISSIONS_LEGACY_PATH_REDIRECTS.apuracao);
    assert.equal(COMMISSIONS_LEGACY_PATH_REDIRECTS.payable, "/commissions");
  });

  it("deep-link de previsão e auditoria redireciona para fechamento", () => {
    assert.equal(resolveCommissionsCanonicalPath("/commissions/previsao"), "/commissions");
    assert.equal(resolveCommissionsCanonicalPath("/commissions/auditoria"), "/commissions");
  });

  it("paths canônicos", () => {
    assert.equal(isCommissionsCanonicalPath("/commissions"), true);
    assert.equal(isCommissionsCanonicalPath("/commissions/auditoria"), true);
    assert.equal(isCommissionsCanonicalPath("/commissions/previsao"), true);
    assert.equal(isCommissionsCanonicalPath("/commissions/exclusoes-cliente"), true);
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

  it("CommissionsModule usa fechamento e exclusões; abas legadas redirecionam", () => {
    const moduleSrc = read("src/components/CommissionsModule.tsx");
    assert.match(moduleSrc, /CommissionsReceiptClosingPage/);
    assert.match(moduleSrc, /CommissionsCustomerExclusionsPage/);
    assert.match(moduleSrc, /CommissionsDeprecatedTabRedirect/);
    assert.doesNotMatch(moduleSrc, /CommissionsReceivableForecastPage/);
    assert.doesNotMatch(moduleSrc, /CommissionsVisualAuditPage/);
    assert.match(moduleSrc, /COMMISSIONS_LEGACY_PATH_REDIRECTS/);
    assert.match(moduleSrc, /CommissionsLegacyRedirect/);
    assert.match(moduleSrc, /commissions-tab-monthlyClosing/);
    assert.match(moduleSrc, /commissions-tab-customerExclusions/);
    assert.doesNotMatch(moduleSrc, /commissions-tab-receivableForecast/);
    assert.doesNotMatch(moduleSrc, /commissions-tab-visualAudit/);
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

  it("monthlyClosing exige commissions.view", () => {
    assert.equal(canViewCommissionsSection("monthlyClosing", checker(["commissions.view"])), true);
    assert.equal(canViewCommissionsSection("monthlyClosing", checker(["finance.view"])), false);
  });

  it("abas ocultas não são acessíveis na UI", () => {
    assert.equal(canViewCommissionsSection("visualAudit", checker(["commissions.view"])), false);
    assert.equal(canViewCommissionsSection("receivableForecast", checker(["commissions.view"])), false);
  });

  it("customerExclusions exige commissions.rules.view", () => {
    assert.equal(
      canViewCommissionsSection("customerExclusions", checker(["commissions.rules.view"])),
      true
    );
    assert.equal(canViewCommissionsSection("customerExclusions", checker(["commissions.view"])), true);
    assert.equal(canViewCommissionsSection("customerExclusions", checker(["finance.view"])), false);
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
