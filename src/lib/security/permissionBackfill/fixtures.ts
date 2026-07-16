/**
 * Fixtures para testes de backfill (in-memory).
 */

import { fixtureLeticiaAccountsPayableOnly } from "@/src/lib/security/effectiveAccess/fixtures.ts";
import type { BackfillPortUser } from "./types.ts";

export function fixtureLeticiaBackfillUser(): BackfillPortUser {
  const input = fixtureLeticiaAccountsPayableOnly();
  return {
    userId: input.userId,
    role: input.role as BackfillPortUser["role"],
    legacyPermissions: input.legacyPermissions ?? [],
    overrides: [
      {
        resourceKey: "finance.accounts_payable",
        canView: true,
        canExecute: null,
        canManage: null,
        reason: "fixture-override",
      },
      {
        resourceKey: "financeiro.contas_pagar",
        canView: true,
        canExecute: null,
        canManage: null,
        reason: "fixture-override-seed",
      },
    ],
  };
}

export function fixtureMegaKeyUser(): BackfillPortUser {
  return {
    userId: "legacy-mega",
    role: "VIEWER",
    legacyPermissions: ["costs.view", "finance.accountsPayable.view"],
    overrides: [],
  };
}

export function fixtureAliasUser(): BackfillPortUser {
  return {
    userId: "alias-user",
    role: "VIEWER",
    legacyPermissions: ["dashboard.view", "finance.accountsPayable.view"],
    overrides: [],
  };
}

export function fixtureEmptyUser(): BackfillPortUser {
  return {
    userId: "empty-user",
    role: "VIEWER",
    legacyPermissions: [],
    overrides: [],
  };
}

export function fixtureSuperAdminUser(): BackfillPortUser {
  return {
    userId: "sa-user",
    role: "SUPER_ADMIN",
    legacyPermissions: [],
    overrides: [],
  };
}

export function buildBackfillTestUsers(): BackfillPortUser[] {
  return [
    fixtureLeticiaBackfillUser(),
    fixtureMegaKeyUser(),
    fixtureAliasUser(),
    fixtureEmptyUser(),
    fixtureSuperAdminUser(),
  ];
}
