/**
 * Regras de exclusão de AppUser (Configurações → Usuários).
 */

export type AppUserDeleteCandidate = {
  id: string;
  role: string;
  isActive: boolean;
};

export type AppUserDeleteGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string; status: 400 | 403 | 409 };

export function evaluateAppUserDeleteGuard(input: {
  target: AppUserDeleteCandidate;
  actorUserId: string | null | undefined;
  otherActiveSuperAdminCount: number;
}): AppUserDeleteGuardResult {
  if (!input.target.id) {
    return { ok: false, code: "INVALID_ID", message: "ID inválido.", status: 400 };
  }
  if (input.actorUserId && input.actorUserId === input.target.id) {
    return {
      ok: false,
      code: "CANNOT_DELETE_SELF",
      message: "Você não pode excluir o próprio usuário. Peça a outro administrador.",
      status: 409,
    };
  }
  if (
    input.target.role === "SUPER_ADMIN" &&
    input.target.isActive &&
    input.otherActiveSuperAdminCount <= 0
  ) {
    return {
      ok: false,
      code: "LAST_SUPER_ADMIN_PROTECTED",
      message:
        "Este é o único Super Administrador ativo do sistema. Cadastre outro Super Administrador antes de excluí-lo.",
      status: 409,
    };
  }
  return { ok: true };
}
