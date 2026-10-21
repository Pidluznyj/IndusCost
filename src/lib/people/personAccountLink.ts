/**
 * Pessoas 360° — "Regularizar vínculo existente": decisão PURA para associar uma conta
 * IndusCost já existente (legada) a uma Pessoa e, quando houver, ao colaborador.
 *
 * Nunca altera id, senha, papel, permissões, sessões, perfil nem vínculo comercial da conta.
 * Só personId (e employeeId quando a conta ainda não tem colaborador).
 */
import { evaluateSuperAdminAccountOperation, superAdminGuardDenial, type SuperAdminGuardActor } from "@/src/lib/security/superAdminRoleGuard.js";

export type AttachAccountInput = {
  account: { id: string; role: string; personId: string | null; employeeId: string | null; isActive: boolean; email: string | null };
  /** Estado lido na prévia (comparação-e-troca). `undefined` = não checar. */
  expected: { personId?: string | null; employeeId?: string | null };
  target: { id: string; status: string; userIds: string[] };
  /** Colaborador a ligar (escolhido) ou o colaborador atual da conta; null quando não há. */
  employee: { id: string; status: string; personId: string | null; appUserId: string | null; corporateEmail: string | null } | null;
  /** O e-mail de login difere do e-mail corporativo do colaborador / da Pessoa. */
  emailMismatch: boolean;
  confirmEmailMismatch: boolean;
  actor: SuperAdminGuardActor;
};

export type AttachAccountDecision =
  | {
      ok: true;
      kind: "LINK" | "RELINK";
      fromPersonId: string | null;
      /** employeeId a gravar na conta (null = não mexer). */
      setEmployeeId: string | null;
      /** O colaborador ainda não tem Pessoa e passa a apontar para a alvo na mesma transação. */
      setEmployeePersonId: boolean;
      evidence: "EMAIL_EXACT" | "MANUAL";
      touchesSuperAdmin: boolean;
    }
  | { ok: false; code: string; status: 400 | 403 | 409; message: string };

export function decideAttachAccount(args: AttachAccountInput): AttachAccountDecision {
  const { account, expected, target, employee } = args;
  if (expected.personId !== undefined && expected.personId !== account.personId) {
    return { ok: false, code: "STALE", status: 409, message: "A conta mudou desde a prévia. Recarregue e confira antes de confirmar." };
  }
  if (expected.employeeId !== undefined && expected.employeeId !== account.employeeId) {
    return { ok: false, code: "STALE", status: 409, message: "O vínculo de colaborador da conta mudou desde a prévia. Recarregue." };
  }
  const guard = superAdminGuardDenial(evaluateSuperAdminAccountOperation({ actor: args.actor, targetRole: account.role }));
  if (guard) return { ok: false, code: guard.code, status: guard.status as 403 | 409, message: guard.message };

  if (target.status === "MERGED") {
    return { ok: false, code: "TARGET_MERGED", status: 409, message: "A pessoa escolhida foi unificada em outra. Selecione a pessoa final." };
  }
  if (target.status === "INACTIVE") {
    return { ok: false, code: "TARGET_INACTIVE", status: 409, message: "A pessoa está inativa. Reative a Pessoa (com justificativa) antes de vincular a conta." };
  }
  const otherHolder = target.userIds.find((id) => id !== account.id);
  if (otherHolder) {
    return { ok: false, code: "TARGET_HAS_USER", status: 409, message: "Esta pessoa já tem outra conta de acesso vinculada. Corrija aquele vínculo antes." };
  }

  let setEmployeeId: string | null = null;
  let setEmployeePersonId = false;
  if (employee) {
    if ((employee.status ?? "ACTIVE").toUpperCase() === "INACTIVE" && account.employeeId !== employee.id) {
      return { ok: false, code: "EMPLOYEE_INACTIVE", status: 400, message: "O colaborador escolhido está desligado. Recontrate-o no RH antes de ligar a conta a ele." };
    }
    if (employee.appUserId && employee.appUserId !== account.id) {
      return { ok: false, code: "EMPLOYEE_ALREADY_HAS_USER", status: 409, message: "Este colaborador já tem outra conta vinculada." };
    }
    if (employee.personId && employee.personId !== target.id) {
      return { ok: false, code: "PERSON_MISMATCH", status: 409, message: "O colaborador está ligado a outra Pessoa. Corrija o vínculo do colaborador antes de regularizar a conta." };
    }
    if (account.employeeId && account.employeeId !== employee.id) {
      return { ok: false, code: "APPUSER_ALREADY_LINKED", status: 409, message: "A conta já está ligada a outro colaborador." };
    }
    if (!account.employeeId) setEmployeeId = employee.id;
    if (!employee.personId) setEmployeePersonId = true;
  }

  if (account.personId === target.id && !setEmployeeId && !setEmployeePersonId) {
    return { ok: false, code: "SAME", status: 409, message: "A conta já aponta para esta pessoa." };
  }
  if (args.emailMismatch && !args.confirmEmailMismatch) {
    return {
      ok: false,
      code: "EMAIL_MISMATCH_CONFIRMATION_REQUIRED",
      status: 409,
      message: "O e-mail de login difere do e-mail cadastrado. Confirme explicitamente que se trata da mesma pessoa (o login não será alterado).",
    };
  }
  return {
    ok: true,
    kind: account.personId ? "RELINK" : "LINK",
    fromPersonId: account.personId,
    setEmployeeId,
    setEmployeePersonId,
    evidence: args.emailMismatch ? "MANUAL" : "EMAIL_EXACT",
    touchesSuperAdmin: account.role === "SUPER_ADMIN",
  };
}

/** Compara e-mails de forma frouxa (case-insensitive, sem espaços). */
export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return Boolean(x) && x === y;
}
