/**
 * P03 — resolveEffectiveAccess (shadow; não troca consumidores).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRoleBaselineFromSeed,
  canEffectiveAccess,
  canRevealNavigation,
  compareEffectiveAccessWithCurrent,
  fixtureAliasOneToOne,
  fixtureDenyWinsAllow,
  fixtureLegacyMegaKey,
  fixtureLeticiaAccountsPayableOnly,
  fixtureLeticiaLegacyCompatOnly,
  fixtureParentDenyBlocksChild,
  fixtureProfileSnapshotAp,
  fixtureSuperAdmin,
  fixtureViewerRolePreset,
  projectLegacyBagToBaseline,
  resolveEffectiveAccess,
} from "./index.ts";

describe("resolveEffectiveAccess — SUPER_ADMIN / VIEWER / role", () => {
  it("SUPER_ADMIN bypass em ações suportadas; version pass-through", () => {
    const r = resolveEffectiveAccess(fixtureSuperAdmin());
    assert.equal(r.permissionsVersion, 9);
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
    assert.equal(canEffectiveAccess(r, "admin.employees", "view"), true);
    assert.equal(
      r.byResourceAction["finance.accounts_payable"]?.view?.source,
      "SUPER_ADMIN"
    );
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "approve"), false);
  });

  it("VIEWER sem perfil é fail-closed e NÃO usa bag", () => {
    const r = resolveEffectiveAccess(fixtureViewerRolePreset());
    assert.equal(r.legacyCompatApplied, false);
    assert.equal(canEffectiveAccess(r, "dashboard", "view"), false);
    assert.equal(canEffectiveAccess(r, "commercial.sales_orders", "view"), false);
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), false);
  });

  it("VIEWER não amplia além do baseline/overrides (bag ignorada)", () => {
    const r = resolveEffectiveAccess({
      userId: "v",
      role: "VIEWER",
      profileSnapshot: {},
      legacyPermissions: ["finance.view", "costs.view", "crm.view"],
      legacyCompatMode: false,
    });
    assert.equal(canEffectiveAccess(r, "finance", "view"), false);
    assert.equal(canEffectiveAccess(r, "admin.employees", "view"), false);
    assert.ok(
      r.warnings.some((w) => w.code === "LEGACY_COMPAT_DISABLED_BAG_IGNORED")
    );
  });
});

describe("resolveEffectiveAccess — perfil / allow / deny / conflito", () => {
  it("perfil snapshot substitui role e concede AP", () => {
    const r = resolveEffectiveAccess(fixtureProfileSnapshotAp());
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
    assert.equal(
      r.byResourceAction["finance.accounts_payable"]?.view?.source,
      "PROFILE"
    );
    assert.equal(canEffectiveAccess(r, "commercial.sales_orders", "view"), false);
    assert.ok(r.warnings.some((w) => w.code === "PROFILE_REPLACES_ROLE"));
  });

  it("structuredGrants OR sobre baseline vazio", () => {
    const r = resolveEffectiveAccess({
      userId: "sg",
      role: "VIEWER",
      profileSnapshot: {},
      structuredGrants: {
        "finance.accounts_payable": { view: true, export: true },
      },
    });
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "export"), true);
    assert.equal(
      r.byResourceAction["finance.accounts_payable"]?.view?.source,
      "STRUCTURED_GRANT"
    );
  });

  it("override allow concede; deny vence allow", () => {
    const allow = resolveEffectiveAccess({
      userId: "a",
      role: "VIEWER",
      profileSnapshot: {},
      overrides: { "finance.accounts_payable": { view: "allow" } },
    });
    assert.equal(canEffectiveAccess(allow, "finance.accounts_payable", "view"), true);
    assert.equal(
      allow.byResourceAction["finance.accounts_payable"]?.view?.source,
      "OVERRIDE_ALLOW"
    );

    const deny = resolveEffectiveAccess(fixtureDenyWinsAllow());
    assert.equal(canEffectiveAccess(deny, "finance.accounts_payable", "view"), false);
    assert.equal(
      deny.byResourceAction["finance.accounts_payable"]?.view?.source,
      "OVERRIDE_DENY"
    );
  });

  it("recurso/ação desconhecida ou não suportada = DENY", () => {
    const r = resolveEffectiveAccess({
      userId: "u",
      role: "VIEWER",
      profileSnapshot: {},
      overrides: { "finance.accounts_payable": { view: "allow" } },
    });
    assert.equal(canEffectiveAccess(r, "fantasma.x", "view"), false);
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "approve"), false);
  });
});

describe("resolveEffectiveAccess — parent/child", () => {
  it("parent view deny bloqueia filho allow", () => {
    const r = resolveEffectiveAccess(fixtureParentDenyBlocksChild());
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), false);
    assert.equal(
      r.byResourceAction["finance.accounts_payable"]?.view?.source,
      "ANCESTOR_VIEW_DENY"
    );
    assert.ok(r.blockedByParent.includes("finance.accounts_payable"));
    assert.equal(canRevealNavigation(r, "finance.accounts_payable"), false);
  });

  it("filho allow não concede perform no parent; parent virtual na nav", () => {
    const r = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
    assert.equal(canEffectiveAccess(r, "finance", "view"), false);
    assert.equal(canRevealNavigation(r, "finance"), true);
    assert.equal(canEffectiveAccess(r, "finance.portfolio_reconciliation", "view"), false);
    assert.equal(canRevealNavigation(r, "finance.portfolio_reconciliation"), false);
  });
});

describe("resolveEffectiveAccess — Leticia", () => {
  it("VIEWER só Contas a Pagar: AP sim; irmãos/RH/máquinas/engenharia não", () => {
    const r = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
    assert.equal(canEffectiveAccess(r, "finance", "view"), false);
    assert.equal(canEffectiveAccess(r, "finance.portfolio_reconciliation", "view"), false);
    assert.equal(canEffectiveAccess(r, "finance.accounts_receivable", "view"), false);
    assert.equal(canEffectiveAccess(r, "admin.employees", "view"), false);
    assert.equal(canEffectiveAccess(r, "operations.machines", "view"), false);
    assert.equal(canEffectiveAccess(r, "engineering", "view"), false);
    assert.equal(canEffectiveAccess(r, "commercial.sales_orders", "view"), false);
  });
});

describe("resolveEffectiveAccess — legado / alias / mega-key", () => {
  it("alias 1:1 em compat mode projeta Contas a Pagar", () => {
    const r = resolveEffectiveAccess(fixtureAliasOneToOne());
    assert.equal(r.legacyCompatApplied, true);
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
    assert.equal(
      r.byResourceAction["finance.accounts_payable"]?.view?.source,
      "LEGACY_PROJECTED"
    );
    assert.equal(canEffectiveAccess(r, "finance.portfolio_reconciliation", "view"), false);
  });

  it("mega-key costs.view não projeta RH/máquinas", () => {
    const projected = projectLegacyBagToBaseline({
      legacyPermissions: ["costs.view"],
      skipMegaKeys: true,
    });
    assert.ok(projected.warnings.some((w) => w.code === "LEGACY_MEGA_KEY_SKIPPED"));
    assert.equal(projected.grants["admin.employees"]?.view, undefined);

    const r = resolveEffectiveAccess(fixtureLegacyMegaKey());
    assert.equal(canEffectiveAccess(r, "admin.employees", "view"), false);
    assert.equal(canEffectiveAccess(r, "operations.machines", "view"), false);
    // AP via 1:1 ainda ok
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
  });

  it("legacy compat Leticia com bag AP only", () => {
    const r = resolveEffectiveAccess(fixtureLeticiaLegacyCompatOnly());
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
    assert.equal(canEffectiveAccess(r, "finance", "view"), false);
  });
});

describe("resolveEffectiveAccess — role baseline builder", () => {
  it("buildRoleBaselineFromSeed VIEWER é vazio (fail-closed)", () => {
    const b = buildRoleBaselineFromSeed("VIEWER");
    assert.equal(b["dashboard"]?.view, undefined);
    assert.equal(b["commercial.sales_orders"]?.view, undefined);
    assert.equal(b["finance.accounts_payable"]?.view, undefined);
  });
});

describe("shadow compare — diferenças explícitas (Leticia)", () => {
  it("novo modelo é mais estrito que FE bleed / bag para finance e conciliação", () => {
    const report = compareEffectiveAccessWithCurrent({
      fixtureId: "leticia-ap-only",
      description:
        "Bag só finance.accountsPayable.view; next=resolvedor alvo; current=bag+FE bleed documentado",
      input: fixtureLeticiaAccountsPayableOnly(),
      probes: [
        {
          resourceKey: "finance.accounts_payable",
          action: "view",
          currentLegacyKeys: ["finance.accountsPayable.view"],
          currentSeedResourceKey: "financeiro.contas_pagar",
        },
        {
          resourceKey: "finance",
          action: "view",
          currentLegacyKeys: ["finance.view"],
          note: "FE_ALIAS_BLEED",
        },
        {
          resourceKey: "finance.portfolio_reconciliation",
          action: "view",
          currentLegacyKeys: ["finance.portfolioReconciliation.view"],
          note: "FE_ALIAS_BLEED",
        },
        {
          resourceKey: "admin.employees",
          action: "view",
          currentLegacyKeys: ["employees.view", "costs.view"],
        },
      ],
    });

    const byKey = Object.fromEntries(
      report.diffs.map((d) => [`${d.resourceKey}:${d.action}`, d])
    );

    assert.equal(byKey["finance.accounts_payable:view"]!.kind, "aligned");
    // FE bleed: current allow via alias, next deny → next_stricter
    assert.equal(byKey["finance:view"]!.kind, "next_stricter");
    assert.equal(byKey["finance.portfolio_reconciliation:view"]!.kind, "next_stricter");
    assert.equal(byKey["admin.employees:view"]!.kind, "aligned");

    assert.ok(report.nextStricterCount >= 2);
    // Não esconder: reporta looser se houver
    assert.equal(typeof report.nextLooserCount, "number");
  });
});
