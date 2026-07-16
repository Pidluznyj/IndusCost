/**
 * Subjects built-in: fixtures, personas, cenário Leticia.
 */

import type { AppUserRole } from "@prisma/client";
import {
  fixtureAliasOneToOne,
  fixtureDenyWinsAllow,
  fixtureLegacyMegaKey,
  fixtureLeticiaAccountsPayableOnly,
  fixtureSuperAdmin,
} from "@/src/lib/security/effectiveAccess/fixtures.ts";
import { PERMISSION_PERSONA_MATRIX } from "@/src/lib/security/permissionPersonaMatrix.ts";
import type { AccessComparisonSubject } from "./types.ts";

function fromEffectiveFixture(
  fixtureId: string,
  scenarioTag: string | null,
  build: () => ReturnType<typeof fixtureLeticiaAccountsPayableOnly>
): AccessComparisonSubject {
  const input = build();
  return {
    subjectId: input.userId,
    role: input.role,
    scenarioTag,
    input,
  };
}

/** Fixtures de teste + cenário Leticia (P03). */
export function buildFixtureComparisonSubjects(): AccessComparisonSubject[] {
  return [
    fromEffectiveFixture("leticia-ap-only", "leticia-ap-only", fixtureLeticiaAccountsPayableOnly),
    fromEffectiveFixture("super-admin", null, fixtureSuperAdmin),
    fromEffectiveFixture("legacy-mega-key", "legacy-mega-key", fixtureLegacyMegaKey),
    fromEffectiveFixture("deny-wins", "deny-wins", fixtureDenyWinsAllow),
    fromEffectiveFixture("alias-1to1", "alias-1to1", fixtureAliasOneToOne),
  ];
}

/** Personas da matriz oficial — bag legada típica, sem overrides estruturados. */
export function buildPersonaComparisonSubjects(): AccessComparisonSubject[] {
  return PERMISSION_PERSONA_MATRIX.map((p) => ({
    subjectId: `persona:${p.id}`,
    role: p.role,
    scenarioTag: `persona:${p.id}`,
    input: {
      userId: `persona:${p.id}`,
      role: p.role,
      legacyPermissions: p.permissions,
      legacyCompatMode: p.permissions.length > 0,
      legacySkipMegaKeys: true,
    },
  }));
}

export function buildDefaultComparisonSubjects(): AccessComparisonSubject[] {
  const seen = new Set<string>();
  const out: AccessComparisonSubject[] = [];
  for (const s of [...buildFixtureComparisonSubjects(), ...buildPersonaComparisonSubjects()]) {
    if (seen.has(s.subjectId)) continue;
    seen.add(s.subjectId);
    out.push(s);
  }
  return out;
}

/** Monta subject a partir de dados AppUser (sem PII na comparação). */
export function subjectFromAppUserRow(row: {
  id: string;
  role: AppUserRole;
  permissions: string[];
  accessProfileId?: string | null;
  accessProfileName?: string | null;
  profileSnapshot?: AccessComparisonSubject["input"]["profileSnapshot"];
  overrides?: AccessComparisonSubject["input"]["overrides"];
  legacyCompatMode?: boolean;
}): AccessComparisonSubject {
  return {
    subjectId: row.id,
    role: row.role,
    accessProfileId: row.accessProfileId ?? null,
    accessProfileLabel: row.accessProfileName ?? null,
    input: {
      userId: row.id,
      role: row.role,
      legacyPermissions: row.permissions,
      legacyCompatMode: row.legacyCompatMode ?? row.permissions.length > 0,
      legacySkipMegaKeys: true,
      profileSnapshot: row.profileSnapshot,
      overrides: row.overrides,
    },
  };
}
