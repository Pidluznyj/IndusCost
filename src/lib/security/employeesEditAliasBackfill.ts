/**
 * Backfill do alias `employees.edit` (Pessoas / RH) — planner puro, sem Prisma.
 *
 * Antes do pin em `permissionDualWrite/aliasIndex.ts`, marcar "editar" em Pessoas/RH num
 * perfil de acesso ou nas permissões de um usuário gravava só `employees.create` no bag
 * (a chave `employees.edit` estava presa ao Dashboard de Pessoas). A matriz continuava
 * mostrando "editar" marcado — a coluna `update` lê o eixo "executar" — mas o motor
 * canônico projeta esse bag sem `admin.employees:update`, e o salvar do cadastro tomava 403.
 *
 * O runtime já tolera esses bags (create canônico vale como Editor de RH); este backfill
 * deixa os dados coerentes com o que a tela mostra. Só ACRESCENTA `employees.edit`;
 * nunca remove chave alguma e não toca SUPER_ADMIN.
 */

export const EMPLOYEES_EDIT_KEY = "employees.edit";
export const EMPLOYEES_CREATE_KEY = "employees.create";
export const EMPLOYEES_MODULE_RESOURCE_KEY = "admin.employees";

export type EmployeesEditBackfillOverride = {
  resourceKey: string;
  canExecute?: boolean | null;
  canManage?: boolean | null;
};

export type EmployeesEditBackfillProfile = {
  id: string;
  name: string;
  permissions: readonly string[];
};

export type EmployeesEditBackfillUser = {
  id: string;
  email: string;
  role: string;
  permissions: readonly string[];
  overrides?: readonly EmployeesEditBackfillOverride[];
};

export type EmployeesEditBackfillReason = "legacy_create" | "override_execute_or_manage";

export type EmployeesEditBackfillChange = {
  kind: "profile" | "user";
  id: string;
  label: string;
  reason: EmployeesEditBackfillReason;
  before: string[];
  after: string[];
};

export type EmployeesEditBackfillPlan = {
  profiles: EmployeesEditBackfillChange[];
  users: EmployeesEditBackfillChange[];
  skipped: { profiles: number; users: number; superAdmins: number };
};

/** Bag com "executar" em Pessoas/RH gravado antes do pin: tem create, falta edit. */
export function bagNeedsEmployeesEdit(permissions: readonly string[]): boolean {
  return (
    permissions.includes(EMPLOYEES_CREATE_KEY) && !permissions.includes(EMPLOYEES_EDIT_KEY)
  );
}

/** Override individual com Executar/Gerenciar em Pessoas/RH (verdade estruturada). */
export function overridesGrantEmployeesEdit(
  overrides: readonly EmployeesEditBackfillOverride[] | undefined
): boolean {
  return (overrides ?? []).some(
    (o) =>
      o.resourceKey === EMPLOYEES_MODULE_RESOURCE_KEY &&
      (o.canExecute === true || o.canManage === true)
  );
}

function withEmployeesEdit(permissions: readonly string[]): string[] {
  return [...new Set([...permissions, EMPLOYEES_EDIT_KEY])].sort();
}

export function planEmployeesEditBackfill(input: {
  profiles: readonly EmployeesEditBackfillProfile[];
  users: readonly EmployeesEditBackfillUser[];
}): EmployeesEditBackfillPlan {
  const plan: EmployeesEditBackfillPlan = {
    profiles: [],
    users: [],
    skipped: { profiles: 0, users: 0, superAdmins: 0 },
  };

  for (const profile of input.profiles) {
    if (!bagNeedsEmployeesEdit(profile.permissions)) {
      plan.skipped.profiles += 1;
      continue;
    }
    plan.profiles.push({
      kind: "profile",
      id: profile.id,
      label: profile.name,
      reason: "legacy_create",
      before: [...profile.permissions],
      after: withEmployeesEdit(profile.permissions),
    });
  }

  for (const user of input.users) {
    if (user.role === "SUPER_ADMIN") {
      plan.skipped.superAdmins += 1;
      continue;
    }
    if (user.permissions.includes(EMPLOYEES_EDIT_KEY)) {
      plan.skipped.users += 1;
      continue;
    }
    const reason: EmployeesEditBackfillReason | null = bagNeedsEmployeesEdit(user.permissions)
      ? "legacy_create"
      : overridesGrantEmployeesEdit(user.overrides)
        ? "override_execute_or_manage"
        : null;
    if (!reason) {
      plan.skipped.users += 1;
      continue;
    }
    plan.users.push({
      kind: "user",
      id: user.id,
      label: user.email,
      reason,
      before: [...user.permissions],
      after: withEmployeesEdit(user.permissions),
    });
  }

  return plan;
}

/** Resumo legível para o console (sem dados sensíveis além de nome/e-mail). */
export function formatEmployeesEditBackfillPlan(plan: EmployeesEditBackfillPlan): string {
  const lines: string[] = [];
  lines.push(
    `Perfis a corrigir: ${plan.profiles.length} (sem mudança: ${plan.skipped.profiles})`
  );
  for (const c of plan.profiles) lines.push(`  + perfil "${c.label}" (${c.id}) — ${c.reason}`);
  lines.push(
    `Usuários a corrigir: ${plan.users.length} (sem mudança: ${plan.skipped.users}; super admins ignorados: ${plan.skipped.superAdmins})`
  );
  for (const c of plan.users) lines.push(`  + usuário ${c.label} (${c.id}) — ${c.reason}`);
  return lines.join("\n");
}
