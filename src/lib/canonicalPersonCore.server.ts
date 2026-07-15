/**
 * Núcleo da Pessoa Canônica — CRUD + vínculos estágio 1
 * (Employee, AppUser, CommissionPerson).
 *
 * Sem UI. Sem merge automático. Sem cascade delete de histórico.
 * Unicidade de CPF/e-mail: validação na aplicação (DB sem UNIQUE nesta etapa).
 */

import type { PrismaClient } from "@prisma/client";
import {
  CanonicalPersonError,
  isPersonUuid,
  maskEmail,
  normalizeCpfLoose,
  normalizeEmailLoose,
  normalizePhone,
} from "@/src/lib/canonicalPerson.js";
import type {
  PersonAdminDto,
  PersonOrigin,
  PersonPublicDto,
  PersonStage1Role,
  PersonWriteInput,
} from "@/src/types/person.js";
import { PERSON_ORIGINS } from "@/src/types/person.js";

function assertOrigin(raw: unknown): PersonOrigin {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "MANUAL";
  if ((PERSON_ORIGINS as readonly string[]).includes(v)) return v as PersonOrigin;
  return "MANUAL";
}

function resolvePrimaryEmail(input: PersonWriteInput): string | null {
  return (
    normalizeEmailLoose(input.primaryEmail) ||
    normalizeEmailLoose(input.corporateEmail) ||
    null
  );
}

export function buildPersonCreateData(input: PersonWriteInput): {
  displayName: string;
  socialName: string | null;
  corporateEmail: string | null;
  personalEmail: string | null;
  cpfNormalized: string | null;
  phoneNormalized: string | null;
  status: string;
  origin: PersonOrigin;
  createdByUserId: string | null;
} {
  const displayName = (input.displayName ?? "").trim();
  if (!displayName) {
    throw new CanonicalPersonError("NAME_REQUIRED", "Informe o nome canônico da pessoa.");
  }
  const createdByUserId =
    typeof input.createdByUserId === "string" && isPersonUuid(input.createdByUserId)
      ? input.createdByUserId.trim()
      : null;
  return {
    displayName,
    socialName: input.socialName?.trim() || null,
    corporateEmail: resolvePrimaryEmail(input),
    personalEmail: normalizeEmailLoose(input.personalEmail),
    cpfNormalized: normalizeCpfLoose(input.cpf),
    phoneNormalized: normalizePhone(input.phone),
    status: "ACTIVE",
    origin: assertOrigin(input.origin),
    createdByUserId,
  };
}

export function toPersonPublicDto(row: {
  id: string;
  displayName: string;
  socialName: string | null;
  corporateEmail: string | null;
  status: string;
  origin?: string | null;
}): PersonPublicDto {
  return {
    id: row.id,
    displayName: row.displayName,
    socialName: row.socialName,
    primaryEmailMasked: maskEmail(row.corporateEmail),
    status: row.status,
    origin: row.origin ?? "MANUAL",
  };
}

export function toPersonAdminDto(
  row: {
    id: string;
    displayName: string;
    socialName: string | null;
    corporateEmail: string | null;
    personalEmail: string | null;
    cpfNormalized: string | null;
    phoneNormalized: string | null;
    status: string;
    origin?: string | null;
    createdByUserId?: string | null;
    inactivatedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    employees?: { id: string }[];
    appUsers?: { id: string }[];
    commissionPeople?: { id: string }[];
  }
): PersonAdminDto {
  return {
    id: row.id,
    displayName: row.displayName,
    socialName: row.socialName,
    primaryEmail: row.corporateEmail,
    personalEmail: row.personalEmail,
    cpfNormalized: row.cpfNormalized,
    phoneNormalized: row.phoneNormalized,
    status: row.status,
    origin: row.origin ?? "MANUAL",
    createdByUserId: row.createdByUserId ?? null,
    inactivatedAt: row.inactivatedAt ? row.inactivatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    linksSummary: {
      employeeId: row.employees?.[0]?.id ?? null,
      appUserId: row.appUsers?.[0]?.id ?? null,
      commissionPersonIds: (row.commissionPeople ?? []).map((c) => c.id),
    },
  };
}

