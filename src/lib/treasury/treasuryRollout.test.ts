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
  resolveTreasuryFlagGateDecision,
  resolveTreasuryUiEnabledLandingPath,
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
    assert.equal(
      resolveTreasuryUiEnabledLandingPath(baseSections, flags),
      "/finance/treasury/receivables"
    );
  });

  it("landing preferida (Caixa) vence quando liberada; senão cai na primeira visível", () => {
    const flags = Object.fromEntries(
      TREASURY_FEATURE_FLAG_IDS.map((id) => [id, false])
    ) as Record<(typeof TREASURY_FEATURE_FLAG_IDS)[number], boolean>;
    flags["treasury.enabled"] = true;
    flags["treasury.accounts.enabled"] = true;
    const sections = [
      { id: "accounts", path: "/finance/treasury/accounts" },
      { id: "caixa", path: "/finance/treasury/caixa" },
    ];
    // Central de Tesouraria: abre SEMPRE no Caixa quando liberado, mesmo
    // com "accounts" primeiro na barra.
    assert.equal(
      resolveTreasuryUiEnabledLandingPath(sections, flags, "caixa"),
      "/finance/treasury/caixa"
    );
    // Preferida não visível → comportamento original (primeira seção).
    assert.equal(
      resolveTreasuryUiEnabledLandingPath(sections, flags, "bank"),
      "/finance/treasury/accounts"
    );
    // Sem preferida → intacto.
    assert.equal(
      resolveTreasuryUiEnabledLandingPath(sections, flags),
      "/finance/treasury/accounts"
    );
  });

  it("enabled landing é null quando nenhuma seção está liberada (anti-loop)", () => {
    const flags = Object.fromEntries(
      TREASURY_FEATURE_FLAG_IDS.map((id) => [id, false])
    ) as Record<(typeof TREASURY_FEATURE_FLAG_IDS)[number], boolean>;
    assert.equal(resolveTreasuryUiEnabledLandingPath(baseSections, flags), null);
    assert.equal(
      resolveTreasuryUiEnabledLandingPath(baseSections, {
        "treasury.enabled": true,
      }),
      "/finance/treasury/audit"
    );
  });

  it("FlagGate não redireciona para o mesmo path (anti-loop)", () => {
    const flags = Object.fromEntries(
      TREASURY_FEATURE_FLAG_IDS.map((id) => [id, false])
    ) as Record<(typeof TREASURY_FEATURE_FLAG_IDS)[number], boolean>;
    assert.deepEqual(
      resolveTreasuryFlagGateDecision({
        flags,
        sectionId: "today",
        landingPath: null,
        currentPath: "/finance/treasury/today",
      }),
      { action: "blocked" }
    );
    assert.deepEqual(
      resolveTreasuryFlagGateDecision({
        flags,
        sectionId: "today",
        landingPath: "/finance/treasury/today",
        currentPath: "/finance/treasury/today",
      }),
      { action: "blocked" }
    );
    flags["treasury.enabled"] = true;
    flags["treasury.accounts.enabled"] = true;
    assert.deepEqual(
      resolveTreasuryFlagGateDecision({
        flags,
        sectionId: "today",
        landingPath: "/finance/treasury/accounts",
        currentPath: "/finance/treasury/today",
      }),
      { action: "redirect", to: "/finance/treasury/accounts" }
    );
    assert.deepEqual(
      resolveTreasuryFlagGateDecision({
        flags,
        sectionId: "accounts",
        landingPath: "/finance/treasury/accounts",
        currentPath: "/finance/treasury/accounts",
      }),
      { action: "render" }
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
    assert.match(mod, /treasury-module-availability-error/);
    assert.match(mod, /resolveTreasuryUiEnabledLandingPath/);
    assert.match(mod, /resolveTreasuryFlagGateDecision/);
    assert.match(mod, /if \(ac\.signal\.aborted\) return/);
    assert.doesNotMatch(mod, /closedTreasuryFlagsMap/);
  });
});
