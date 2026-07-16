/**
 * Comparação por usuário / fixture — legado bag OR × resolveEffectiveAccess (requireResource).
 */

import { createHash } from "node:crypto";
import {
  canEffectiveAccess,
  resolveEffectiveAccess,
} from "@/src/lib/security/effectiveAccess/resolveEffectiveAccess.ts";
import { isRequireResourceLegacyCompatEnabled } from "@/src/lib/security/requireResource.js";
import { buildMigratedAccessProbes, MIGRATED_MODULE_SCOPE } from "./migratedProbes.ts";
import { evaluateLegacyBagOr } from "./legacyEval.ts";
import {
  classifyAccessDiff,
  emptyCategoryCounts,
  incrementCategory,
} from "./classify.ts";
import type {
  AccessComparisonCell,
  AccessComparisonGlobalReport,
  AccessComparisonProfileSummary,
  AccessComparisonSubject,
  AccessComparisonUserReport,
  AccessDiffCategory,
} from "./types.ts";

export function hashSubjectRef(subjectId: string): string {
  return createHash("sha256").update(subjectId).digest("hex").slice(0, 12);
}

export function hashProfileRef(profileId: string | null | undefined): string | null {
  if (!profileId) return null;
  return createHash("sha256").update(`profile:${profileId}`).digest("hex").slice(0, 12);
}

function buildRequireResourceLikeInput(subject: AccessComparisonSubject) {
  const legacy = subject.input.legacyPermissions ?? [];
  const legacyCompatMode =
    subject.input.legacyCompatMode ??
    (legacy.length > 0 ? isRequireResourceLegacyCompatEnabled() : false);

  return {
    ...subject.input,
    userId: subject.input.userId ?? subject.subjectId,
    legacyPermissions: legacy,
    legacyCompatMode,
    legacySkipMegaKeys: subject.input.legacySkipMegaKeys !== false,
  };
}

export function compareAccessForSubject(
  subject: AccessComparisonSubject,
  probes = buildMigratedAccessProbes()
): AccessComparisonUserReport {
  const input = buildRequireResourceLikeInput(subject);
  const resolved = resolveEffectiveAccess(input);
  const legacyBag = input.legacyPermissions ?? [];
  const hasProfileReplace = input.profileSnapshot !== undefined;

  const categoryCounts = emptyCategoryCounts();
  const diffs: AccessComparisonCell[] = [];

  for (const probe of probes) {
    const legacy = evaluateLegacyBagOr({
      role: subject.role,
      legacyPermissions: legacyBag,
      resourceKey: probe.resourceKey,
      action: probe.action,
    });

    const newAllow = canEffectiveAccess(resolved, probe.resourceKey, probe.action);
    const newSource =
      resolved.byResourceAction[probe.resourceKey]?.[probe.action]?.source ??
      "DENY_DEFAULT";

    const category = classifyAccessDiff({
      resourceKey: probe.resourceKey,
      action: probe.action,
      legacy,
      newAllow,
      newSource,
      hasProfileReplace,
    });

    incrementCategory(categoryCounts, category);

    if (category !== "both_denied" && category !== "preserved_intentional") {
      diffs.push({
        resourceKey: probe.resourceKey,
        action: probe.action,
        legacyAllow: legacy.allow,
        newAllow,
        newSource,
        category,
        legacyGrantingKeys: legacy.grantingKeys,
        legacyBleedKeys: legacy.bleedKeys,
        legacyDedicatedKeys: legacy.dedicatedKeys,
      });
    } else if (
      category === "preserved_intentional" &&
      legacy.bleedKeys.length > 0 &&
      legacy.dedicatedKeys.length === 0
    ) {
      // Guard rail: bleed-only não pode ser preservado
      const corrected: AccessDiffCategory = newAllow ? "new_legitimate_access" : "mega_key_bleed";
      incrementCategory(categoryCounts, corrected);
      categoryCounts.preserved_intentional -= 1;
      diffs.push({
        resourceKey: probe.resourceKey,
        action: probe.action,
        legacyAllow: legacy.allow,
        newAllow,
        newSource,
        category: corrected,
        legacyGrantingKeys: legacy.grantingKeys,
        legacyBleedKeys: legacy.bleedKeys,
        legacyDedicatedKeys: legacy.dedicatedKeys,
        note: "bleed-only corrected from preserved_intentional",
      });
    }
  }

  return {
    subjectRef: hashSubjectRef(subject.subjectId),
    role: subject.role,
    accessProfileRef: hashProfileRef(subject.accessProfileId),
    scenarioTag: subject.scenarioTag ?? null,
    legacyCompatMode: input.legacyCompatMode === true,
    legacyPermissionCount: legacyBag.length,
    overrideResourceCount: Object.keys(input.overrides ?? {}).length,
    probeCount: probes.length,
    categoryCounts,
    diffs,
    lockoutRiskCount: categoryCounts.lockout_risk,
    megaKeyBleedCount: categoryCounts.mega_key_bleed,
  };
}

function aggregateProfiles(
  users: AccessComparisonUserReport[],
  subjects: AccessComparisonSubject[]
): AccessComparisonProfileSummary[] {
  const byProfile = new Map<
    string,
    { label: string | null; users: AccessComparisonUserReport[] }
  >();

  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    const s = subjects[i]!;
    const pref = u.accessProfileRef ?? "__no_profile__";
    const entry = byProfile.get(pref) ?? {
      label: s.accessProfileLabel ?? null,
      users: [],
    };
    entry.users.push(u);
    byProfile.set(pref, entry);
  }

  return [...byProfile.entries()]
    .map(([accessProfileRef, { label, users: group }]) => {
      const categoryCounts = emptyCategoryCounts();
      for (const u of group) {
        for (const [cat, n] of Object.entries(u.categoryCounts) as [
          AccessDiffCategory,
          number,
        ][]) {
          categoryCounts[cat] += n;
        }
      }
      return {
        accessProfileRef: accessProfileRef === "__no_profile__" ? "none" : accessProfileRef,
        accessProfileLabel: label,
        subjectCount: group.length,
        categoryCounts,
        lockoutRiskCount: categoryCounts.lockout_risk,
        megaKeyBleedCount: categoryCounts.mega_key_bleed,
      };
    })
    .sort((a, b) => a.accessProfileRef.localeCompare(b.accessProfileRef));
}

export function runAccessComparison(
  subjects: readonly AccessComparisonSubject[],
  probes = buildMigratedAccessProbes()
): AccessComparisonGlobalReport {
  const users = subjects.map((s) => compareAccessForSubject(s, probes));
  const categoryCounts = emptyCategoryCounts();

  for (const u of users) {
    for (const [cat, n] of Object.entries(u.categoryCounts) as [AccessDiffCategory, number][]) {
      categoryCounts[cat] += n;
    }
  }

  return {
    dryRun: true,
    generatedAt: new Date().toISOString(),
    migratedModuleScope: [...MIGRATED_MODULE_SCOPE],
    probeCount: probes.length,
    subjectCount: subjects.length,
    categoryCounts,
    lockoutRiskCount: categoryCounts.lockout_risk,
    megaKeyBleedCount: categoryCounts.mega_key_bleed,
    unmappedResourceCount: categoryCounts.unmapped_resource,
    conflictCount: categoryCounts.conflict,
    users,
    byProfile: aggregateProfiles(users, [...subjects]),
    note:
      "Read-only. Bleed/mega-key histórico nunca classificado como preservado intencional. Sem escrita em AppUser/overrides.",
  };
}
