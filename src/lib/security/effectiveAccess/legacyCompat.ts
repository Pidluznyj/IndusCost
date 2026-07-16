/**
 * Projeção da bag legada → grants estruturados (somente modo compat explícito).
 * Mega-keys e aliases multi-recurso geram warnings e são pulados por default.
 */

import {
  isHardMegaKey,
  isKnownMegaOrBleedKey,
} from "@/src/lib/security/permissionContract/megaKeys.ts";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/resources.ts";
import type {
  PermissionContractAction,
  PermissionContractResource,
} from "@/src/lib/security/permissionContract/types.ts";
import type {
  EffectiveAccessBaselineMap,
  EffectiveAccessWarning,
} from "./types.ts";

/** Índice legado → { resourceKey, action } 1:1 preferencial. */
function buildOneToOneLegacyIndex(
  resources: readonly PermissionContractResource[]
): Map<string, { resourceKey: string; action: PermissionContractAction }> {
  const owners = new Map<string, Array<{ resourceKey: string; action: PermissionContractAction; index: number }>>();

  for (const r of resources) {
    for (const binding of r.actions) {
      binding.legacyPermissionKeys.forEach((legacy, index) => {
        const list = owners.get(legacy) ?? [];
        list.push({ resourceKey: r.resourceKey, action: binding.action, index });
        owners.set(legacy, list);
      });
    }
  }

  const oneToOne = new Map<
    string,
    { resourceKey: string; action: PermissionContractAction }
  >();

  for (const [legacy, list] of owners) {
    // Alias 1:1 canônico = aparece como preferencial (índice 0) em exatamente um resourceKey.
    // Aparições secundárias (índice > 0) em outros recursos (ex.: cash_flow OR amplo) não desqualificam.
    const primaries = list.filter((l) => l.index === 0);
    const primaryResources = new Set(primaries.map((p) => p.resourceKey));
    if (primaryResources.size !== 1) continue;
    const preferred =
      primaries.find((p) => p.action === "view") ?? primaries[0]!;
    oneToOne.set(legacy, {
      resourceKey: preferred.resourceKey,
      action: preferred.action,
    });
  }

  return oneToOne;
}

let cachedOneToOne: Map<
  string,
  { resourceKey: string; action: PermissionContractAction }
> | null = null;

export function getOneToOneLegacyIndex(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): Map<string, { resourceKey: string; action: PermissionContractAction }> {
  if (resources === PERMISSION_CONTRACT_RESOURCES) {
    if (!cachedOneToOne) cachedOneToOne = buildOneToOneLegacyIndex(resources);
    return cachedOneToOne;
  }
  return buildOneToOneLegacyIndex(resources);
}

export function projectLegacyBagToBaseline(args: {
  legacyPermissions: readonly string[];
  skipMegaKeys?: boolean;
  resources?: readonly PermissionContractResource[];
}): {
  grants: EffectiveAccessBaselineMap;
  warnings: EffectiveAccessWarning[];
} {
  const resources = args.resources ?? PERMISSION_CONTRACT_RESOURCES;
  const skipMega = args.skipMegaKeys !== false;
  const index = getOneToOneLegacyIndex(resources);
  const warnings: EffectiveAccessWarning[] = [];
  const out: Record<string, Partial<Record<PermissionContractAction, true>>> = {};

  for (const raw of args.legacyPermissions) {
    const key = raw.trim();
    if (!key) continue;

    if (skipMega && (isHardMegaKey(key) || isKnownMegaOrBleedKey(key))) {
      // finance.accountsPayable.view is bleed-known but also the 1:1 AP key —
      // only skip hard mega and multi-owner known bleeds that aren't 1:1 in contract.
      if (isHardMegaKey(key)) {
        warnings.push({
          code: "LEGACY_MEGA_KEY_SKIPPED",
          message: `Mega-key ignorada na projeção 1:1: ${key}`,
          subject: key,
        });
        continue;
      }
      // Known bleed keys: allow only if 1:1 index has exactly one mapping
      if (!index.has(key)) {
        warnings.push({
          code: "LEGACY_MEGA_KEY_SKIPPED",
          message: `Alias amplo/bleed sem mapeamento 1:1 ignorado: ${key}`,
          subject: key,
        });
        continue;
      }
    }

    const hit = index.get(key);
    if (!hit) {
      // Multi-owner in contract?
      const multi: string[] = [];
      for (const r of resources) {
        for (const a of r.actions) {
          if (a.legacyPermissionKeys.includes(key)) multi.push(r.resourceKey);
        }
      }
      if (multi.length > 1) {
        warnings.push({
          code: "LEGACY_MULTI_RESOURCE_ALIAS",
          message: `Alias legado mapeia ${multi.length} recursos — não projetado: ${key}`,
          subject: key,
        });
      } else {
        warnings.push({
          code: "LEGACY_UNMAPPED_KEY",
          message: `Chave legada sem alias 1:1 no contrato: ${key}`,
          subject: key,
        });
      }
      continue;
    }

    if (!out[hit.resourceKey]) out[hit.resourceKey] = {};
    out[hit.resourceKey]![hit.action] = true;
  }

  return { grants: out, warnings };
}
