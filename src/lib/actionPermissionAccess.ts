/**
 * P13 — Autorização de ações (botões/menus/export/lote) via contrato + DTO.
 * Regra: mutação exige action específica — nunca só `view`.
 */

import type {
  EffectiveAccessDtoAction,
  EffectiveAccessMeDto,
} from "@/src/lib/effectiveAccessDtoTypes.js";
import { EFFECTIVE_ACCESS_DTO_ACTIONS } from "@/src/lib/effectiveAccessDtoTypes.js";
import { resolveContractKeyForInternalSurface } from "@/src/lib/internalSurfaceAccess.js";
import { projectLegacyBagToBaseline } from "@/src/lib/security/effectiveAccess/legacyCompat.js";
import {
  PERMISSION_CONTRACT_RESOURCES,
  type PermissionContractAction,
} from "@/src/lib/security/permissionContract/index.js";

/** Ações de UI alinhadas ao contrato (+ aliases de produto → action canônica). */
export const UI_PERMISSION_ACTIONS = [
  ...EFFECTIVE_ACCESS_DTO_ACTIONS,
  "cancel",
  "reverse",
  "publish",
  "synchronize",
] as const;

export type UiPermissionAction = (typeof UI_PERMISSION_ACTIONS)[number];

/** Alias de produto → action do DTO/contrato. */
export const UI_ACTION_TO_DTO_ACTION: Record<
  UiPermissionAction,
  EffectiveAccessDtoAction
> = {
  view: "view",
  create: "create",
  update: "update",
  delete: "delete",
  export: "export",
  execute: "execute",
  approve: "approve",
  close: "close",
  reopen: "reopen",
  reprocess: "reprocess",
  manage: "manage",
  cancel: "manage",
  reverse: "execute",
  publish: "manage",
  synchronize: "execute",
};

export type ContractActionMap = Record<
  string,
  EffectiveAccessDtoAction[]
>;

function isDtoAction(a: string): a is EffectiveAccessDtoAction {
  return (EFFECTIVE_ACCESS_DTO_ACTIONS as readonly string[]).includes(a);
}

function addAction(
  map: ContractActionMap,
  resourceKey: string,
  action: EffectiveAccessDtoAction
): void {
  const cur = map[resourceKey] ?? [];
  if (!cur.includes(action)) {
    map[resourceKey] = [...cur, action].sort();
  }
}

/**
 * Projeta bag legada → actionsByResource (todas as actions do contrato com
 * primary legacy na bag). Não promove view a export/manage.
 */
export function projectContractActionsFromLegacyBag(
  legacyPermissions: readonly string[]
): ContractActionMap {
  const bag = new Set(
    legacyPermissions.map((k) => k.trim()).filter((k) => k.length > 0)
  );
  const out: ContractActionMap = {};

  const { grants } = projectLegacyBagToBaseline({
    legacyPermissions: [...bag],
  });
  for (const [resourceKey, actions] of Object.entries(grants)) {
    for (const [action, ok] of Object.entries(actions)) {
      if (ok && isDtoAction(action)) addAction(out, resourceKey, action);
    }
  }

  for (const resource of PERMISSION_CONTRACT_RESOURCES) {
    for (const binding of resource.actions) {
      const action = binding.action as PermissionContractAction;
      if (!isDtoAction(action)) continue;
      const primary = binding.legacyPermissionKeys[0];
      if (primary && bag.has(primary)) {
        addAction(out, resource.resourceKey, action);
      }
    }
  }

  return out;
}

/** Capabilities 3 eixos a partir das actions. */
export function capabilitiesFromActions(
  actions: readonly EffectiveAccessDtoAction[]
): {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
} {
  const set = new Set(actions);
  return {
    canView: set.has("view"),
    canExecute:
      set.has("execute") ||
      set.has("export") ||
      set.has("reprocess") ||
      set.has("approve") ||
      set.has("close") ||
      set.has("reopen"),
    canManage:
      set.has("manage") ||
      set.has("create") ||
      set.has("update") ||
      set.has("delete"),
  };
}

export function mergeActionMaps(
  ...maps: ContractActionMap[]
): ContractActionMap {
  const out: ContractActionMap = {};
  for (const map of maps) {
    for (const [rk, actions] of Object.entries(map)) {
      for (const a of actions) addAction(out, rk, a);
    }
  }
  return out;
}

