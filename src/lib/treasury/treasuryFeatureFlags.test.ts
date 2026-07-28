import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowTreasuryNavigation,
  getTreasuryFeatureFlagsMap,
  isTreasuryFeatureFlagEnabled,
  isTreasuryModuleEnabled,
  listEnabledTreasuryFeatureFlags,
  parseTreasuryFlagEnvValue,
  requireTreasuryModuleEnabled,
  TREASURY_ENABLED_ENV,
  TREASURY_FEATURE_FLAG_ENV,
  TREASURY_FEATURE_FLAG_IDS,
  TREASURY_MASTER_DEFAULT_WHEN_ABSENT,
  TREASURY_SUBFLAG_DEFAULT_WHEN_ABSENT,
} from "./treasuryFeatureFlags.js";
import { TREASURY_ROLLOUT_ACTIVATION_ORDER } from "./treasuryRollout.js";
import { getTreasuryAvailability } from "./services/treasuryAvailabilityService.js";
import { canViewTreasuryModule, filterTreasuryMenuNavigation } from "./treasuryNavigation.js";
import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";
import { TREASURY_MODULE_ID } from "./treasuryNavigation.js";

const ALL_SUBMODULE_ENV = {
  TREASURY_MODULE_ENABLED: "1",
  TREASURY_ACCOUNTS_ENABLED: "1",
  TREASURY_BALANCES_ENABLED: "1",
  TREASURY_DASHBOARD_ENABLED: "1",
  TREASURY_RECEIVABLES_ENABLED: "1",
  TREASURY_PAYABLES_ENABLED: "1",
  TREASURY_PROJECTION_ENABLED: "1",
  TREASURY_PROMISES_ENABLED: "1",
  TREASURY_PAYABLES_PROGRAMMING_ENABLED: "1",
  TREASURY_TRANSFERS_ENABLED: "1",
  TREASURY_EXCEPTIONS_ENABLED: "1",
  TREASURY_DAILY_CLOSING_ENABLED: "1",
  TREASURY_RECONCILIATION_ENABLED: "1",
  TREASURY_OFX_IMPORT_ENABLED: "1",
  TREASURY_REPORTS_ENABLED: "1",
} as const;

const ALL_OFF_ENV = Object.fromEntries(
  Object.values(TREASURY_FEATURE_FLAG_ENV).map((k) => [k, "0"])
) as Record<string, string>;

function navWithTreasury(): SidebarAccessibleNavigation {
  const treasuryItem = {
    groupId: "financeiro" as const,
    itemId: TREASURY_MODULE_ID,
    label: "Tesouraria",
    path: "/finance/treasury",
    requiredPermissions: ["finance.treasury.view"],
    resourceKey: "finance.treasury",
    originalItem: {
      id: TREASURY_MODULE_ID,
      label: "Tesouraria",
      path: "/finance/treasury",
    },
  };
  return {
    directItems: [],
    groups: [
      {
        id: "financeiro",
        label: "Financeiro",
        iconKey: "Banknote",
        order: 1,
        isDirect: false,
        itemIds: ["finance", TREASURY_MODULE_ID],
        resourceKey: null,
        items: [treasuryItem],
      },
    ],
    fallbackGroup: null,
    flatAccessibleItems: [
      { id: TREASURY_MODULE_ID, label: "Tesouraria", path: "/finance/treasury" },
    ],
  };
}

function invokeGuard(
  env: Record<string, string | undefined>
): { status?: number; body?: unknown } {
  const handler = requireTreasuryModuleEnabled(env);
  let status: number | undefined;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };
  let nextCalled = false;
  handler({} as never, res as never, (() => {
    nextCalled = true;
  }) as never);
  if (nextCalled) return {};
  return { status, body };
}

