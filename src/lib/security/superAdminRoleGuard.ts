/**
 * Guarda de privilégio SUPER_ADMIN (missão Pessoas 360°, entrega E2).
 *
 * Conceder ou retirar o papel SUPER_ADMIN é a operação mais sensível do sistema:
 * quem o tem contorna todo o RBAC. Ter `admin.settings.security:manage` não basta —
 * só um SUPER_ADMIN autenticado e com a elevação administrativa (step-up) vigente
 * pode mexer nesse papel, e ninguém se promove sozinho.
 *
 * Função pura: recebe o ator (papel + elevação), o alvo e o papel pretendido e
 * devolve `ok` ou o motivo da recusa. As rotas aplicam o resultado e gravam auditoria.
 */

export type SuperAdminGuardActor = {
  id: string | null;
  role: string | null;
  /** Elevação administrativa (cookie de step-up) ligada à sessão atual. */
  elevated: boolean;
};

export type SuperAdminGuardTarget = {
  id: string;
  role: string;
};

export type SuperAdminGuardResult =
  | { ok: true; touchesSuperAdmin: boolean }
  | { ok: false; code: string; status: 403 | 409; message: string };

export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

/** A mudança concede ou retira o papel SUPER_ADMIN? */
export function roleChangeTouchesSuperAdmin(currentRole: string, nextRole: string): boolean {
  if (currentRole === nextRole) return false;
  return currentRole === SUPER_ADMIN_ROLE || nextRole === SUPER_ADMIN_ROLE;
}

export function evaluateSuperAdminRoleChange(args: {
  actor: SuperAdminGuardActor;
  target: SuperAdminGuardTarget;
  nextRole: string;
}): SuperAdminGuardResult {
  const touches = roleChangeTouchesSuperAdmin(args.target.role, args.nextRole);
  if (!touches) return { ok: true, touchesSuperAdmin: false };

  const promoting = args.nextRole === SUPER_ADMIN_ROLE;
  if (promoting && args.actor.id && args.actor.id === args.target.id) {
    return {
      ok: false,
      code: "CANNOT_PROMOTE_SELF",
      status: 409,
      message: "Ninguém pode se promover a Super Administrador. Peça a outro Super Administrador.",
    };
  }
  if (args.actor.role !== SUPER_ADMIN_ROLE) {
    return {
      ok: false,
      code: "SUPER_ADMIN_REQUIRED",
      status: 403,
      message: promoting
        ? "Apenas um Super Administrador pode conceder o papel de Super Administrador."
        : "Apenas um Super Administrador pode retirar o papel de Super Administrador.",
    };
  }
  if (!args.actor.elevated) {
    return {
      ok: false,
      code: "ADMIN_ELEVATION_REQUIRED",
      status: 403,
      message: "Confirme sua identidade (senha) para alterar privilégios de Super Administrador.",
    };
  }
  return { ok: true, touchesSuperAdmin: true };
}

export type SuperAdminGuardDenial = Extract<SuperAdminGuardResult, { ok: false }>;

/** Devolve a recusa (ou null) sem depender do estreitamento de união do chamador. */
export function superAdminGuardDenial(result: SuperAdminGuardResult): SuperAdminGuardDenial | null {
  // `in` estreita a união mesmo sem strictNullChecks (o tsconfig do projeto não é strict).
  return "code" in result ? result : null;
}

/** Ação gravada em PermissionAuditLog para mudanças de papel envolvendo SUPER_ADMIN. */
export const SUPER_ADMIN_AUDIT_ACTIONS = {
  GRANTED: "SUPER_ADMIN_ROLE_GRANTED",
  REVOKED: "SUPER_ADMIN_ROLE_REVOKED",
  DENIED: "SUPER_ADMIN_ROLE_CHANGE_DENIED",
} as const;

export type SuperAdminAuditAction = (typeof SUPER_ADMIN_AUDIT_ACTIONS)[keyof typeof SUPER_ADMIN_AUDIT_ACTIONS];

export function superAdminAuditAction(
  currentRole: string,
  nextRole: string
): typeof SUPER_ADMIN_AUDIT_ACTIONS.GRANTED | typeof SUPER_ADMIN_AUDIT_ACTIONS.REVOKED {
  return nextRole === SUPER_ADMIN_ROLE
    ? SUPER_ADMIN_AUDIT_ACTIONS.GRANTED
    : SUPER_ADMIN_AUDIT_ACTIONS.REVOKED;
}
