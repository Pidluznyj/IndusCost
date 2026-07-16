/**
 * Validadores e helpers do contrato canônico (Prompt 02).
 * Não conecta ao runtime de autorização.
 */

import { ALL_PERMISSION_KEYS } from "@/src/lib/permissionCatalog.js";
import {
  PERMISSION_CONTRACT_FORBIDDEN_DELETE_KEYS,
  PERMISSION_CONTRACT_RESOURCES,
} from "./resources.ts";
import {
  PERMISSION_CONTRACT_ACTIONS,
  type PermissionContractAction,
  type PermissionContractIssue,
  type PermissionContractResource,
} from "./types.ts";

const RESOURCE_KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)*$/;

const KNOWN_LEGACY = new Set(ALL_PERMISSION_KEYS);

export function listPermissionContractResources(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): readonly PermissionContractResource[] {
  return resources;
}

export function listPermissionContractResourceKeys(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string[] {
  return resources.map((r) => r.resourceKey);
}

export function countPermissionContractActions(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): number {
  return resources.reduce((n, r) => n + r.actions.length, 0);
}

export function listPermissionContractLegacyAliases(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string[] {
  const set = new Set<string>();
  for (const r of resources) {
    for (const a of r.actions) {
      for (const k of a.legacyPermissionKeys) set.add(k);
    }
  }
  return [...set].sort();
}

function detectCycle(
  resourceKey: string,
  byKey: Map<string, PermissionContractResource>
): boolean {
  const seen = new Set<string>();
  let current: string | null = resourceKey;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = byKey.get(current)?.parentKey ?? null;
  }
  return false;
}

/** Issues estruturais do contrato (invariantes). */
export function validatePermissionContract(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES,
  options?: { knownLegacyKeys?: ReadonlySet<string> }
): PermissionContractIssue[] {
  const issues: PermissionContractIssue[] = [];
  const knownLegacy = options?.knownLegacyKeys ?? KNOWN_LEGACY;
  const byKey = new Map<string, PermissionContractResource>();
  const forbiddenDelete = new Set<string>(PERMISSION_CONTRACT_FORBIDDEN_DELETE_KEYS);

  for (const r of resources) {
    if (byKey.has(r.resourceKey)) {
      issues.push({
        code: "DUPLICATE_RESOURCE_KEY",
        message: `resourceKey duplicado: ${r.resourceKey}`,
        resourceKey: r.resourceKey,
      });
    } else {
      byKey.set(r.resourceKey, r);
    }

    if (!RESOURCE_KEY_PATTERN.test(r.resourceKey)) {
      issues.push({
        code: "INVALID_RESOURCE_KEY_FORMAT",
        message: `formato inválido: ${r.resourceKey}`,
        resourceKey: r.resourceKey,
      });
    }

    if (r.actions.length === 0) {
      issues.push({
        code: "EMPTY_ACTIONS",
        message: `recurso sem ações: ${r.resourceKey}`,
        resourceKey: r.resourceKey,
      });
    }

    const actionSeen = new Set<PermissionContractAction>();
    for (const binding of r.actions) {
      if (
        !(PERMISSION_CONTRACT_ACTIONS as readonly string[]).includes(binding.action)
      ) {
        issues.push({
          code: "UNKNOWN_ACTION",
          message: `ação desconhecida ${binding.action} em ${r.resourceKey}`,
          resourceKey: r.resourceKey,
        });
      }
      if (actionSeen.has(binding.action)) {
        issues.push({
          code: "UNKNOWN_ACTION",
          message: `ação duplicada ${binding.action} em ${r.resourceKey}`,
          resourceKey: r.resourceKey,
        });
      }
      actionSeen.add(binding.action);

      if (binding.legacyPermissionKeys.length === 0) {
        issues.push({
          code: "EMPTY_LEGACY_KEYS",
          message: `ação ${binding.action} sem legacy keys em ${r.resourceKey}`,
          resourceKey: r.resourceKey,
        });
      }
      for (const legacy of binding.legacyPermissionKeys) {
        if (!knownLegacy.has(legacy)) {
          issues.push({
            code: "UNKNOWN_LEGACY_KEY",
            message: `legacy key ausente do catálogo: ${legacy} (${r.resourceKey}.${binding.action})`,
            resourceKey: r.resourceKey,
          });
        }
      }

      if (binding.action === "delete" && forbiddenDelete.has(r.resourceKey)) {
        issues.push({
          code: "FORBIDDEN_DELETE",
          message: `delete proibido em ${r.resourceKey}`,
          resourceKey: r.resourceKey,
        });
      }
    }
  }

  for (const r of resources) {
    if (r.parentKey == null) continue;
    if (!byKey.has(r.parentKey)) {
      issues.push({
        code: "MISSING_PARENT",
        message: `parent inexistente: ${r.parentKey} ← ${r.resourceKey}`,
        resourceKey: r.resourceKey,
      });
    }
  }

  for (const r of resources) {
    if (detectCycle(r.resourceKey, byKey)) {
      issues.push({
        code: "CYCLE",
        message: `ciclo na hierarquia em ${r.resourceKey}`,
        resourceKey: r.resourceKey,
      });
    }
  }

  // sortOrder único entre irmãos
  const siblings = new Map<string, Map<number, string>>();
  for (const r of resources) {
    const parent = r.parentKey ?? "__root__";
    if (!siblings.has(parent)) siblings.set(parent, new Map());
    const map = siblings.get(parent)!;
    if (map.has(r.sortOrder)) {
      issues.push({
        code: "DUPLICATE_SORT_ORDER_SIBLING",
        message: `sortOrder ${r.sortOrder} duplicado sob ${parent}: ${map.get(r.sortOrder)} e ${r.resourceKey}`,
        resourceKey: r.resourceKey,
      });
    } else {
      map.set(r.sortOrder, r.resourceKey);
    }
  }

  // aliases relacionais conflitantes (mesma chave PT em resources diferentes)
  const relationalOwners = new Map<string, string>();
  for (const r of resources) {
    for (const rel of r.relationalResourceKeys) {
      const prev = relationalOwners.get(rel);
      if (prev && prev !== r.resourceKey) {
        issues.push({
          code: "CONFLICTING_RELATIONAL_ALIAS",
          message: `relational key ${rel} em ${prev} e ${r.resourceKey}`,
          resourceKey: r.resourceKey,
        });
      } else {
        relationalOwners.set(rel, r.resourceKey);
      }
    }
  }

  // deprecated / replacementKeys (P01)
  const keySet = new Set(resources.map((r) => r.resourceKey));
  for (const r of resources) {
    if (r.deprecated && (!r.replacementKeys || r.replacementKeys.length === 0)) {
      issues.push({
        code: "DEPRECATED_WITHOUT_REPLACEMENT",
        message: `recurso depreciado sem replacementKeys: ${r.resourceKey}`,
        resourceKey: r.resourceKey,
      });
    }
    for (const rep of r.replacementKeys ?? []) {
      if (!keySet.has(rep)) {
        issues.push({
          code: "INVALID_REPLACEMENT_KEY",
          message: `replacementKey inexistente ${rep} em ${r.resourceKey}`,
          resourceKey: r.resourceKey,
        });
      }
    }
  }

  return issues;
}

const MATRIX_ACTIONS: PermissionContractAction[] = [
  "view",
  "create",
  "update",
  "delete",
  "export",
  "execute",
  "manage",
];

const MATRIX_HEADERS_PT: Record<string, string> = {
  view: "Ver",
  create: "Criar",
  update: "Editar",
  delete: "Excluir",
  export: "Exportar",
  execute: "Executar",
  manage: "Gerenciar",
};

function cellFor(
  resource: PermissionContractResource,
  action: PermissionContractAction
): string {
  const hit = resource.actions.find((a) => a.action === action);
  if (!hit) return "n/a";
  return "✓";
}

function specificActions(resource: PermissionContractResource): string {
  const specifics = resource.actions
    .filter((a) => !MATRIX_ACTIONS.includes(a.action))
    .map((a) => a.action)
    .join(", ");
  return specifics || "—";
}

/** Markdown da matriz alvo (Prompt 02). */
export function formatPermissionTargetMatrixMarkdown(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string {
  const header =
    "| Recurso | Label | Ver | Criar | Editar | Excluir | Exportar | Executar | Gerenciar | Ações específicas |\n" +
    "|---------|-------|-----|-------|--------|---------|----------|----------|-----------|-------------------|";

  const rows = [...resources]
    .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey))
    .map((r) => {
      const cells = MATRIX_ACTIONS.map((a) => cellFor(r, a)).join(" | ");
      return `| \`${r.resourceKey}\` | ${r.label} | ${cells} | ${specificActions(r)} |`;
    });

  const legend =
    "\n\nLegenda: `✓` = ação aplicável no contrato (há capacidade/legado real); `n/a` = não aplicável.\n" +
    "Ações específicas fora das colunas: " +
    ["approve", "close", "reopen", "reprocess"].join(", ") +
    ".\n";

  void MATRIX_HEADERS_PT;
  return [
    "# Matriz alvo de permissões (contrato canônico)",
    "",
    "| | |",
    "|---|---|",
    "| **Projeto** | IndusCost / My Industry |",
    "| **Data** | 2026-07-15 |",
    "| **Fonte** | `src/lib/security/permissionContract` |",
    "| **Status** | Contrato tipado — **não** conectado ao runtime de auth |",
    "| **Pré-req** | Prompt 01 (`permissions-current-state.md`) |",
    "",
    "Regenerar: `npx tsx -e \"import { formatPermissionTargetMatrixMarkdown } from './src/lib/security/permissionContract/index.ts'; console.log(formatPermissionTargetMatrixMarkdown())\"`",
    "",
    header,
    rows.join("\n") + legend,
  ].join("\n");
}

export function summarizePermissionContract(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): {
  resourceCount: number;
  actionBindingCount: number;
  legacyAliasCount: number;
  sidebarCount: number;
  tabCount: number;
  issueCount: number;
} {
  return {
    resourceCount: resources.length,
    actionBindingCount: countPermissionContractActions(resources),
    legacyAliasCount: listPermissionContractLegacyAliases(resources).length,
    sidebarCount: resources.filter((r) => r.appearsInSidebar).length,
    tabCount: resources.filter((r) => r.isTab).length,
    issueCount: validatePermissionContract(resources).length,
  };
}
