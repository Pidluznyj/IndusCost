/**
 * Comparação shadow: resolveEffectiveAccess (alvo) × comportamento atual documentado.
 * Diferenças são reportadas — não escondidas.
 */

import { getEffectivePermissions } from "@/src/lib/appAuth.js";
import type { AppUserRole } from "@prisma/client";
import {
  canAccessResource,
  createSeedPermissionSnapshot,
} from "@/src/lib/security/permissionService.js";
import {
  canEffectiveAccess,
  canRevealNavigation,
  resolveEffectiveAccess,
} from "./resolveEffectiveAccess.ts";
import type {
  EffectiveAccessInput,
  EffectiveAccessShadowDiff,
  EffectiveAccessShadowReport,
} from "./types.ts";

export type ShadowCompareProbe = {
  resourceKey: string;
  /** Ação no modelo novo (contrato). */
  action: "view" | "execute" | "manage";
  /**
   * Chave no seed relacional para permissionService atual (se houver).
   * null = incomparável no motor seed.
   */
  currentSeedResourceKey?: string | null;
  /** Chaves legadas que o modelo atual usaria na bag para “ter acesso”. */
  currentLegacyKeys?: readonly string[];
  note?: string;
};

/**
 * Avalia se o modelo atual (bag filtrada) “teria” alguma das legacy keys.
 * Não aplica aliases FE — só presença na bag efetiva (como getEffectivePermissions).
 */
function currentBagHas(
  role: string,
  legacyPermissions: readonly string[],
  keys: readonly string[]
): boolean {
  if (role === "SUPER_ADMIN") return true;
  const eff = getEffectivePermissions({
    role: role as AppUserRole,
    permissions: [...legacyPermissions],
  });
  return keys.some((k) => eff.includes(k));
}

export function compareEffectiveAccessWithCurrent(args: {
  fixtureId: string;
  description: string;
  input: EffectiveAccessInput;
  probes: readonly ShadowCompareProbe[];
}): EffectiveAccessShadowReport {
  const next = resolveEffectiveAccess(args.input);
  const legacy = args.input.legacyPermissions ?? [];
  const role = args.input.role;

  const seedSnap =
    role !== "SUPER_ADMIN"
      ? createSeedPermissionSnapshot({
          role: role as AppUserRole,
          userId: args.input.userId,
          overrides: [],
        })
      : null;

  const diffs: EffectiveAccessShadowDiff[] = [];

  for (const probe of args.probes) {
    const nextAllow = canEffectiveAccess(next, probe.resourceKey, probe.action);
    const nextSource =
      next.byResourceAction[probe.resourceKey]?.[probe.action]?.source ??
      "DENY_DEFAULT";

    let current: "allow" | "deny" | "n/a" = "n/a";
    let currentNote = probe.note ?? "";

    // 1) Bag literal
    if (probe.currentLegacyKeys && probe.currentLegacyKeys.length > 0) {
      const bagHit = currentBagHas(role, legacy, probe.currentLegacyKeys);
      current = bagHit ? "allow" : "deny";
      currentNote =
        (currentNote ? currentNote + " | " : "") +
        `bag.has(${probe.currentLegacyKeys.join("|")})=${bagHit}`;
    }

    // 2) permissionService seed (hierarquia ancestral exige view no pai)
    if (probe.currentSeedResourceKey && seedSnap && role !== "SUPER_ADMIN") {
      const seedAllow = canAccessResource(
        { id: args.input.userId, role: role as AppUserRole },
        probe.currentSeedResourceKey,
        probe.action === "view" ? "view" : probe.action === "manage" ? "manage" : "execute",
        seedSnap
      );
      currentNote =
        (currentNote ? currentNote + " | " : "") +
        `seed.canAccess(${probe.currentSeedResourceKey})=${seedAllow}`;
      // Se já temos bag, preferimos reportar bag como current principal e seed na nota.
      if (current === "n/a") {
        current = seedAllow ? "allow" : "deny";
      }
    }

    // FE alias bleed (documental): se bag tem AP, runtime FE abre finance+conciliação —
    // marcado na nota quando probe pede.
    if (probe.note?.includes("FE_ALIAS_BLEED")) {
      const apInBag = currentBagHas(role, legacy, [
        "finance.accountsPayable.view",
      ]);
      currentNote += ` | FE_ALIAS_BLEED_if_AP=${apInBag}`;
      if (apInBag && (probe.resourceKey.includes("portfolio") || probe.resourceKey === "finance")) {
        // Modelo atual FE concederia via alias — current = allow (documentado)
        current = "allow";
      }
    }

    let kind: EffectiveAccessShadowDiff["kind"] = "incomparable";
    if (current === "n/a") {
      kind = "incomparable";
    } else if (current === (nextAllow ? "allow" : "deny")) {
      kind = "aligned";
    } else if (nextAllow && current === "deny") {
      kind = "next_looser";
    } else if (!nextAllow && current === "allow") {
      kind = "next_stricter";
    }

    diffs.push({
      resourceKey: probe.resourceKey,
      action: probe.action,
      next: nextAllow ? "allow" : "deny",
      nextSource,
      current,
      currentNote,
      kind,
    });
  }

  return {
    fixtureId: args.fixtureId,
    description: args.description,
    diffs,
    alignedCount: diffs.filter((d) => d.kind === "aligned").length,
    nextStricterCount: diffs.filter((d) => d.kind === "next_stricter").length,
    nextLooserCount: diffs.filter((d) => d.kind === "next_looser").length,
    incomparableCount: diffs.filter((d) => d.kind === "incomparable").length,
  };
}

/** Helpers reexportados para fixtures. */
export { canRevealNavigation, resolveEffectiveAccess };
