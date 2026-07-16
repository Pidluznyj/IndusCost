/**
 * Estados de override por eixo (P05): INHERIT | ALLOW | DENY.
 * Persistência DB: null | true | false (UserPermissionOverride.can*).
 */

export const PERMISSION_OVERRIDE_STATES = ["INHERIT", "ALLOW", "DENY"] as const;
export type PermissionOverrideState = (typeof PERMISSION_OVERRIDE_STATES)[number];

export type PermissionOverrideAxis = "view" | "execute" | "manage";

/** Codifica estado → coluna Boolean? do Prisma. */
export function encodeOverrideState(
  state: PermissionOverrideState
): boolean | null {
  if (state === "INHERIT") return null;
  if (state === "ALLOW") return true;
  return false;
}

/** Decodifica coluna Boolean? → estado. */
export function decodeOverrideState(
  value: boolean | null | undefined
): PermissionOverrideState {
  if (value === true) return "ALLOW";
  if (value === false) return "DENY";
  return "INHERIT";
}

/**
 * Diff draft (boolean efetivo desejado) vs baseline da role → estado de override.
 * - igual ao baseline → INHERIT
 * - true e baseline false → ALLOW
 * - false e baseline true → DENY (desmarcar concessão herdada)
 * - false e baseline false → INHERIT (noop; use absolute para DENY explícito)
 */
export function diffBooleanToOverrideState(
  desired: boolean,
  baseline: boolean
): PermissionOverrideState {
  if (desired === baseline) return "INHERIT";
  return desired ? "ALLOW" : "DENY";
}

/**
 * Modo absoluto: desejado true → ALLOW; desejado false → DENY (sempre).
 * Usado para “somente recursos marcados” (ex.: Leticia só Contas a Pagar).
 */
export function absoluteBooleanToOverrideState(
  desired: boolean
): PermissionOverrideState {
  return desired ? "ALLOW" : "DENY";
}

export type AxisStateMap = {
  view: PermissionOverrideState;
  execute: PermissionOverrideState;
  manage: PermissionOverrideState;
};

export type ResourceOverrideStates = {
  resourceKey: string;
  view: PermissionOverrideState;
  execute: PermissionOverrideState;
  manage: PermissionOverrideState;
  reason?: string | null;
};

export type PersistableOverrideRow = {
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
  reason?: string | null;
};

export function statesToPersistableRow(
  states: ResourceOverrideStates
): PersistableOverrideRow | null {
  const canView = encodeOverrideState(states.view);
  const canExecute = encodeOverrideState(states.execute);
  const canManage = encodeOverrideState(states.manage);
  if (canView === null && canExecute === null && canManage === null) {
    return null; // tudo INHERIT → limpar / não gravar
  }
  return {
    resourceKey: states.resourceKey,
    canView,
    canExecute,
    canManage,
    reason: states.reason ?? null,
  };
}

export function persistableRowToStates(
  row: PersistableOverrideRow
): ResourceOverrideStates {
  return {
    resourceKey: row.resourceKey,
    view: decodeOverrideState(row.canView),
    execute: decodeOverrideState(row.canExecute),
    manage: decodeOverrideState(row.canManage),
    reason: row.reason ?? null,
  };
}

/** ALLOW e DENY no mesmo eixo é impossível no encoding; valida payload estruturado. */
export function assertNoAllowDenyConflict(states: AxisStateMap): void {
  for (const axis of ["view", "execute", "manage"] as const) {
    const s = states[axis];
    if (s !== "INHERIT" && s !== "ALLOW" && s !== "DENY") {
      throw new Error(`Estado inválido em ${axis}: ${String(s)}`);
    }
  }
}

export type OverridePersistMode = "differential" | "absolute";
