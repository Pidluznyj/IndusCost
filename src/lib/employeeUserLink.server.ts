/**
 * Vínculo explícito Employee ↔ AppUser (acesso ao sistema).
 * Não cria login, não altera e-mail de login, não desativa usuário no desligamento.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { evaluateSuperAdminAccountOperation, superAdminGuardDenial, type SuperAdminGuardActor } from "@/src/lib/security/superAdminRoleGuard.js";

/** Vincular/desvincular colaborador de uma conta SUPER_ADMIN exige SUPER_ADMIN com step-up (E2 por identidade). */
function assertAccountIdentityChangeAllowed(actor: SuperAdminGuardActor | undefined, targetRole: string | null | undefined) {
  const denial = superAdminGuardDenial(
    evaluateSuperAdminAccountOperation({ actor: actor ?? { id: null, role: null, elevated: false }, targetRole })
  );
  if (denial) throw new EmployeeRegistrationError(denial.code, denial.message, denial.status);
}
import { normalizeCorporateEmail } from "@/src/lib/employeeCorporateEmail.js";
import {
  EmployeeRegistrationError,
  resolveUserLinkStatus,
} from "@/src/lib/employeeRegistration.js";
import {
  accessStateMessage,
  mapToAccessState,
  type EmployeeUserAccessState,
} from "@/src/lib/employeeUserLink.js";

export type { EmployeeUserAccessState } from "@/src/lib/employeeUserLink.js";
export { accessStateMessage, mapToAccessState } from "@/src/lib/employeeUserLink.js";

export type EmployeeUserLinkDto = {
  employeeId: string;
  corporateEmail: string | null;
  status: EmployeeUserAccessState;
  message: string;
  canLink: boolean;
  canUnlink: boolean;
  appUser: {
    id: string;
    email: string;
    isActive: boolean;
    role: string;
    name: string;
  } | null;
  matchedUser: {
    id: string;
    email: string;
    isActive: boolean;
    employeeId: string | null;
  } | null;
  /** Login e e-mail corporativo diferem (após alteração de e-mail). */
  emailMismatch: boolean;
};

export async function getEmployeeUserLinkStatus(
  prisma: PrismaClient,
  employeeId: string
): Promise<EmployeeUserLinkDto> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      corporateEmail: true,
      appUser: {
        select: { id: true, email: true, isActive: true, role: true, name: true },
      },
    },
  });
  if (!emp) {
    throw new EmployeeRegistrationError("EMPLOYEE_NOT_FOUND", "Colaborador não encontrado.", 404);
  }

  const corporateEmail = normalizeCorporateEmail(emp.corporateEmail);
  let matchingUser: {
    id: string;
    email: string;
    employeeId: string | null;
    isActive: boolean;
  } | null = null;

  if (corporateEmail && !emp.appUser) {
    matchingUser = await prisma.appUser.findFirst({
      where: { email: { equals: corporateEmail, mode: "insensitive" } },
      select: { id: true, email: true, employeeId: true, isActive: true },
    });
  }

  const link = resolveUserLinkStatus({
    linkedUser: emp.appUser,
    matchingUserByEmail: matchingUser,
  });

  const emailMismatch = Boolean(
    emp.appUser &&
      corporateEmail &&
      normalizeCorporateEmail(emp.appUser.email) !== corporateEmail
  );

  const status = mapToAccessState({
    linkStatus: link.status,
    linkedIsActive: emp.appUser?.isActive,
    emailMismatch,
  });

  const canLink =
    status === "available_match" &&
    Boolean(corporateEmail) &&
    Boolean(matchingUser) &&
    !matchingUser?.employeeId;

  const canUnlink =
    status === "linked" || status === "linked_inactive" || status === "email_mismatch";

  return {
    employeeId: emp.id,
    corporateEmail,
    status,
    message: accessStateMessage(status),
    canLink,
    canUnlink,
    appUser: emp.appUser,
    matchedUser: matchingUser,
    emailMismatch,
  };
}

export async function findAppUserByLoginEmail(
  prisma: PrismaClient,
  rawEmail: string
): Promise<{
  email: string | null;
  user: {
    id: string;
    email: string;
    name: string;
    isActive: boolean;
    role: string;
    employeeId: string | null;
    employeeName: string | null;
  } | null;
}> {
  const email = normalizeCorporateEmail(rawEmail);
  if (!email) return { email: null, user: null };
  const user = await prisma.appUser.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      role: true,
      employeeId: true,
      employee: { select: { name: true } },
    },
  });
  if (!user) return { email, user: null };
  return {
    email,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      role: user.role,
      employeeId: user.employeeId,
      employeeName: user.employee?.name ?? null,
    },
  };
}

