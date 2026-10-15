import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPETENCY_ENDPOINTS } from "./competencyAccess";
import { COMPETENCIES_ENABLED_ENV, isCompetenciesEnabled } from "./competencyFeatureFlags";
import { filterCompetenciesMenuNavigation } from "./competencyNavigation";
import { requestJson, startCompetencyTestApp } from "./competencyTestSupport";
import type { SidebarAccessibleNavigation } from "../sidebarNavigation";

const SOME_ID = "11111111-1111-4111-8111-111111111111";

describe("COMPETENCIES_ENABLED — fail closed", () => {
  it("só liga com valor explícito", () => {
    for (const v of ["1", "true", "TRUE", " on ", "yes", "enabled"]) {
      assert.equal(isCompetenciesEnabled({ [COMPETENCIES_ENABLED_ENV]: v }), true, v);
    }
    for (const v of [undefined, "", "0", "false", "off", "talvez"]) {
      assert.equal(isCompetenciesEnabled({ [COMPETENCIES_ENABLED_ENV]: v }), false, String(v));
    }
    assert.equal(isCompetenciesEnabled({}), false);
  });

  it(".env.example documenta a flag desligada", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    assert.match(example, /^COMPETENCIES_ENABLED=0$/m);
  });
});

describe("menu — filtro pela flag", () => {
  const nav = {
    groups: [
      { id: "gestao_pessoas", items: [{ itemId: "employees" }, { itemId: "competencies" }] },
      { id: "solo", items: [{ itemId: "competencies" }] },
    ],
    fallbackGroup: { id: "fb", items: [{ itemId: "competencies" }, { itemId: "x" }] },
    flatAccessibleItems: [{ id: "employees" }, { id: "competencies" }],
  } as unknown as SidebarAccessibleNavigation;

  it("desligada ou carregando (null): item some, grupo vazio some", () => {
    for (const flag of [false, null]) {
      const out = filterCompetenciesMenuNavigation(nav, flag) as any;
      assert.deepEqual(out.groups.map((g: any) => [g.id, g.items.map((i: any) => i.itemId)]), [["gestao_pessoas", ["employees"]]]);
      assert.deepEqual(out.fallbackGroup.items.map((i: any) => i.itemId), ["x"]);
      assert.deepEqual(out.flatAccessibleItems.map((i: any) => i.id), ["employees"]);
    }
  });

  it("ligada: navegação intacta", () => {
    assert.equal(filterCompetenciesMenuNavigation(nav, true), nav);
  });
});

describe("rotas — flag desligada", () => {
  it("todo endpoint do módulo → 404 FEATURE_DISABLED, mesmo com todas as permissões; status informa", async () => {
    const app = await startCompetencyTestApp({ enabled: false });
    try {
      for (const ep of COMPETENCY_ENDPOINTS) {
        const res = await requestJson(app, ep.method, ep.path.replace(/:[a-zA-Z]+/g, SOME_ID), ep.method === "GET" || ep.method === "DELETE" ? undefined : {});
        assert.deepEqual([res.status, res.json?.error], [404, "FEATURE_DISABLED"], `${ep.method} ${ep.path}`);
      }
      assert.equal(app.db.touched.size, 0, "nenhuma tabela tocada");
      assert.deepEqual((await requestJson(app, "GET", "/api/hr/competencies/feature-status")).json, { enabled: false });
      app.setEnabled(true);
      assert.deepEqual((await requestJson(app, "GET", "/api/hr/competencies/feature-status")).json, { enabled: true });
      assert.equal((await requestJson(app, "GET", "/api/hr/competencies/overview")).status, 200);
    } finally {
      await app.close();
    }
  });

  it("sem sessão: 401 antes da flag (status não vaza para anônimo)", async () => {
    const app = await startCompetencyTestApp({ enabled: false, authenticated: false });
    try {
      assert.equal((await requestJson(app, "GET", "/api/hr/competencies/feature-status")).status, 401);
      assert.equal((await requestJson(app, "GET", "/api/hr/competencies/overview")).status, 401);
    } finally {
      await app.close();
    }
  });

  it("UI consulta a flag: menu (Sidebar), rota (página) e aba da ficha", () => {
    const root = join(process.cwd(), "src");
    const sidebar = readFileSync(join(root, "components", "layout", "Sidebar.tsx"), "utf8");
    assert.match(sidebar, /filterCompetenciesMenuNavigation\(withTreasury, competenciesFeatureEnabled\)/);
    const page = readFileSync(join(root, "components", "competencies", "CompetenciesPage.tsx"), "utf8");
    assert.match(page, /useCompetenciesFeature\(\)/);
    const dialog = readFileSync(join(root, "components", "employee", "profile", "PeopleEmployeeProfileDialog.tsx"), "utf8");
    assert.match(dialog, /canSeeCompetenciesModule && competenciesFeature === true/);
  });
});
