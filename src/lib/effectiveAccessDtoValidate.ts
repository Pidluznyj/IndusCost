/**
 * Validação do DTO público de acesso efetivo (P04).
 * Sem side effects — usável no FE e no BE.
 */

import {
  EFFECTIVE_ACCESS_DTO_ACTIONS,
  type EffectiveAccessAdminDto,
  type EffectiveAccessDtoAction,
  type EffectiveAccessMeDto,
} from "@/src/lib/effectiveAccessDtoTypes.js";

const ACTION_SET = new Set<string>(EFFECTIVE_ACCESS_DTO_ACTIONS);

export type EffectiveAccessDtoValidationIssue = {
  path: string;
  message: string;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isAction(v: unknown): v is EffectiveAccessDtoAction {
  return typeof v === "string" && ACTION_SET.has(v);
}

function validateCapability(
  path: string,
  value: unknown,
  issues: EffectiveAccessDtoValidationIssue[]
): void {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "capability deve ser objeto" });
    return;
  }
  for (const k of ["canView", "canExecute", "canManage"] as const) {
    if (typeof value[k] !== "boolean") {
      issues.push({ path: `${path}.${k}`, message: "deve ser boolean" });
    }
  }
  for (const k of Object.keys(value)) {
    if (k !== "canView" && k !== "canExecute" && k !== "canManage") {
      issues.push({ path: `${path}.${k}`, message: "chave desconhecida" });
    }
  }
}

/**
 * Valida forma do DTO de sessão. Retorna issues (vazio = ok).
 * Rejeita chaves desconhecidas no topo e em compatibility/capabilities.
 */
export function validateEffectiveAccessMeDto(
  value: unknown
): EffectiveAccessDtoValidationIssue[] {
  const issues: EffectiveAccessDtoValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return [{ path: "", message: "DTO deve ser objeto" }];
  }

  const allowedTop = new Set([
    "permissionsVersion",
    "role",
    "isSuperAdmin",
    "allowedResources",
    "actionsByResource",
    "navigationReveal",
    "capabilities",
    "appliedProfile",
    "compatibility",
  ]);
  for (const k of Object.keys(value)) {
    if (!allowedTop.has(k)) {
      issues.push({ path: k, message: "chave desconhecida no DTO de sessão" });
    }
  }

  if (value.appliedProfile !== undefined && value.appliedProfile !== null) {
    if (!isPlainObject(value.appliedProfile)) {
      issues.push({ path: "appliedProfile", message: "objeto ou null" });
    } else {
      if (typeof value.appliedProfile.id !== "string" || !value.appliedProfile.id.trim()) {
        issues.push({ path: "appliedProfile.id", message: "string não vazia" });
      }
      if (typeof value.appliedProfile.name !== "string" || !value.appliedProfile.name.trim()) {
        issues.push({ path: "appliedProfile.name", message: "string não vazia" });
      }
      for (const k of Object.keys(value.appliedProfile)) {
        if (k !== "id" && k !== "name") {
          issues.push({ path: `appliedProfile.${k}`, message: "chave desconhecida" });
        }
      }
    }
  }

  if (typeof value.permissionsVersion !== "number" || !Number.isFinite(value.permissionsVersion)) {
    issues.push({ path: "permissionsVersion", message: "número finito obrigatório" });
  }
  if (typeof value.role !== "string" || !value.role.trim()) {
    issues.push({ path: "role", message: "string não vazia obrigatória" });
  }
  if (typeof value.isSuperAdmin !== "boolean") {
    issues.push({ path: "isSuperAdmin", message: "boolean obrigatório" });
  }
  if (!Array.isArray(value.allowedResources) || !value.allowedResources.every((x) => typeof x === "string")) {
    issues.push({ path: "allowedResources", message: "string[] obrigatório" });
  }
  if (!Array.isArray(value.navigationReveal) || !value.navigationReveal.every((x) => typeof x === "string")) {
    issues.push({ path: "navigationReveal", message: "string[] obrigatório" });
  }
  if (!isPlainObject(value.actionsByResource)) {
    issues.push({ path: "actionsByResource", message: "objeto obrigatório" });
  } else {
    for (const [rk, actions] of Object.entries(value.actionsByResource)) {
      if (!Array.isArray(actions) || !actions.every(isAction)) {
        issues.push({
          path: `actionsByResource.${rk}`,
          message: "ações devem ser do enum EffectiveAccessDtoAction",
        });
      }
    }
  }
  if (!isPlainObject(value.capabilities)) {
    issues.push({ path: "capabilities", message: "objeto obrigatório" });
  } else {
    for (const [rk, cap] of Object.entries(value.capabilities)) {
      validateCapability(`capabilities.${rk}`, cap, issues);
    }
  }

  if (!isPlainObject(value.compatibility)) {
    issues.push({ path: "compatibility", message: "objeto obrigatório" });
  } else {
    const c = value.compatibility;
    const allowedCompat = new Set([
      "mode",
      "legacyBagAuthoritative",
      "legacyPermissionsPresent",
      "legacyCompatApplied",
    ]);
    for (const k of Object.keys(c)) {
      if (!allowedCompat.has(k)) {
        issues.push({ path: `compatibility.${k}`, message: "chave desconhecida" });
      }
    }
    if (c.mode !== "shadow" && c.mode !== "session") {
      issues.push({ path: "compatibility.mode", message: 'deve ser "session" ou "shadow"' });
    }
    for (const k of [
      "legacyBagAuthoritative",
      "legacyPermissionsPresent",
      "legacyCompatApplied",
    ] as const) {
      if (typeof c[k] !== "boolean") {
        issues.push({ path: `compatibility.${k}`, message: "boolean obrigatório" });
      }
    }
  }

  // Consistência: capabilities só para allowed (exceto SUPER_ADMIN vazio)
  if (
    typeof value.isSuperAdmin === "boolean" &&
    !value.isSuperAdmin &&
    Array.isArray(value.allowedResources) &&
    isPlainObject(value.capabilities)
  ) {
    const allowed = new Set(value.allowedResources as string[]);
    for (const rk of Object.keys(value.capabilities)) {
      if (!allowed.has(rk)) {
        issues.push({
          path: `capabilities.${rk}`,
          message: "capability sem recurso em allowedResources",
        });
      }
    }
  }

  return issues;
}

