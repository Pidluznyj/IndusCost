/**
 * Seeds exibidos no editor de permissões (usuário / perfil).
 * Mantém chaves legadas no catálogo para enforcement/aliases, mas oculta
 * raízes/ramos PT que já têm irmão canônico (evita "Comercial"/"Financeiro" duplicados).
 */

import {
  PERMISSION_RESOURCE_SEEDS,
  type PermissionResourceSeed,
} from "@/src/lib/permissionResourceSeedData.js";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/index.js";

function buildBridgedLegacyKeys(): Set<string> {
  const bridged = new Set<string>();
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    for (const rel of r.relationalResourceKeys ?? []) {
      const key = rel.trim();
      // Ignora self-alias (ex.: dashboard → ["dashboard"]) — senão a UI some.
      if (key && key !== r.resourceKey) bridged.add(key);
    }
  }
  return bridged;
}

const BRIDGED_LEGACY_KEYS = buildBridgedLegacyKeys();

/** Chaves seed PT que são alias de um recurso canônico (não devem aparecer na UI). */
export function listBridgedLegacyPermissionSeedKeys(): ReadonlySet<string> {
  return BRIDGED_LEGACY_KEYS;
}

/**
 * Seeds para árvores admin: exclui aliases legados e descendentes cujo ancestral
 * está bridged (ex.: comercial.documentos_saida sob comercial).
 */
export function listPermissionSeedsForAdminUi(
  seeds: readonly PermissionResourceSeed[] = PERMISSION_RESOURCE_SEEDS
): PermissionResourceSeed[] {
  const byKey = new Map(seeds.map((s) => [s.key, s]));
  const hiddenMemo = new Map<string, boolean>();

  const isHidden = (key: string, stack = new Set<string>()): boolean => {
    const cached = hiddenMemo.get(key);
    if (cached !== undefined) return cached;
    if (BRIDGED_LEGACY_KEYS.has(key)) {
      hiddenMemo.set(key, true);
      return true;
    }
    if (stack.has(key)) {
      hiddenMemo.set(key, false);
      return false;
    }
    stack.add(key);
    const seed = byKey.get(key);
    const parentHidden = seed?.parentKey
      ? isHidden(seed.parentKey, stack)
      : false;
    hiddenMemo.set(key, parentHidden);
    return parentHidden;
  };

  return seeds.filter((s) => !isHidden(s.key));
}