/** Duplicidade potencial (não une automaticamente). */
export async function findPersonIdentityHints(
  prisma: PrismaClient,
  input: { cpfNormalized?: string | null; primaryEmail?: string | null },
  excludePersonId?: string | null
): Promise<{ byCpf: string[]; byEmail: string[] }> {
  const byCpf: string[] = [];
  const byEmail: string[] = [];
  if (input.cpfNormalized) {
    const rows = await prisma.person.findMany({
      where: {
        cpfNormalized: input.cpfNormalized,
        ...(excludePersonId ? { id: { not: excludePersonId } } : {}),
      },
      select: { id: true },
      take: 20,
    });
    byCpf.push(...rows.map((r) => r.id));
  }
  const email = normalizeEmailLoose(input.primaryEmail);
  if (email) {
    const rows = await prisma.person.findMany({
      where: {
        corporateEmail: { equals: email, mode: "insensitive" },
        ...(excludePersonId ? { id: { not: excludePersonId } } : {}),
      },
      select: { id: true },
      take: 20,
    });
    byEmail.push(...rows.map((r) => r.id));
  }
  return { byCpf, byEmail };
}

export async function createPersonCore(
  prisma: PrismaClient,
  input: PersonWriteInput,
  options?: { rejectExactDuplicates?: boolean }
): Promise<{ id: string; displayName: string; hints: { byCpf: string[]; byEmail: string[] } }> {
  const data = buildPersonCreateData(input);
  const hints = await findPersonIdentityHints(prisma, {
    cpfNormalized: data.cpfNormalized,
    primaryEmail: data.corporateEmail,
  });
  const reject = options?.rejectExactDuplicates !== false;
  if (reject && hints.byCpf.length > 0) {
    throw new CanonicalPersonError(
      "DUPLICATE_CPF",
      "Já existe pessoa canônica com este CPF. Vincule em vez de criar outra.",
      409
    );
  }
  if (reject && hints.byEmail.length > 0) {
    throw new CanonicalPersonError(
      "DUPLICATE_PRIMARY_EMAIL",
      "Já existe pessoa canônica com este e-mail principal. Vincule em vez de criar outra.",
      409
    );
  }
  const created = await prisma.person.create({ data });
  console.info(
    JSON.stringify({
      audit: "person.create",
      personId: created.id,
      origin: data.origin,
      at: new Date().toISOString(),
    })
  );
  return { id: created.id, displayName: created.displayName, hints };
}

export async function updatePersonCore(
  prisma: PrismaClient,
  personId: string,
  input: Partial<PersonWriteInput>
): Promise<{ id: string }> {
  if (!isPersonUuid(personId)) {
    throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.");
  }
  const existing = await prisma.person.findUnique({ where: { id: personId } });
  if (!existing) {
    throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  }

  const nextName =
    input.displayName !== undefined ? String(input.displayName).trim() : existing.displayName;
  if (!nextName) {
    throw new CanonicalPersonError("NAME_REQUIRED", "Informe o nome canônico da pessoa.");
  }

  const nextEmail =
    input.primaryEmail !== undefined || input.corporateEmail !== undefined
      ? resolvePrimaryEmail({
          displayName: nextName,
          primaryEmail: input.primaryEmail,
          corporateEmail: input.corporateEmail,
        })
      : existing.corporateEmail;
  const nextCpf =
    input.cpf !== undefined ? normalizeCpfLoose(input.cpf) : existing.cpfNormalized;

  const hints = await findPersonIdentityHints(
    prisma,
    { cpfNormalized: nextCpf, primaryEmail: nextEmail },
    personId
  );
  if (hints.byCpf.length > 0) {
    throw new CanonicalPersonError(
      "DUPLICATE_CPF",
      "CPF já utilizado por outra pessoa canônica.",
      409
    );
  }
  if (hints.byEmail.length > 0) {
    throw new CanonicalPersonError(
      "DUPLICATE_PRIMARY_EMAIL",
      "E-mail principal já utilizado por outra pessoa canônica.",
      409
    );
  }

  await prisma.person.update({
    where: { id: personId },
    data: {
      displayName: nextName,
      socialName:
        input.socialName !== undefined
          ? input.socialName?.trim() || null
          : existing.socialName,
      corporateEmail: nextEmail,
      personalEmail:
        input.personalEmail !== undefined
          ? normalizeEmailLoose(input.personalEmail)
          : existing.personalEmail,
      cpfNormalized: nextCpf,
      phoneNormalized:
        input.phone !== undefined ? normalizePhone(input.phone) : existing.phoneNormalized,
    },
  });
  console.info(
    JSON.stringify({
      audit: "person.update",
      personId,
      at: new Date().toISOString(),
    })
  );
  return { id: personId };
}

