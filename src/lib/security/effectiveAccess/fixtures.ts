/**
 * Fixtures para testes e shadow compare (P03).
 */

import type { EffectiveAccessInput } from "./types.ts";

/** Leticia alvo: VIEWER + snapshot vazio + só Contas a Pagar. */
export function fixtureLeticiaAccountsPayableOnly(): EffectiveAccessInput {
  return {
    userId: "leticia-p03",
    role: "VIEWER",
    permissionsVersion: 1,
    profileSnapshot: {},
    overrides: {
      "finance.accounts_payable": { view: "allow" },
    },
    legacyPermissions: ["finance.accountsPayable.view"],
    legacyCompatMode: false,
  };
}

/** Mesmo caso com bag em modo compat 1:1 (sem profile wipe). */
export function fixtureLeticiaLegacyCompatOnly(): EffectiveAccessInput {
  return {
    userId: "leticia-legacy-compat",
    role: "VIEWER",
    profileSnapshot: {},
    legacyPermissions: ["finance.accountsPayable.view"],
    legacyCompatMode: true,
  };
}

/** VIEWER só role preset (comercial no seed) — sem overrides. */
export function fixtureViewerRolePreset(): EffectiveAccessInput {
  return {
    userId: "viewer-preset",
    role: "VIEWER",
    permissionsVersion: 0,
  };
}

/** SUPER_ADMIN. */
export function fixtureSuperAdmin(): EffectiveAccessInput {
  return {
    userId: "sa-1",
    role: "SUPER_ADMIN",
    permissionsVersion: 9,
  };
}

/** Deny vence allow no mesmo recurso. */
export function fixtureDenyWinsAllow(): EffectiveAccessInput {
  return {
    userId: "deny-wins",
    role: "VIEWER",
    profileSnapshot: {
      "finance.accounts_payable": { view: true },
    },
    overrides: {
      "finance.accounts_payable": { view: "deny" },
    },
  };
}

/** Parent deny bloqueia child allow. */
export function fixtureParentDenyBlocksChild(): EffectiveAccessInput {
  return {
    userId: "parent-deny",
    role: "VIEWER",
    profileSnapshot: {},
    overrides: {
      finance: { view: "deny" },
      "finance.accounts_payable": { view: "allow" },
    },
  };
}

/** Perfil snapshot concede AP; role seria comercial. */
export function fixtureProfileSnapshotAp(): EffectiveAccessInput {
  return {
    userId: "profile-ap",
    role: "VIEWER",
    profileSnapshot: {
      "finance.accounts_payable": { view: true },
    },
  };
}

/** Usuário legado com mega-key costs.view em compat mode. */
export function fixtureLegacyMegaKey(): EffectiveAccessInput {
  return {
    userId: "legacy-mega",
    role: "VIEWER",
    profileSnapshot: {},
    legacyPermissions: ["costs.view", "finance.accountsPayable.view"],
    legacyCompatMode: true,
    legacySkipMegaKeys: true,
  };
}

/** Alias 1:1 finance.accountsPayable.view → AP. */
export function fixtureAliasOneToOne(): EffectiveAccessInput {
  return {
    userId: "alias-1to1",
    role: "VIEWER",
    profileSnapshot: {},
    legacyPermissions: ["finance.accountsPayable.view"],
    legacyCompatMode: true,
  };
}
