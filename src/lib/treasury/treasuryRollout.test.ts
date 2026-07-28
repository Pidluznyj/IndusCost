import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TREASURY_FEATURE_FLAG_IDS } from "./treasuryFeatureFlags.js";
import {
  TREASURY_ROLLOUT_ACTIVATION_ORDER,
  TREASURY_UI_SECTION_FEATURE_FLAG,
  filterTreasuryUiSections,
  isTreasuryUiSectionEnabled,
  resolveTreasuryUiLandingPath,
} from "./treasuryRollout.js";

const here = dirname(fileURLToPath(import.meta.url));

const baseSections = [
  { id: "home", path: "/finance/treasury" },
  { id: "accounts", path: "/finance/treasury/accounts" },
  { id: "receivables", path: "/finance/treasury/receivables" },
  { id: "reports", path: "/finance/treasury/reports" },
  { id: "audit", path: "/finance/treasury/audit" },
] as const;

describe("treasuryRollout", () => {
  it("ordem recomendada começa na mestra e termina em relatórios", () => {
    assert.equal(TREASURY_ROLLOUT_ACTIVATION_ORDER[0], "treasury.enabled");
    assert.equal(
      TREASURY_ROLLOUT_ACTIVATION_ORDER[TREASURY_ROLLOUT_ACTIVATION_ORDER.length - 1],
      "treasury.reports.enabled"
    );
    assert.ok(
      TREASURY_ROLLOUT_ACTIVATION_ORDER.indexOf("treasury.accounts.enabled") <
        TREASURY_ROLLOUT_ACTIVATION_ORDER.indexOf("treasury.balances.enabled")
    );
    assert.ok(
      TREASURY_ROLLOUT_ACTIVATION_ORDER.indexOf("treasury.ofxImport.enabled") <
        TREASURY_ROLLOUT_ACTIVATION_ORDER.indexOf("treasury.reconciliation.enabled")
    );
  });

  it("oculta seções quando subflag off e preserva audit sob mestra", () => {
    const flags = Object.fromEntries(
      TREASURY_FEATURE_FLAG_IDS.map((id) => [id, false])
    ) as Record<(typeof TREASURY_FEATURE_FLAG_IDS)[number], boolean>;
    flags["treasury.enabled"] = true;
    flags["treasury.accounts.enabled"] = true;

    assert.equal(isTreasuryUiSectionEnabled("accounts", flags), true);
    assert.equal(isTreasuryUiSectionEnabled("receivables", flags), false);
    assert.equal(isTreasuryUiSectionEnabled("audit", flags), true);

    const visible = filterTreasuryUiSections(baseSections, flags);
    assert.deepEqual(
      visible.map((s) => s.id),
      ["accounts", "audit"]
    );
  });

  it("fail-closed sem flags / mestra off", () => {
    assert.equal(isTreasuryUiSectionEnabled("home", null), false);
    assert.equal(isTreasuryUiSectionEnabled("home", { "treasury.enabled": false }), false);
    assert.deepEqual(filterTreasuryUiSections(baseSections, null), []);
  });

  it("landing cai na primeira seção habilitada", () => {
    const flags = Object.fromEntries(
      TREASURY_FEATURE_FLAG_IDS.map((id) => [id, false])
    ) as Record<(typeof TREASURY_FEATURE_FLAG_IDS)[number], boolean>;
    flags["treasury.enabled"] = true;
    flags["treasury.receivables.enabled"] = true;
    assert.equal(
      resolveTreasuryUiLandingPath(baseSections, flags, "/finance/treasury"),
      "/finance/treasury/receivables"
    );
  });

  it("mapeamento UI cobre submódulos do Prompt 65", () => {
    assert.equal(
      TREASURY_UI_SECTION_FEATURE_FLAG.home,
      "treasury.dashboard.enabled"
    );
    assert.equal(
      TREASURY_UI_SECTION_FEATURE_FLAG.balances,
      "treasury.balances.enabled"
    );
    assert.equal(
      TREASURY_UI_SECTION_FEATURE_FLAG.receivables,
      "treasury.receivables.enabled"
    );
    assert.equal(
      TREASURY_UI_SECTION_FEATURE_FLAG.payables,
      "treasury.payables.enabled"
    );
    assert.equal(
      TREASURY_UI_SECTION_FEATURE_FLAG.reports,
      "treasury.reports.enabled"
    );
  });

  it("rotas HTTP exigem subflags novas (wiring)", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.match(routes, /treasury\.balances\.enabled/);
    assert.match(routes, /treasury\.dashboard\.enabled/);
    assert.match(routes, /treasury\.receivables\.enabled/);
    assert.match(routes, /treasury\.payables\.enabled/);
    assert.match(routes, /treasury\.reports\.enabled/);
    assert.match(routes, /treasury\.promises\.enabled/);
    assert.match(routes, /balancesEnabled/);
    assert.match(routes, /dashboardEnabled/);
    assert.match(routes, /receivablesEnabled/);
    assert.match(routes, /reportsEnabled/);
  });

  it("shell FE filtra abas por availability", () => {
    const mod = readFileSync(
      join(here, "../../components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(mod, /fetchTreasuryAvailability/);
    assert.match(mod, /filterTreasuryUiSections/);
    assert.match(mod, /TreasuryFlagGate/);
    assert.match(mod, /treasury-module-no-flags/);
  });
});
