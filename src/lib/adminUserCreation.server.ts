/**
 * Criação de conta IndusCost — serviço único usado por `POST /api/admin/users` (a partir do
 * colaborador) e por `POST /api/people/:id/access` (a partir da Pessoa, cadastro mestre).
 *
 * Política fail-closed inalterada: resolveNewUserInitialAccess() decide papel/perfil/permissões/
 * vínculo comercial (VIEWER, vazio, sem vendedor) e o corpo da requisição NUNCA os define.
 * A credencial inicial nasce temporária (mustChangePassword) salvo SUPER_ADMIN explícito, e a
 * criação + auditoria acontecem na mesma transação. Nunca cria Pessoa; só copia personId.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { resolveNewUserInitialAccess } from "@/src/lib/adminUserCreationPolicy.js";
import {
  assertEmployeeEligibleForUserLink,
  EmployeeUserLinkError,
  resolveEmployeeDisplayName,
  resolveLoginEmailForNewUser,
} from "@/src/lib/adminUserEmployeeLink.js";
import { isValidEmail, normalizeEmail, validatePasswordMin } from "@/src/lib/auth/appAuth.shared.js";
import { hashPassword as defaultHashPassword } from "@/src/lib/auth/appAuth.server.js";
import { SECURITY_AUDIT_EVENTS, writeSecurityAuditLog, type SecurityAuditSource } from "@/src/lib/auth/securityAudit.server.js";
import { PERSON_LINK_EVENT_KINDS, recordPersonLinkEvent } from "@/src/lib/people/personLinkEvents.server.js";

export class AppUserCreationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AppUserCreationError";
    this.code = code;
    this.status = status;
  }
}

export type AppUserCreationSource = { kind: "employee"; employeeId: string } | { kind: "person"; personId: string };

export type CreateAppUserAccountInput = {
  source: AppUserCreationSource;
  name?: string | null;
  email?: string | null;
  password: string;
  isActive?: boolean;
  /** Só SUPER_ADMIN pode desligar a troca obrigatória de senha (false). */
  mustChangePassword?: boolean;
  actor: { id: string | null; role: string | null; name?: string | null };
  origin: { ipAddress: string | null; userAgent: string | null };
  creationSource: Extract<SecurityAuditSource, "USER_CREATION" | "PERSON_ENABLE_ACCESS">;
};

type EmployeeRow = {
  id: string;
  name: string;
  socialName: string | null;
  personalEmail: string | null;
  corporateEmail?: string | null;
  department?: string | null;
  status: string | null;
  personId?: string | null;
};

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  socialName: true,
  personalEmail: true,
  corporateEmail: true,
  department: true,
  status: true,
  personId: true,
} as const;

function mapUnique(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
    if (target.includes("employeeId")) {
      throw new AppUserCreationError("EMPLOYEE_ALREADY_LINKED", "Esta pessoa já possui usuário de acesso no sistema.", 409);
    }
    if (target.includes("personId")) {
      throw new AppUserCreationError("PERSON_ALREADY_HAS_USER", "A pessoa já tem uma conta de acesso. Corrija o vínculo em Pessoas antes de criar outra.", 409);
    }
    throw new AppUserCreationError("EMAIL_ALREADY_EXISTS", "E-mail já cadastrado.", 409);
  }
  throw error;
}