describe("treasuryFeatureFlags — opt-in master", () => {
  it("1. Master ausente = OFF", () => {
    assert.equal(TREASURY_MASTER_DEFAULT_WHEN_ABSENT, false);
    assert.equal(isTreasuryModuleEnabled({}), false);
    assert.equal(parseTreasuryFlagEnvValue(undefined, false), false);
  });

  it("2–3. Master 1/true = ON", () => {
    assert.equal(isTreasuryModuleEnabled({ TREASURY_MODULE_ENABLED: "1" }), true);
    assert.equal(isTreasuryModuleEnabled({ TREASURY_MODULE_ENABLED: "true" }), true);
  });

  it("4–5. Master 0/false = OFF", () => {
    assert.equal(isTreasuryModuleEnabled({ TREASURY_MODULE_ENABLED: "0" }), false);
    assert.equal(isTreasuryModuleEnabled({ TREASURY_MODULE_ENABLED: "false" }), false);
  });

  it("6. Master inválida = OFF", () => {
    assert.equal(isTreasuryModuleEnabled({ [TREASURY_ENABLED_ENV]: "maybe" }), false);
  });

  it("7. Master OFF prevalece sobre subflag ON", () => {
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
        TREASURY_MODULE_ENABLED: "0",
        TREASURY_ACCOUNTS_ENABLED: "1",
      }),
      false
    );
  });

  it("8. Master ON + subflag ausente = ON", () => {
    assert.equal(TREASURY_SUBFLAG_DEFAULT_WHEN_ABSENT, true);
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
        TREASURY_MODULE_ENABLED: "1",
      }),
      true
    );
  });

  it("9–11. Master ON + subflag 0/false/inválida = OFF", () => {
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
        TREASURY_MODULE_ENABLED: "1",
        TREASURY_ACCOUNTS_ENABLED: "0",
      }),
      false
    );
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
        TREASURY_MODULE_ENABLED: "1",
        TREASURY_ACCOUNTS_ENABLED: "false",
      }),
      false
    );
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
        TREASURY_MODULE_ENABLED: "1",
        TREASURY_ACCOUNTS_ENABLED: "maybe",
      }),
      false
    );
  });

  it("12. Flag ID desconhecida = OFF", () => {
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.unknown.enabled", {
        TREASURY_MODULE_ENABLED: "1",
      }),
      false
    );
  });

  it("13. Menu oculto com master ausente", () => {
    const enabled = isTreasuryModuleEnabled({});
    const out = filterTreasuryMenuNavigation(navWithTreasury(), {
      featureEnabled: enabled,
      hasTreasuryViewAccess: true,
    });
    assert.equal(enabled, false);
    assert.equal(
      out.flatAccessibleItems.some((i) => i.id === TREASURY_MODULE_ID),
      false
    );
  });

  it("14. Menu visível com master ON e permissão", () => {
    const enabled = isTreasuryModuleEnabled({ TREASURY_MODULE_ENABLED: "1" });
    const out = filterTreasuryMenuNavigation(navWithTreasury(), {
      featureEnabled: enabled,
      hasTreasuryViewAccess: true,
    });
    assert.equal(enabled, true);
    assert.ok(out.flatAccessibleItems.some((i) => i.id === TREASURY_MODULE_ID));
  });

  it("15. API bloqueada com master ausente", () => {
    const result = invokeGuard({});
    assert.equal(result.status, 404);
  });

  it("16. API disponível com master ON (guard passa)", () => {
    const result = invokeGuard({ TREASURY_MODULE_ENABLED: "1" });
    assert.equal(result.status, undefined);
  });

  it("17. Usuário sem permissão bloqueado mesmo com master ON", () => {
    assert.equal(
      canShowTreasuryNavigation({
        featureEnabled: true,
        hasTreasuryViewAccess: false,
      }),
      false
    );
    assert.equal(
      canViewTreasuryModule({ hasPermission: () => false }),
      false
    );
  });

  it("18. Disponibilidade FE/BE coincidem (mesma resolução)", () => {
    const empty = getTreasuryAvailability({ env: {} });
    assert.equal(empty.enabled, isTreasuryModuleEnabled({}));
    assert.equal(empty.enabled, false);

    const on = getTreasuryAvailability({
      env: { TREASURY_MODULE_ENABLED: "1" },
    });
    assert.equal(on.enabled, isTreasuryModuleEnabled({ TREASURY_MODULE_ENABLED: "1" }));
    assert.equal(on.enabled, true);
    assert.equal(on.flags["treasury.accounts.enabled"], true);
  });

  it("mestra habilita com valores conhecidos", () => {
    for (const value of ["1", "true", "YES", "on", "enabled"]) {
      assert.equal(
        isTreasuryModuleEnabled({ [TREASURY_ENABLED_ENV]: value }),
        true,
        value
      );
    }
  });

  it("cada submódulo do rollout tem flag e env 1:1", () => {
    for (const id of [
      "treasury.enabled",
      "treasury.accounts.enabled",
      "treasury.reports.enabled",
    ] as const) {
      assert.ok(TREASURY_FEATURE_FLAG_IDS.includes(id), id);
      assert.ok(TREASURY_FEATURE_FLAG_ENV[id], id);
    }
  });

  it("lista só flags conhecidas habilitadas (opt-out das demais)", () => {
    const enabled = listEnabledTreasuryFeatureFlags({
      ...ALL_OFF_ENV,
      TREASURY_MODULE_ENABLED: "1",
      TREASURY_OFX_IMPORT_ENABLED: "1",
      TREASURY_UNKNOWN: "1",
    });
    assert.deepEqual(enabled, ["treasury.enabled", "treasury.ofxImport.enabled"]);
  });

  it("snapshot: mestra ligada + subflags ausentes = ativação completa", () => {
    const map = getTreasuryFeatureFlagsMap({ TREASURY_MODULE_ENABLED: "1" });
    assert.equal(map["treasury.enabled"], true);
    assert.equal(map["treasury.accounts.enabled"], true);
    assert.equal(map["treasury.reports.enabled"], true);

    const allOn = getTreasuryFeatureFlagsMap(ALL_SUBMODULE_ENV);
    for (const id of TREASURY_FEATURE_FLAG_IDS) {
      assert.equal(allOn[id], true, id);
    }
  });

  it("snapshot: mestra ausente = tudo OFF", () => {
    const map = getTreasuryFeatureFlagsMap({});
    for (const id of TREASURY_FEATURE_FLAG_IDS) {
      assert.equal(map[id], false, id);
    }
  });

  it("ordem de ativação cobre o catálogo de rollout", () => {
    for (const id of TREASURY_ROLLOUT_ACTIVATION_ORDER) {
      assert.ok(TREASURY_FEATURE_FLAG_IDS.includes(id), id);
    }
    assert.equal(TREASURY_ROLLOUT_ACTIVATION_ORDER[0], "treasury.enabled");
  });
});
