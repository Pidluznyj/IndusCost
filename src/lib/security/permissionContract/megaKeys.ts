/**
 * Registro explícito de mega-keys e bleeds temporários (P01).
 * Não altera runtime — apenas classifica incompatibilidades no contrato.
 */

import { PERMISSION_CONTRACT_RESOURCES } from "./resources.ts";
import type { PermissionMegaKeyRecord } from "./types.ts";

/**
 * Chaves legadas conhecidas como mega-key ou bleed cross-resource.
 * Fonte: docs/security/permissions-megakey-migration.md + diagnóstico 48ef617.
 */
export const PERMISSION_KNOWN_MEGA_OR_BLEED_KEYS: ReadonlySet<string> = new Set([
  "costs.view",
  "costs.edit",
  "finance.view",
  "finance.accountsPayable.view", // bleed histórico pai/conciliação (runtime); no contrato ainda multi-uso
  "reports.view",
  "settings.view",
]);

/** Chaves que NUNCA são canônicas 1:1 no estado final (sempre mega / bleed). */
export const PERMISSION_HARD_MEGA_KEYS: ReadonlySet<string> = new Set([
  "costs.view",
  "costs.edit",
]);

function resourcesUsingLegacyKey(legacyKey: string): string[] {
  const keys: string[] = [];
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    for (const a of r.actions) {
      if (a.legacyPermissionKeys.includes(legacyKey)) {
        keys.push(r.resourceKey);
        break;
      }
    }
  }
  return keys.sort();
}

/**
 * Inventário estático de mega-keys / bleeds documentados.
 * `resourceKeys` é derivado do contrato atual (evidência).
 */
export function listPermissionMegaKeyRecords(): PermissionMegaKeyRecord[] {
  const records: Omit<PermissionMegaKeyRecord, "resourceKeys">[] = [
    {
      legacyKey: "costs.view",
      kind: "mega_key",
      replacementKeys: [
        "finance.opex",
        "admin.employees",
        "operations.machines",
        "operations.materials",
        "engineering.simulations",
      ],
      migrationStatus: "mega_key_temporary",
      notes:
        "Abre OPEX (legado identificado P09). RH/Máquinas/Suprimentos/Simulações removidos.",
    },
    {
      legacyKey: "costs.edit",
      kind: "mega_key",
      replacementKeys: ["finance.opex", "admin.employees", "operations.machines"],
      migrationStatus: "mega_key_temporary",
      notes: "Par de escrita da mega-key costs.view.",
    },
    {
      legacyKey: "finance.view",
      kind: "mega_key",
      replacementKeys: [
        "finance",
        "finance.cash_flow",
        "finance.accounts_receivable",
        "finance.accounts_payable",
      ],
      migrationStatus: "mega_key_temporary",
      notes:
        "Chave ampla de módulo Financeiro; filhos devem usar aliases 1:1 dedicados.",
    },
    {
      legacyKey: "finance.accountsPayable.view",
      kind: "cross_resource_bleed",
      replacementKeys: ["finance.accounts_payable"],
      migrationStatus: "cross_resource_bleed_temporary",
      notes:
        "Canônica 1:1 com Contas a Pagar (P09). Bleed pai/conciliação removido do seed/FE/runtime.",
    },
    {
      legacyKey: "reports.view",
      kind: "mega_key",
      replacementKeys: ["finance.cash_flow", "dashboard"],
      migrationStatus: "mega_key_temporary",
      notes: "Usada como OR amplo em fluxos financeiros legados.",
    },
    {
      legacyKey: "settings.view",
      kind: "mega_key",
      replacementKeys: ["admin.settings"],
      migrationStatus: "mega_key_temporary",
      notes: "Às vezes OR em sync/admin; alvo é settings dedicado por recurso.",
    },
  ];

  return records.map((r) => ({
    ...r,
    resourceKeys: resourcesUsingLegacyKey(r.legacyKey),
  }));
}

export function isKnownMegaOrBleedKey(legacyKey: string): boolean {
  return PERMISSION_KNOWN_MEGA_OR_BLEED_KEYS.has(legacyKey);
}

export function isHardMegaKey(legacyKey: string): boolean {
  return PERMISSION_HARD_MEGA_KEYS.has(legacyKey);
}

/**
 * Detecta chaves legadas que aparecem em ≥2 resourceKeys distintos no contrato.
 * Inclui mega-keys e bleeds ainda não listados explicitamente.
 */
export function detectCrossResourceLegacyKeys(
  resources = PERMISSION_CONTRACT_RESOURCES
): Map<string, string[]> {
  const owners = new Map<string, Set<string>>();
  for (const r of resources) {
    for (const a of r.actions) {
      for (const legacy of a.legacyPermissionKeys) {
        if (!owners.has(legacy)) owners.set(legacy, new Set());
        owners.get(legacy)!.add(r.resourceKey);
      }
    }
  }
  const multi = new Map<string, string[]>();
  for (const [legacy, set] of owners) {
    if (set.size >= 2) {
      multi.set(legacy, [...set].sort());
    }
  }
  return multi;
}
