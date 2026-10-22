/**
 * Vínculo explícito Employee ↔ AppUser (acesso ao sistema).
 * Não cria login, não altera e-mail de login, não desativa usuário no desligamento.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import type { SuperAdminGuardActor } from "@/src/lib/security/superAdminRoleGuard.js";
import { accountIdentityChangeDenial, hasConfirmedAccountIdentity } from "@/src/lib/security/accountIdentityLinkPolicy.js";
import { SECURITY_AUDIT_EVENTS, writeSecurityAuditLog } from "@/src/lib/auth/securityAudit.server.js";
import { lockPersonAccountLinks } from "@/src/lib/people/personLocks.server.js";

type LinkOpts = { actorUserId?: string | null; actor?: SuperAdminGuardActor };

/**
 * Política única de identidade de conta (a mesma de Pessoas 360°): conta SUPER_ADMIN só por
 * SUPER_ADMIN com step-up, e nunca a própria conta (salvo SUPER_ADMIN elevado). Sem ator
 * identificado a operação é recusada (fail-closed).
 */
function assertAccountIdentityChangeAllowed(opts: LinkOpts | undefined, account: { id: string; role: string | null | undefined }) {
  // As duas fontes do ator (sessão e guarda) contam para reconhecer a própria conta; sem nenhuma, a política recusa.
  const actorId = account.id === opts?.actorUserId ? opts.actorUserId : (opts?.actor?.id ?? opts?.actorUserId ?? null);
  const denial = accountIdentityChangeDenial({
    actor: { id: actorId, role: opts?.actor?.role ?? null, elevated: Boolean(opts?.actor?.elevated) },
    account,
  });
  if (denial) throw new EmployeeRegistrationError(denial.code, denial.message, denial.status);
}

/** A rota rápida do RH só liga com a Pessoa compartilhada ATIVA; a mensagem diz o motivo real. */
const personNotActiveMessage = (status: string | null | undefined) =>
  status === "NEEDS_REVIEW"
    ? "A identidade desta Pessoa está em revisão. Conclua a revisão em Pessoas 360° antes de ligar a conta."
    : "A Pessoa deste colaborador está inativa ou unificada. Resolva a identidade em Pessoas 360° antes de vincular a conta.";

const IDENTITY_CONFIRMATION_MESSAGE =
  "E-mail igual não confirma a identidade. Regularize em Pessoas 360° › Regularizar vínculo existente (prévia, confirmação e justificativa).";
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
  /** Por que vincular/desvincular não está disponível aqui (identidade não confirmada ou a própria conta). */
  linkBlockedReason: string | null;
};