/**
 * Gate puro sobre DTO — use `canPerformAction` em resourceNavigationAccess
 * para resolver o DTO a partir do contexto de sessão.
 *
 * Mutações finas (export/close/reprocess/…) exigem action listada —
 * `canExecute`/`canManage` genéricos NÃO promovem view→mutate nem execute→export.
 */
export function dtoAllowsAction(
  dto: EffectiveAccessMeDto | null | undefined,
  resourceKey: string,
  action: UiPermissionAction
): boolean {
  if (!dto) return false;
  if (dto.isSuperAdmin) return true;
  const contractKey =
    resolveContractKeyForInternalSurface(resourceKey) ?? resourceKey;
  const dtoAction = UI_ACTION_TO_DTO_ACTION[action];
  const listed = dto.actionsByResource[contractKey];
  if (listed?.includes(dtoAction)) return true;

  const cap = dto.capabilities[contractKey];
  if (!cap) return false;
  // Fallback 3 eixos só para eixos grosseiros — nunca para export/close/reprocess/approve/reopen.
  if (dtoAction === "view") return cap.canView;
  if (dtoAction === "manage") return cap.canManage;
  if (dtoAction === "execute") return cap.canExecute;
  return false;
}

/** Recursos canônicos usados pelos gates P13 (UI). */
export const ACTION_GATE_RESOURCES = {
  financeAccountsPayable: "finance.accounts_payable",
  financeAccountsReceivable: "finance.accounts_receivable",
  financeBilling: "finance.billing",
  commissionsMonthlyClosing: "commercial.commissions.monthly_closing",
  commissionsReprocess: "commercial.commissions.reprocess",
  commissionsClosings: "commercial.commissions.closings",
  salesOrders: "commercial.sales_orders",
  adminUsers: "admin.settings.security",
  adminEmployees: "admin.employees",
  adminSettingsNomus: "admin.settings.nomus_sync",
  commercialPricing: "commercial.pricing",
} as const;

/**
 * Endpoints ainda dependentes de OR legado / view-as-mutate — fila P14.
 * UI pode esconder; API deve validar action canônica.
 */
export const P14_PENDING_ACTION_ENDPOINTS = [
  {
    method: "POST",
    path: "/api/finance/accounts-payable/export",
    resourceKey: "finance.accounts_payable",
    action: "export" as const,
    note: "UI exige .export; confirmar API não aceita só view.",
  },
  {
    method: "POST",
    path: "/api/finance/accounts-receivable/export",
    resourceKey: "finance.accounts_receivable",
    action: "export" as const,
    note: "UI exige .export; confirmar API não aceita só view.",
  },
  {
    method: "POST",
    path: "/api/commissions/receipt-closing/apply",
    resourceKey: "commercial.commissions.monthly_closing",
    action: "close" as const,
    note: "Alinhar requirePermission a close/manage canônico (não view).",
  },
  {
    method: "POST",
    path: "/api/commissions/receipt-closing/reprocess-apply",
    resourceKey: "commercial.commissions.monthly_closing",
    action: "reprocess" as const,
    note: "Exigir reprocess/manage; UI já bloqueia sem action.",
  },
  {
    method: "POST",
    path: "/api/commissions/reprocess",
    resourceKey: "commercial.commissions.reprocess",
    action: "reprocess" as const,
    note: "Substituir gate por role ADMIN; exigir reprocess/execute.",
  },
  {
    method: "POST",
    path: "/api/settings/nomus-sync/*",
    resourceKey: "admin.settings.nomus_sync",
    action: "execute" as const,
    note: "Garantir settings.nomus.sync (não settings.view) em todos os runs.",
  },
  {
    method: "POST",
    path: "/api/admin/users*",
    resourceKey: "admin.settings.security",
    action: "manage" as const,
    note: "Create/update/delete users — confirmar users.manage em todas as mutações.",
  },
  {
    method: "GET",
    path: "/api/sales-orders/export*",
    resourceKey: "commercial.sales_orders",
    action: "export" as const,
    note: "Contrato ainda mapeia export←sales_orders.view; avaliar chave .export.",
  },
] as const;

export function listP14PendingActionEndpoints(): readonly {
  method: string;
  path: string;
  resourceKey: string;
  action: string;
  note: string;
}[] {
  return P14_PENDING_ACTION_ENDPOINTS;
}
