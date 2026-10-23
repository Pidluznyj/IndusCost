/**
 * Comissões › Visão 360° — render estático real da página e registro da aba.
 * Loader vazio para `.css`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { COMMISSION_360_DESCRIPTION, COMMISSION_360_TITLE } from "./commissions/commission360View.shared.js";
import {
  isCommissionsCanonicalPath,
  parseCommissionsSectionFromPath,
  resolveCommissionsCanonicalPath,
} from "./commissionsNavigation.js";
import { COMMISSIONS_LIVE_UI_TABS, TabResourceKeys } from "./moduleTabResources.js";
import { canViewCommissionsSection } from "./commissionsModulePermissions.js";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

let pageModule: typeof import("../components/commissions/pages/Commissions360ViewPage.js");

before(async () => {
  pageModule = await import("../components/commissions/pages/Commissions360ViewPage.js");
});

describe("Comissões › Visão 360°", () => {
  it("renderiza cabeçalho, filtros e estado de carregamento", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <pageModule.Commissions360ViewPage />
      </MemoryRouter>
    );
    assert.ok(html.includes(COMMISSION_360_TITLE));
    assert.ok(html.includes(COMMISSION_360_DESCRIPTION));
    assert.equal((html.match(/<input type="month"/g) ?? []).length, 2);
    for (const label of ["Pagamentos", "Realizada não paga", "Prevista sobre CRs", "Potencial em PVs", "Conciliação de CRs"]) {
      assert.ok(html.includes(label), label);
    }
    assert.match(html, /Montando a Visão 360°/);
    assert.match(html, /data-testid="commissions-360-export"/);
    assert.doesNotMatch(html, /<table[^>]*>(?:(?!<\/table>).)*<table/s, "sem tabela aninhada");
  });

  it("aba registrada com recurso próprio, separado da Previsão e dos Relatórios", () => {
    const tab = COMMISSIONS_LIVE_UI_TABS.find((row) => row.id === "view360");
    assert.equal(tab?.resourceKey, TabResourceKeys.COMISSOES_VISAO_360);
    assert.notEqual(tab?.resourceKey, TabResourceKeys.COMISSOES_RELATORIOS);
    assert.notEqual(
      tab?.resourceKey,
      COMMISSIONS_LIVE_UI_TABS.find((row) => row.id === "portfolioOutlook")?.resourceKey
    );
    assert.equal(parseCommissionsSectionFromPath("/commissions/visao-360"), "view360");
    assert.equal(isCommissionsCanonicalPath("/commissions/visao-360"), true);
    assert.equal(resolveCommissionsCanonicalPath("/commissions/visao-360"), "/commissions/visao-360");
    const viewer = {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      canViewResource: (key: string): boolean => key === TabResourceKeys.COMISSOES_VISAO_360,
    };
    assert.equal(canViewCommissionsSection("view360", viewer), true);
    const none = { hasPermission: () => false, hasAnyPermission: () => false, canViewResource: () => false };
    assert.equal(canViewCommissionsSection("view360", none), false);
  });

  it("rota do módulo protegida pelo guard da seção", () => {
    const source = readFileSync(join(process.cwd(), "src/components/CommissionsModule.tsx"), "utf8");
    assert.match(source, /path="visao-360" element=\{guard\("view360", <Commissions360ViewPage \/>\)\}/);
  });
});