export async function getEmployeeUserLinkStatus(
  prisma: PrismaClient,
  employeeId: string,
  opts?: { viewerUserId?: string | null }
): Promise<EmployeeUserLinkDto> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      corporateEmail: true,
      personId: true,
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
  let matchingPersonId: string | null = null;

  if (corporateEmail && !emp.appUser) {
    const found = await prisma.appUser.findFirst({
      where: { email: { equals: corporateEmail, mode: "insensitive" } },
      select: { id: true, email: true, employeeId: true, isActive: true, personId: true },
    });
    if (found) {
      matchingUser = { id: found.id, email: found.email, employeeId: found.employeeId, isActive: found.isActive };
      matchingPersonId = found.personId ?? null;
    }
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

  // Mesma régua da gravação (somente leitura): Pessoa canônica confirmada e nunca a própria conta.
  const viewer = opts?.viewerUserId ?? null;
  const matchable = status === "available_match" && Boolean(corporateEmail) && Boolean(matchingUser) && !matchingUser?.employeeId;
  const confirmed = hasConfirmedAccountIdentity({ accountPersonId: matchingPersonId, employeePersonId: emp.personId });
  const ownMatch = Boolean(viewer && matchingUser && matchingUser.id === viewer);
  const ownLinked = Boolean(viewer && emp.appUser && emp.appUser.id === viewer);
  const personStatus = matchable && confirmed && emp.personId
    ? (await prisma.person.findUnique({ where: { id: emp.personId }, select: { status: true } }))?.status ?? null
    : null;
  const personActive = personStatus === "ACTIVE";
  const canLink = matchable && confirmed && personActive && !ownMatch;
  const canUnlink =
    (status === "linked" || status === "linked_inactive" || status === "email_mismatch") && !ownLinked;
  const linkBlockedReason =
    ownMatch || ownLinked
      ? "É a sua própria conta: peça a outro administrador."
      : matchable && !confirmed
        ? IDENTITY_CONFIRMATION_MESSAGE
        : matchable && !personActive
          ? personNotActiveMessage(personStatus)
          : null;
  // O selo "disponível para vínculo" só quando a operação está de fato disponível.
  const shownStatus: EmployeeUserAccessState = matchable && !canLink ? "match_blocked" : status;

  return {
    employeeId: emp.id,
    corporateEmail,
    status: shownStatus,
    message: accessStateMessage(shownStatus),
    canLink,
    canUnlink,
    appUser: emp.appUser,
    matchedUser: matchingUser,
    emailMismatch,
    linkBlockedReason,
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
  opts?: LinkOpts
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
    assertAccountIdentityChangeAllowed(opts, { id: user.id, role: user.role });
    if (user.employeeId && user.employeeId !== employeeId) {
      throw new EmployeeRegistrationError(
        "APPUSER_ALREADY_LINKED",
        "Este usuário já está vinculado a outro colaborador.",
        409
      );
    }
    if (user.personId && emp.personId && user.personId !== emp.personId) {
      throw new EmployeeRegistrationError(
        "PERSON_MISMATCH",
        "O usuário e o colaborador estão ligados a pessoas canônicas diferentes. Resolva o vínculo de Pessoa antes.",
        409
      );
    }
    // E-mail igual não basta (o e-mail corporativo é editável por quem opera): exige a mesma Pessoa
    // canônica nos dois lados. Fora disso, a regularização de Pessoas 360° (prévia + justificativa).
    if (!hasConfirmedAccountIdentity({ accountPersonId: user.personId, employeePersonId: emp.personId })) {
      throw new EmployeeRegistrationError("IDENTITY_CONFIRMATION_REQUIRED", IDENTITY_CONFIRMATION_MESSAGE, 409);
    }
    // Serializa com quem põe colaborador/conta nesta Pessoa (evidência "mesma Pessoa").
    await lockPersonAccountLinks(tx, [emp.personId]);
    const freshEmp = await tx.employee.findUnique({ where: { id: employeeId }, select: { personId: true, appUser: { select: { id: true } } } });
    if (!freshEmp || freshEmp.personId !== emp.personId || freshEmp.appUser) {
      throw new EmployeeRegistrationError("STALE", "O colaborador mudou durante a operação. Recarregue e tente de novo.", 409);
    }
    const person = await tx.person.findUnique({ where: { id: emp.personId! }, select: { status: true } });
    if (!person || person.status !== "ACTIVE") {
      throw new EmployeeRegistrationError("PERSON_INACTIVE", personNotActiveMessage(person?.status), 409);
    }

    let updated: { id: string; email: string; isActive: boolean; role: string; name: string } | null;
    try {
      // Comparação-e-troca: só grava se a conta ainda está como foi lida (sem colaborador, mesma Pessoa).
      const r = await tx.appUser.updateMany({
        where: { id: user.id, employeeId: null, personId: user.personId },
        data: { employeeId },
      });
      if (r.count !== 1) {
        throw new EmployeeRegistrationError("STALE", "A conta mudou durante a operação. Recarregue e tente de novo.", 409);
      }
      updated = await tx.appUser.findUnique({
        where: { id: user.id },
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
    if (!updated) throw new EmployeeRegistrationError("STALE", "A conta mudou durante a operação. Recarregue e tente de novo.", 409);
    const actorUserId = opts?.actorUserId ?? opts?.actor?.id ?? null;
    await writeSecurityAuditLog(tx, {
      eventType: SECURITY_AUDIT_EVENTS.USER_IDENTITY_LINKED,
      actorUserId,
      targetUserId: user.id,
      metadata: { source: "HR_LINK_USER", employeeId, personId: emp.personId, evidence: "CANONICAL_PERSON", touchesSuperAdmin: user.role === "SUPER_ADMIN" },
    });

    console.info(
      JSON.stringify({
        audit: "employee.link_user",
        employeeId,
        appUserId: updated.id,
        actorUserId,
        at: new Date().toISOString(),
      })
    );

    return { appUser: updated };
  });
}

export async function unlinkEmployeeFromAppUser(
  prisma: PrismaClient,
  employeeId: string,
  opts?: LinkOpts
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

    assertAccountIdentityChangeAllowed(opts, { id: emp.appUser.id, role: emp.appUser.role });
    // Desvincular não remove SUPER_ADMIN nem desativa — apenas limpa employeeId (comparação-e-troca).
    const appUserId = emp.appUser.id;
    const r = await tx.appUser.updateMany({
      where: { id: appUserId, employeeId },
      data: { employeeId: null },
    });
    if (r.count !== 1) {
      throw new EmployeeRegistrationError("STALE", "O vínculo mudou durante a operação. Recarregue e tente de novo.", 409);
    }
    const actorUserId = opts?.actorUserId ?? opts?.actor?.id ?? null;
    await writeSecurityAuditLog(tx, {
      eventType: SECURITY_AUDIT_EVENTS.USER_IDENTITY_UNLINKED,
      actorUserId,
      targetUserId: appUserId,
      metadata: { source: "HR_UNLINK_USER", employeeId, touchesSuperAdmin: emp.appUser.role === "SUPER_ADMIN" },
    });

    console.info(
      JSON.stringify({
        audit: "employee.unlink_user",
        employeeId,
        appUserId,
        actorUserId,
        note: "AppUser permanece ativo; e-mail de login inalterado",
        at: new Date().toISOString(),
      })
    );

    return { ok: true as const, appUserId };
  });
}