/** Inativa sem apagar vínculos de domínio. */
export async function inactivatePersonCore(
  prisma: PrismaClient,
  personId: string
): Promise<void> {
  if (!isPersonUuid(personId)) {
    throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.");
  }
  const existing = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, status: true },
  });
  if (!existing) {
    throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  }
  await prisma.person.update({
    where: { id: personId },
    data: {
      status: "INACTIVE",
      inactivatedAt: new Date(),
    },
  });
  console.info(
    JSON.stringify({
      audit: "person.inactivate",
      personId,
      at: new Date().toISOString(),
    })
  );
}

/**
 * Vínculo estágio 1. Employee/AppUser: 1:1 Person.
 * CommissionPerson: N:1 Person.
 * Não remove vínculos ao inativar Person.
 */
export async function linkStage1RoleToPerson(
  prisma: PrismaClient,
  input: {
    personId: string;
    role: PersonStage1Role;
    roleEntityId: string;
  }
): Promise<void> {
  if (!isPersonUuid(input.personId) || !isPersonUuid(input.roleEntityId)) {
    throw new CanonicalPersonError("INVALID_ID", "IDs inválidos.");
  }
  const person = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true },
  });
  if (!person) {
    throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  }

  if (input.role === "employee") {
    const other = await prisma.employee.findFirst({
      where: { personId: input.personId, id: { not: input.roleEntityId } },
      select: { id: true, name: true },
    });
    if (other) {
      throw new CanonicalPersonError(
        "PERSON_ALREADY_HAS_EMPLOYEE",
        `Esta pessoa já está vinculada ao colaborador "${other.name}".`,
        409
      );
    }
    const emp = await prisma.employee.findUnique({
      where: { id: input.roleEntityId },
      select: { id: true, personId: true },
    });
    if (!emp) {
      throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Colaborador não encontrado.", 404);
    }
    if (emp.personId && emp.personId !== input.personId) {
      throw new CanonicalPersonError(
        "EMPLOYEE_ALREADY_LINKED",
        "Colaborador já vinculado a outra pessoa canônica.",
        409
      );
    }
    await prisma.employee.update({
      where: { id: emp.id },
      data: { personId: input.personId },
    });
  } else if (input.role === "app_user") {
    const other = await prisma.appUser.findFirst({
      where: { personId: input.personId, id: { not: input.roleEntityId } },
      select: { id: true, email: true },
    });
    if (other) {
      throw new CanonicalPersonError(
        "PERSON_ALREADY_HAS_APP_USER",
        "Esta pessoa já está vinculada a outro usuário do sistema.",
        409
      );
    }
    const user = await prisma.appUser.findUnique({
      where: { id: input.roleEntityId },
      select: { id: true, personId: true },
    });
    if (!user) {
      throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Usuário não encontrado.", 404);
    }
    if (user.personId && user.personId !== input.personId) {
      throw new CanonicalPersonError(
        "APP_USER_ALREADY_LINKED",
        "Usuário já vinculado a outra pessoa canônica.",
        409
      );
    }
    await prisma.appUser.update({
      where: { id: user.id },
      data: { personId: input.personId },
    });
  } else if (input.role === "commission_person") {
    const cp = await prisma.commissionPerson.findUnique({
      where: { id: input.roleEntityId },
      select: { id: true, personId: true },
    });
    if (!cp) {
      throw new CanonicalPersonError(
        "SOURCE_NOT_FOUND",
        "Pessoa comissionada não encontrada.",
        404
      );
    }
    if (cp.personId && cp.personId !== input.personId) {
      throw new CanonicalPersonError(
        "COMMISSION_ALREADY_LINKED",
        "Pessoa comissionada já vinculada a outra identidade canônica.",
        409
      );
    }
    await prisma.commissionPerson.update({
      where: { id: cp.id },
      data: { personId: input.personId },
    });
  } else {
    throw new CanonicalPersonError("INVALID_ROLE", "Papel de vínculo não suportado no estágio 1.");
  }

  console.info(
    JSON.stringify({
      audit: "person.link_stage1",
      personId: input.personId,
      role: input.role,
      roleEntityId: input.roleEntityId,
      at: new Date().toISOString(),
    })
  );
}

export async function getPersonCoreById(
  prisma: PrismaClient,
  personId: string,
  opts: { includeAdmin: boolean }
): Promise<PersonPublicDto | PersonAdminDto> {
  if (!isPersonUuid(personId)) {
    throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.");
  }
  const row = await prisma.person.findUnique({
    where: { id: personId },
    include: {
      employees: { select: { id: true }, take: 2 },
      appUsers: { select: { id: true }, take: 2 },
      commissionPeople: { select: { id: true }, take: 20 },
    },
  });
  if (!row) {
    throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  }
  if (opts.includeAdmin) return toPersonAdminDto(row);
  return toPersonPublicDto(row);
}