export async function createAppUserAccount(
  deps: { prisma: PrismaClient; hashPassword?: (password: string) => Promise<string> },
  input: CreateAppUserAccountInput
) {
  const { prisma } = deps;
  const hashPassword = deps.hashPassword ?? defaultHashPassword;
  // Criação fail-closed: perfil, role operacional, permissões e vínculo comercial só
  // podem ser atribuídos depois, pelos fluxos administrativos próprios.
  const { role, permissions, accessProfileId, externalSellerId, externalSellerIds, sellerResponsibleName } = resolveNewUserInitialAccess();
  const isActive = input.isActive !== false;

  const password = input.password ?? "";
  const passwordError = validatePasswordMin(password);
  if (passwordError) throw new AppUserCreationError("INVALID_PASSWORD", passwordError, 400);

  // ---- Origem: colaborador (fluxo de Usuários) ou Pessoa (ficha 360°) ----
  let employee: EmployeeRow | null = null;
  let personIdForUser: string | null = null;
  let person: { id: string; displayName: string; socialName: string | null; corporateEmail: string | null; personalEmail: string | null } | null = null;

  if (input.source.kind === "employee") {
    const employeeId = input.source.employeeId.trim();
    const employeeRow = employeeId ? await prisma.employee.findUnique({ where: { id: employeeId }, select: EMPLOYEE_SELECT }) : null;
    const linkedUser = employeeId ? await prisma.appUser.findUnique({ where: { employeeId }, select: { id: true } }) : null;
    try {
      employee = assertEmployeeEligibleForUserLink({ employeeId, employee: employeeRow, alreadyLinkedUserId: linkedUser?.id ?? null });
    } catch (linkError) {
      if (linkError instanceof EmployeeUserLinkError) {
        throw new AppUserCreationError(linkError.code, linkError.message, linkError.code === "EMPLOYEE_ALREADY_LINKED" ? 409 : 400);
      }
      throw linkError;
    }
    // E4: a conta nasce com a Pessoa canônica do colaborador (associação inequívoca).
    // Sem Pessoa no colaborador, a conta fica sem personId — nunca se cria outra Pessoa aqui.
    personIdForUser = employee.personId ?? null;
  } else {
    const personId = input.source.personId.trim();
    const personRow = await prisma.person.findUnique({
      where: { id: personId },
      select: {
        id: true,
        displayName: true,
        socialName: true,
        corporateEmail: true,
        personalEmail: true,
        status: true,
        employees: { select: { ...EMPLOYEE_SELECT, appUser: { select: { id: true } } } },
      },
    });
    if (!personRow) throw new AppUserCreationError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    if (personRow.status === "MERGED") throw new AppUserCreationError("PERSON_MERGED", "Esta pessoa foi unificada em outra. Habilite o acesso na pessoa que ficou.", 409);
    if (personRow.status !== "ACTIVE") throw new AppUserCreationError("PERSON_INACTIVE", "A pessoa está inativa. Reative a Pessoa (com justificativa) antes de habilitar o acesso.", 409);
    person = personRow;
    personIdForUser = personRow.id;
    const emp = personRow.employees[0] ?? null;
    if (emp) {
      // A Pessoa tem colaborador: a conta nasce ligada a ele (escopos de RH/Desempenho dependem disso).
      if ((emp.status ?? "ACTIVE").toUpperCase() === "INACTIVE") {
        throw new AppUserCreationError("EMPLOYEE_INACTIVE", "O colaborador desta pessoa está desligado. Recontrate-o no RH antes de habilitar o acesso.", 400);
      }
      if (emp.appUser) {
        throw new AppUserCreationError("EMPLOYEE_ALREADY_LINKED", "O colaborador desta pessoa já tem uma conta. Use \"Regularizar vínculo existente\" para ligá-la à Pessoa.", 409);
      }
      employee = emp;
    }
    // Sem colaborador: conta nasce só com personId (externo/diretoria). Os módulos com escopo
    // funcional (RH, Desempenho, Competências) fecham sozinhos sem employeeId; nada é liberado.
  }

  if (personIdForUser) {
    const holder = await prisma.appUser.findUnique({ where: { personId: personIdForUser }, select: { id: true, email: true } });
    if (holder) {
      throw new AppUserCreationError(
        "PERSON_ALREADY_HAS_USER",
        `A pessoa já tem uma conta de acesso (${holder.email}). Corrija o vínculo em Pessoas antes de criar outra.`,
        409
      );
    }
  }

  const requestedName = typeof input.name === "string" ? input.name.trim() : "";
  const name = requestedName || (employee ? resolveEmployeeDisplayName(employee) : person ? (person.socialName?.trim() || person.displayName) : "");
  const email = normalizeEmail(
    resolveLoginEmailForNewUser({
      requestedEmail: typeof input.email === "string" ? input.email : "",
      corporateEmail: employee?.corporateEmail ?? person?.corporateEmail ?? null,
      personalEmail: employee?.personalEmail ?? person?.personalEmail ?? null,
    })
  );
  if (!name) throw new AppUserCreationError("INVALID_NAME", "Informe o nome.", 400);
  if (!isValidEmail(email)) {
    throw new AppUserCreationError("INVALID_EMAIL", "Informe um e-mail de acesso válido (pode usar o e-mail pessoal cadastrado em Pessoas / RH).", 400);
  }

  const passwordHash = await hashPassword(password);
  // Senha inicial escolhida por outra pessoa. O padrão exige troca no primeiro acesso.
  // Só SUPER_ADMIN pode desligar isso enviando false.
  const requirePasswordChange = !(input.actor.role === "SUPER_ADMIN" && input.mustChangePassword === false);

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.appUser.create({
        data: {
          name,
          email,
          passwordHash,
          role,
          permissions,
          accessProfileId,
          employeeId: employee?.id ?? null,
          personId: personIdForUser,
          isActive,
          mustChangePassword: requirePasswordChange,
          passwordChangedAt: new Date(),
          externalSellerId,
          externalSellerIds,
          sellerResponsibleName,
        },
        include: {
          accessProfile: { select: { name: true } },
          employee: { select: { id: true, name: true, socialName: true, department: true } },
        },
      });
      await writeSecurityAuditLog(tx, {
        eventType: SECURITY_AUDIT_EVENTS.USER_INITIAL_PASSWORD_ASSIGNED,
        actorUserId: input.actor.id,
        targetUserId: created.id,
        ipAddress: input.origin.ipAddress,
        userAgent: input.origin.userAgent,
        metadata: { source: input.creationSource },
      });
      await writeSecurityAuditLog(tx, {
        eventType: SECURITY_AUDIT_EVENTS.USER_CREATED,
        actorUserId: input.actor.id,
        targetUserId: created.id,
        ipAddress: input.origin.ipAddress,
        userAgent: input.origin.userAgent,
        metadata: {
          employeeId: employee?.id ?? null,
          personId: personIdForUser,
          personCopiedFromEmployee: input.source.kind === "employee" && Boolean(personIdForUser),
          source: input.creationSource,
          hasEmployee: Boolean(employee),
        },
      });
      if (personIdForUser) {
        await recordPersonLinkEvent(tx, {
          personId: personIdForUser,
          eventKind: PERSON_LINK_EVENT_KINDS.LINKED,
          entityKind: "app_user",
          entityId: created.id,
          toPersonId: personIdForUser,
          actorUserId: input.actor.id,
          actorName: input.actor.name ?? null,
          reason: input.creationSource === "PERSON_ENABLE_ACCESS" ? "Conta criada a partir da ficha da Pessoa" : "Conta criada a partir do colaborador",
          evidence: "SYSTEM",
          snapshot: { entityLabel: name, employeeId: employee?.id ?? null, source: input.creationSource },
          reversible: false,
        });
      }
      return created;
    });
  } catch (error) {
    mapUnique(error);
  }
}