export function isValidEffectiveAccessMeDto(value: unknown): value is EffectiveAccessMeDto {
  return validateEffectiveAccessMeDto(value).length === 0;
}

export function validateEffectiveAccessAdminDto(
  value: unknown
): EffectiveAccessDtoValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: "", message: "DTO deve ser objeto" }];
  }

  // Valida campos de sessão ignorando denies/warnings no check de chaves
  const { denies, warnings, ...sessionPart } = value;
  const issues = validateEffectiveAccessMeDto(sessionPart);

  if (!Array.isArray(denies)) {
    issues.push({ path: "denies", message: "array obrigatório no DTO admin" });
  } else {
    denies.forEach((d, i) => {
      if (!isPlainObject(d)) {
        issues.push({ path: `denies[${i}]`, message: "objeto obrigatório" });
        return;
      }
      if (typeof d.resourceKey !== "string") {
        issues.push({ path: `denies[${i}].resourceKey`, message: "string obrigatória" });
      }
      if (!Array.isArray(d.actions) || !d.actions.every(isAction)) {
        issues.push({ path: `denies[${i}].actions`, message: "ações inválidas" });
      }
      if (d.reason !== "OVERRIDE_DENY" && d.reason !== "ANCESTOR_VIEW_DENY") {
        issues.push({ path: `denies[${i}].reason`, message: "reason inválido" });
      }
      for (const k of Object.keys(d)) {
        if (k !== "resourceKey" && k !== "actions" && k !== "reason") {
          issues.push({ path: `denies[${i}].${k}`, message: "chave desconhecida" });
        }
      }
    });
  }

  if (!Array.isArray(warnings)) {
    issues.push({ path: "warnings", message: "array obrigatório no DTO admin" });
  } else {
    warnings.forEach((w, i) => {
      if (!isPlainObject(w) || typeof w.code !== "string" || typeof w.message !== "string") {
        issues.push({ path: `warnings[${i}]`, message: "code/message string obrigatórios" });
        return;
      }
      for (const k of Object.keys(w)) {
        if (k !== "code" && k !== "message") {
          issues.push({ path: `warnings[${i}].${k}`, message: "chave desconhecida" });
        }
      }
    });
  }

  return issues;
}

export function isValidEffectiveAccessAdminDto(
  value: unknown
): value is EffectiveAccessAdminDto {
  return validateEffectiveAccessAdminDto(value).length === 0;
}

/** Serializa estável (chaves/arrays ordenados) para testes de snapshot. */
export function serializeEffectiveAccessMeDtoStable(dto: EffectiveAccessMeDto): string {
  const actionsByResource: Record<string, string[]> = {};
  for (const k of Object.keys(dto.actionsByResource).sort()) {
    actionsByResource[k] = [...dto.actionsByResource[k]!].sort();
  }
  const capabilities: Record<string, EffectiveAccessMeDto["capabilities"][string]> = {};
  for (const k of Object.keys(dto.capabilities).sort()) {
    capabilities[k] = dto.capabilities[k]!;
  }
  const stable = {
    ...dto,
    allowedResources: [...dto.allowedResources].sort(),
    navigationReveal: [...dto.navigationReveal].sort(),
    actionsByResource,
    capabilities,
  };
  return JSON.stringify(stable);
}