export async function linkEmployeeToAppUser(
  prisma: PrismaClient,
  employeeId: string,
  opts?: { actorUserId?: string | null; actor?: SuperAdminGuardActor }
): Promise<{
  appUser: { id: string; email: string; isActive: boolean; role: string; name: string };
}> {
  return prisma.$transaction(async (tx) => {
    const emp = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        corporateEmail: true,
        personId: true,
        appUser: { select: { id: true } },
      },
    });
    if (!emp) {
      throw new EmployeeRegistrationError("EMPLOYEE_NOT_FOUND", "Colaborador não encontrado.", 404);
    }
    if (emp.appUser) {
      throw new EmployeeRegistrationError(
        "EMPLOYEE_ALREADY_HAS_USER",
        "Este colaborador já possui usuário vinculado.",
        409
      );
    }
    const email = normalizeCorporateEmail(emp.corporateEmail);
    if (!email) {
      throw new EmployeeRegistrationError(
        "CORPORATE_EMAIL_REQUIRED",
        "Defina o e-mail corporativo antes de vincular o usuário.",
        400
      );
    }
    const user = await tx.appUser.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, employeeId: true, personId: true, email: true, role: true },
    });
    if (!user) {
      throw new EmployeeRegistrationError(
        "APPUSER_NOT_FOUND",
        "Nenhum usuário encontrado com este e-mail corporativo. Crie o acesso em Configurações → Usuários (fluxo explícito).",
        404
      );
    }
    assertAccountIdentityChangeAllowed(opts?.actor, user.role);
    if (user.employeeId && user.employeeId !== employeeId) {
      throw new EmployeeRegistrationError(
        "APPUSER_ALREADY_LINKED",
        "Este usuário já está vinculado a outro colaborador.",
        409
      );
    }
    if (emp.personId && !user.personId) {
      // Cadastro mestre: Pessoa inativa nunca é copiada para a conta em silêncio.
      const person = await tx.person.findUnique({ where: { id: emp.personId }, select: { status: true } });
      if (person && person.status !== "ACTIVE") {
        throw new EmployeeRegistrationError(
          "PERSON_INACTIVE",
          "A Pessoa deste colaborador está inativa ou unificada. Resolva a identidade em Pessoas 360° antes de vincular a conta.",
          409
        );
      }
    }
    if (user.personId && emp.personId && user.personId !== emp.personId) {
      throw new EmployeeRegistrationError(
        "PERSON_MISMATCH",
        "O usuário e o colaborador estão ligados a pessoas canônicas diferentes. Resolva o vínculo de Pessoa antes.",
        409
      );
    }

    let updated: { id: string; email: string; isActive: boolean; role: string; name: string };
    try {
      updated = await tx.appUser.update({
        where: { id: user.id },
        data: {
          employeeId,
          ...(emp.personId && !user.personId ? { personId: emp.personId } : {}),
        },
        select: { id: true, email: true, isActive: true, role: true, name: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
        if (target.includes("employeeId")) {
          throw new EmployeeRegistrationError("EMPLOYEE_ALREADY_HAS_USER", "Este colaborador já possui usuário vinculado (gravado ao mesmo tempo por outra operação).", 409);
        }
        if (target.includes("personId")) {
          throw new EmployeeRegistrationError(
            "PERSON_ALREADY_HAS_USER",
            "A Pessoa deste colaborador já tem outra conta de acesso. Corrija o vínculo em Pessoas 360°.",
            409
          );
        }
      }
      throw error;
    }
    if (emp.personId && !user.personId) {
      const { recordPersonLinkEvent, PERSON_LINK_EVENT_KINDS } = await import("@/src/lib/people/personLinkEvents.server.js");
      await recordPersonLinkEvent(tx, {
        personId: emp.personId,
        eventKind: PERSON_LINK_EVENT_KINDS.LINKED,
        entityKind: "app_user",
        entityId: user.id,
        toPersonId: emp.personId,
        actorUserId: opts?.actorUserId ?? null,
        reason: "Conta vinculada ao colaborador pelo RH (e-mail corporativo igual)",
        evidence: "EMAIL_EXACT",
        snapshot: { employeeId, source: "HR_LINK_USER" },
        reversible: true,
      });
    }

    console.info(
      JSON.stringify({
        audit: "employee.link_user",
        employeeId,
        appUserId: updated.id,
        actorUserId: opts?.actorUserId ?? null,
        syncedPersonId: Boolean(emp.personId && !user.personId),
        at: new Date().toISOString(),
      })
    );

    return { appUser: updated };
  });
}

export async function unlinkEmployeeFromAppUser(
  prisma: PrismaClient,
  employeeId: string,
  opts?: { actorUserId?: string | null; actor?: SuperAdminGuardActor }
): Promise<{ ok: true; appUserId: string }> {
  return prisma.$transaction(async (tx) => {
    const emp = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        appUser: {
          select: { id: true, email: true, role: true, employeeId: true },
        },
      },
    });
    if (!emp) {
      throw new EmployeeRegistrationError("EMPLOYEE_NOT_FOUND", "Colaborador não encontrado.", 404);
    }
    if (!emp.appUser) {
      throw new EmployeeRegistrationError(
        "NO_USER_LINK",
        "Este colaborador não possui usuário vinculado.",
        404
      );
    }

    assertAccountIdentityChangeAllowed(opts?.actor, emp.appUser.role);
    // Desvincular não remove SUPER_ADMIN nem desativa — apenas limpa employeeId.
    const appUserId = emp.appUser.id;
    await tx.appUser.update({
      where: { id: appUserId },
      data: { employeeId: null },
    });

    console.info(
      JSON.stringify({
        audit: "employee.unlink_user",
        employeeId,
        appUserId,
        actorUserId: opts?.actorUserId ?? null,
        note: "AppUser permanece ativo; e-mail de login inalterado",
        at: new Date().toISOString(),
      })
    );

    return { ok: true as const, appUserId };
  });
}
