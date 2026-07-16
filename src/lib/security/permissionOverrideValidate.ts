/**
 * Validação e montagem de payloads de override (P05).
 */

import { PERMISSION_RESOURCE_SEEDS } from "@/src/lib/permissionResourceSeedData.js";
import {
  absoluteBooleanToOverrideState,
  diffBooleanToOverrideState,
  encodeOverrideState,
  persistableRowToStates,
  statesToPersistableRow,
  type OverridePersistMode,
  type PersistableOverrideRow,
  type PermissionOverrideState,
  type ResourceOverrideStates,
} from "./permissionOverrideState.ts";

export class PermissionOverrideValidationError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PermissionOverrideValidationError";
    this.code = code;
    this.details = details;
  }
}

const KNOWN_SEED_KEYS = () => new Set(PERMISSION_RESOURCE_SEEDS.map((s) => s.key));

export type RawOverrideInput = {
  resourceKey: string;
  canView?: boolean | null;
  canExecute?: boolean | null;
  canManage?: boolean | null;
  /** Alternativa estruturada (se presente, tem precedência sobre can*). */
  view?: PermissionOverrideState;
  execute?: PermissionOverrideState;
  manage?: PermissionOverrideState;
  reason?: string | null;
};

function isBoolOrNull(v: unknown): v is boolean | null {
  return v === null || typeof v === "boolean";
}

function parseStateField(
  raw: unknown,
  axis: string,
  resourceKey: string
): PermissionOverrideState | undefined {
  if (raw === undefined) return undefined;
  if (raw === "INHERIT" || raw === "ALLOW" || raw === "DENY") return raw;
  throw new PermissionOverrideValidationError(
    "INVALID_OVERRIDE_STATE",
    `Estado inválido para ${resourceKey}.${axis}: use INHERIT|ALLOW|DENY.`,
    { resourceKey, axis, value: raw }
  );
}

/**
 * Valida e normaliza inputs de override.
 * - recurso desconhecido → rejeita
 * - eixos inválidos → rejeita
 * - tudo INHERIT → omite linha (clear)
 */
export function validateAndNormalizeOverrideInputs(
  inputs: readonly RawOverrideInput[],
  options?: { knownKeys?: ReadonlySet<string> }
): PersistableOverrideRow[] {
  const known = options?.knownKeys ?? KNOWN_SEED_KEYS();
  const byKey = new Map<string, PersistableOverrideRow>();

  for (const input of inputs) {
    const resourceKey = String(input.resourceKey ?? "").trim();
    if (!resourceKey) {
      throw new PermissionOverrideValidationError(
        "INVALID_RESOURCE_KEY",
        "resourceKey obrigatório."
      );
    }
    if (!known.has(resourceKey)) {
      throw new PermissionOverrideValidationError(
        "UNKNOWN_RESOURCE",
        `Recurso desconhecido: ${resourceKey}`,
        { resourceKey }
      );
    }

    const viewState = parseStateField(input.view, "view", resourceKey);
    const executeState = parseStateField(input.execute, "execute", resourceKey);
    const manageState = parseStateField(input.manage, "manage", resourceKey);

    let canView: boolean | null;
    let canExecute: boolean | null;
    let canManage: boolean | null;

    if (viewState !== undefined || executeState !== undefined || manageState !== undefined) {
      canView = encodeOverrideState(viewState ?? "INHERIT");
      canExecute = encodeOverrideState(executeState ?? "INHERIT");
      canManage = encodeOverrideState(manageState ?? "INHERIT");
    } else {
      if (input.canView !== undefined && !isBoolOrNull(input.canView)) {
        throw new PermissionOverrideValidationError(
          "INVALID_AXIS_VALUE",
          `canView inválido em ${resourceKey}`,
          { resourceKey }
        );
      }
      if (input.canExecute !== undefined && !isBoolOrNull(input.canExecute)) {
        throw new PermissionOverrideValidationError(
          "INVALID_AXIS_VALUE",
          `canExecute inválido em ${resourceKey}`,
          { resourceKey }
        );
      }
      if (input.canManage !== undefined && !isBoolOrNull(input.canManage)) {
        throw new PermissionOverrideValidationError(
          "INVALID_AXIS_VALUE",
          `canManage inválido em ${resourceKey}`,
          { resourceKey }
        );
      }
      canView = input.canView === undefined ? null : input.canView;
      canExecute = input.canExecute === undefined ? null : input.canExecute;
      canManage = input.canManage === undefined ? null : input.canManage;
    }

    // Ação não suportada: no modelo 3 eixos do seed, view/execute/manage são sempre os eixos.
    // Rejeitar chaves extras no input bruto é feito pelo parse de estados.

    if (canView === null && canExecute === null && canManage === null) {
      // explicit clear for this key if previously present — omit from persist set
      byKey.delete(resourceKey);
      continue;
    }

    byKey.set(resourceKey, {
      resourceKey,
      canView,
      canExecute,
      canManage,
      reason: input.reason ?? null,
    });
  }

  return [...byKey.values()].sort((a, b) =>
    a.resourceKey.localeCompare(b.resourceKey)
  );
}

export type DraftFlags = {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
};

/**
 * Draft efetivo + defaults da role → linhas persistíveis.
 * differential: só diffs (desmarcar herdado → DENY).
 * absolute: tudo não marcado → DENY.
 */
export function buildPersistableOverridesFromDraft(args: {
  draft: Record<string, DraftFlags>;
  roleDefaults: Array<{ resourceKey: string; flags: DraftFlags }>;
  mode?: OverridePersistMode;
  /** Em absolute, inclui todos os keys do catálogo seed. */
  catalogKeys?: readonly string[];
}): PersistableOverrideRow[] {
  const mode = args.mode ?? "differential";
  const defaults = new Map(args.roleDefaults.map((r) => [r.resourceKey, r.flags]));
  const catalog =
    args.catalogKeys ??
    (mode === "absolute"
      ? PERMISSION_RESOURCE_SEEDS.map((s) => s.key)
      : Object.keys(args.draft));

  const states: ResourceOverrideStates[] = [];

  for (const resourceKey of catalog) {
    const desired = args.draft[resourceKey] ?? {
      canView: false,
      canExecute: false,
      canManage: false,
    };
    const base = defaults.get(resourceKey) ?? {
      canView: false,
      canExecute: false,
      canManage: false,
    };

    const view =
      mode === "absolute"
        ? absoluteBooleanToOverrideState(desired.canView)
        : diffBooleanToOverrideState(desired.canView, base.canView);
    const execute =
      mode === "absolute"
        ? absoluteBooleanToOverrideState(desired.canExecute)
        : diffBooleanToOverrideState(desired.canExecute, base.canExecute);
    const manage =
      mode === "absolute"
        ? absoluteBooleanToOverrideState(desired.canManage)
        : diffBooleanToOverrideState(desired.canManage, base.canManage);

    states.push({ resourceKey, view, execute, manage });
  }

  const rows: PersistableOverrideRow[] = [];
  for (const s of states) {
    const row = statesToPersistableRow(s);
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
}

/** Limpar override = todos INHERIT (não aparece no set persistido). */
export function clearOverrideStates(resourceKey: string): ResourceOverrideStates {
  return {
    resourceKey,
    view: "INHERIT",
    execute: "INHERIT",
    manage: "INHERIT",
  };
}

export function describeOverrideRoundTrip(row: PersistableOverrideRow): {
  states: ResourceOverrideStates;
  reencoded: PersistableOverrideRow | null;
} {
  const states = persistableRowToStates(row);
  return { states, reencoded: statesToPersistableRow(states) };
}
