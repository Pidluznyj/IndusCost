/**
 * Pessoa canônica — busca federada e vínculos (server-only).
 */

import type { PrismaClient } from "@prisma/client";
import {
  applyFieldResolutions,
  CanonicalPersonError,
  classifyCustomerDocument,
  detectPersonFieldConflicts,
  foldAscii,
  isPersonUuid,
  isUnequivocalMatchEvidence,
  maskCpf,
  maskEmail,
  normalizeCpfLoose,
  normalizeEmailLoose,
  normalizePhone,
  sourceKindLabel,
  type FieldConflict,
  type FieldResolutionChoice,
  type PersonFieldKey,
  type PersonIdentitySnapshot,
  type PersonLinkSourceKind,
} from "@/src/lib/canonicalPerson.js";

export type PersonSearchHit = {
  key: string;
  personId: string | null;
  sourceKind: PersonLinkSourceKind;
  sourceId: string;
  displayName: string;
  socialName: string | null;
  emailMasked: string | null;
  email: string | null;
  originLabel: string;
  roles: string[];
  status: string;
  matchReason: "email" | "cpf" | "phone" | "name" | "person";
};

function emailOf(snapshot: {
  corporateEmail?: string | null;
  personalEmail?: string | null;
  email?: string | null;
}): string | null {
  return (
    normalizeEmailLoose(snapshot.corporateEmail) ||
    normalizeEmailLoose(snapshot.personalEmail) ||
    normalizeEmailLoose(snapshot.email)
  );
}

export async function searchCanonicalPeople(
  prisma: PrismaClient,
  input: {
    q: string;
    limit?: number;
    canViewPii: boolean;
    excludeEmployeeId?: string | null;
  }
): Promise<PersonSearchHit[]> {
  const q = input.q.trim();
  if (q.length < 2) return [];
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 40);
  const qFold = foldAscii(q);
  const qEmail = normalizeEmailLoose(q);
  const qCpf = normalizeCpfLoose(q);
  const qPhone = normalizePhone(q);
  const hits: PersonSearchHit[] = [];
  const seenKeys = new Set<string>();

  const push = (hit: PersonSearchHit) => {
    if (seenKeys.has(hit.key)) return;
    seenKeys.add(hit.key);
    hits.push(hit);
  };

  const people = await prisma.person.findMany({
    where: {
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { socialName: { contains: q, mode: "insensitive" } },
        ...(qEmail
          ? [
              { corporateEmail: { equals: qEmail, mode: "insensitive" as const } },
              { personalEmail: { equals: qEmail, mode: "insensitive" as const } },
            ]
          : []),
        ...(qCpf ? [{ cpfNormalized: qCpf }] : []),
        ...(qPhone ? [{ phoneNormalized: { contains: qPhone } }] : []),
      ],
    },
    take: limit,
    include: {
      employees: { select: { id: true, status: true }, take: 3 },
      appUsers: { select: { id: true, isActive: true }, take: 3 },
      commissionPeople: { select: { id: true, active: true }, take: 3 },
      fleetDrivers: { select: { id: true, status: true }, take: 3 },
      customers: { select: { id: true, companyName: true }, take: 3 },
    },
    orderBy: { displayName: "asc" },
  });

  for (const p of people) {
    const roles: string[] = [];
    if (p.employees.length) roles.push("Colaborador");
    if (p.appUsers.length) roles.push("Usuário");
    if (p.commissionPeople.length) roles.push("Pessoa comissionada");
    if (p.fleetDrivers.length) roles.push("Motorista");
    if (p.customers.length) roles.push("Cliente PF");
    const email = emailOf(p);
    push({
      key: `person:${p.id}`,
      personId: p.id,
      sourceKind: "person",
      sourceId: p.id,
      displayName: p.displayName,
      socialName: p.socialName,
      emailMasked: input.canViewPii ? email : maskEmail(email),
      email: input.canViewPii ? email : null,
      originLabel: sourceKindLabel("person"),
      roles,
      status: p.status,
      matchReason: qCpf ? "cpf" : qEmail ? "email" : qPhone ? "phone" : "person",
    });
  }

  if (hits.length < limit) {
    const employees = await prisma.employee.findMany({
      where: {
        personId: null,
        ...(input.excludeEmployeeId ? { id: { not: input.excludeEmployeeId } } : {}),
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { socialName: { contains: q, mode: "insensitive" } },
          ...(qEmail
            ? [
                { corporateEmail: { equals: qEmail, mode: "insensitive" as const } },
                { personalEmail: { equals: qEmail, mode: "insensitive" as const } },
              ]
            : []),
          ...(qCpf ? [{ cpf: { contains: qCpf } }] : []),
        ],
      },
      take: limit,
      select: {
        id: true,
        name: true,
        socialName: true,
        corporateEmail: true,
        personalEmail: true,
        status: true,
      },
    });
    for (const e of employees) {
      const email = emailOf(e);
      push({
        key: `employee:${e.id}`,
        personId: null,
        sourceKind: "employee",
        sourceId: e.id,
        displayName: e.socialName?.trim() || e.name,
        socialName: e.socialName,
        emailMasked: input.canViewPii ? email : maskEmail(email),
        email: input.canViewPii ? email : null,
        originLabel: "Colaborador (sem pessoa canônica)",
        roles: ["Colaborador"],
        status: e.status ?? "ACTIVE",
        matchReason: qEmail ? "email" : qCpf ? "cpf" : "name",
      });
    }
  }

  if (hits.length < limit) {
    const users = await prisma.appUser.findMany({
      where: {
        personId: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          ...(qEmail ? [{ email: { equals: qEmail, mode: "insensitive" as const } }] : []),
        ],
      },
      take: limit,
      select: { id: true, name: true, email: true, isActive: true },
    });
    for (const u of users) {
      const email = normalizeEmailLoose(u.email);
      push({
        key: `app_user:${u.id}`,
        personId: null,
        sourceKind: "app_user",
        sourceId: u.id,
        displayName: u.name,
        socialName: null,
        emailMasked: input.canViewPii ? email : maskEmail(email),
        email: input.canViewPii ? email : null,
        originLabel: "Usuário do sistema",
        roles: ["Usuário"],
        status: u.isActive ? "ACTIVE" : "INACTIVE",
        matchReason: qEmail ? "email" : "name",
      });
    }
  }

  if (hits.length < limit) {
    const cps = await prisma.commissionPerson.findMany({
      where: {
        personId: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          ...(qEmail ? [{ email: { equals: qEmail, mode: "insensitive" as const } }] : []),
          ...(qCpf ? [{ document: { contains: qCpf } }] : []),
        ],
      },
      take: limit,
      select: { id: true, name: true, email: true, active: true, document: true },
    });
    for (const c of cps) {
      const email = normalizeEmailLoose(c.email);
      push({
        key: `commission_person:${c.id}`,
        personId: null,
        sourceKind: "commission_person",
        sourceId: c.id,
        displayName: c.name,
        socialName: null,
        emailMasked: input.canViewPii ? email : maskEmail(email),
        email: input.canViewPii ? email : null,
        originLabel: "Pessoa comissionada",
        roles: ["Pessoa comissionada"],
        status: c.active ? "ACTIVE" : "INACTIVE",
        matchReason: qEmail ? "email" : qCpf ? "cpf" : "name",
      });
    }
  }

  if (hits.length < limit) {
    const drivers = await prisma.fleetDriver.findMany({
      where: {
        personId: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          ...(qEmail ? [{ email: { equals: qEmail, mode: "insensitive" as const } }] : []),
          ...(qCpf ? [{ cpf: { contains: qCpf } }] : []),
        ],
      },
      take: limit,
      select: { id: true, name: true, email: true, status: true, cpf: true },
    });
    for (const d of drivers) {
      const email = normalizeEmailLoose(d.email);
      push({
        key: `fleet_driver:${d.id}`,
        personId: null,
        sourceKind: "fleet_driver",
        sourceId: d.id,
        displayName: d.name,
        socialName: null,
        emailMasked: input.canViewPii ? email : maskEmail(email),
        email: input.canViewPii ? email : null,
        originLabel: "Motorista",
        roles: ["Motorista"],
        status: String(d.status),
        matchReason: qCpf ? "cpf" : qEmail ? "email" : "name",
      });
    }
  }

  if (hits.length < limit) {
    const customers = await prisma.customer.findMany({
      where: {
        personId: null,
        OR: [
          { companyName: { contains: q, mode: "insensitive" } },
          { contactName: { contains: q, mode: "insensitive" } },
          { tradeName: { contains: q, mode: "insensitive" } },
          ...(qEmail ? [{ email: { equals: qEmail, mode: "insensitive" as const } }] : []),
          ...(qCpf ? [{ taxId: { contains: qCpf } }] : []),
        ],
      },
      take: Math.min(limit, 30),
      select: {
        id: true,
        companyName: true,
        contactName: true,
        taxId: true,
        email: true,
        status: true,
      },
    });
    for (const c of customers) {
      if (classifyCustomerDocument(c.taxId) !== "PF") continue;
      const email = normalizeEmailLoose(c.email);
      push({
        key: `customer_pf:${c.id}`,
        personId: null,
        sourceKind: "customer_pf",
        sourceId: c.id,
        displayName: c.contactName?.trim() || c.companyName,
        socialName: null,
        emailMasked: input.canViewPii ? email : maskEmail(email),
        email: input.canViewPii ? email : null,
        originLabel: `Cliente PF: ${c.companyName}`,
        roles: ["Cliente (pessoa física)"],
        status: c.status,
        matchReason: qCpf ? "cpf" : qEmail ? "email" : "name",
      });
    }
  }

  // Ordena: evidência inequívoca primeiro; descarta matching só por nome no topo se há melhores
  hits.sort((a, b) => {
    const score = (h: PersonSearchHit) =>
      h.matchReason === "cpf" || h.matchReason === "email"
        ? 0
        : h.matchReason === "person"
          ? 1
          : h.matchReason === "phone"
            ? 2
            : 3;
    return score(a) - score(b) || a.displayName.localeCompare(b.displayName, "pt-BR");
  });

  // Filtro soft por acento no cliente-side fold (além do contains SQL)
  const filtered = hits.filter((h) => {
    if (qEmail || qCpf || qPhone) return true;
    return (
      foldAscii(h.displayName).includes(qFold) ||
      foldAscii(h.socialName ?? "").includes(qFold) ||
      foldAscii(h.originLabel).includes(qFold)
    );
  });

  return filtered.slice(0, limit);
}

export async function ensurePersonFromSource(
  prisma: PrismaClient,
  input: {
    sourceKind: PersonLinkSourceKind;
    sourceId: string;
  }
): Promise<{ id: string; displayName: string; created: boolean }> {
  if (!isPersonUuid(input.sourceId)) {
    throw new CanonicalPersonError("INVALID_SOURCE", "Origem inválida.");
  }

  if (input.sourceKind === "person") {
    const p = await prisma.person.findUnique({ where: { id: input.sourceId } });
    if (!p) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    return { id: p.id, displayName: p.displayName, created: false };
  }

  if (input.sourceKind === "employee") {
    const e = await prisma.employee.findUnique({ where: { id: input.sourceId } });
    if (!e) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Colaborador não encontrado.", 404);
    if (e.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: e.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: e.socialName?.trim() || e.name,
        socialName: e.socialName,
        corporateEmail: normalizeEmailLoose(e.corporateEmail),
        personalEmail: normalizeEmailLoose(e.personalEmail),
        cpfNormalized: normalizeCpfLoose(e.cpf),
        phoneNormalized: normalizePhone(e.phone),
        status: (e.status ?? "ACTIVE") === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        origin: "EMPLOYEE",
      },
    });
    await prisma.employee.update({ where: { id: e.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  if (input.sourceKind === "app_user") {
    const u = await prisma.appUser.findUnique({ where: { id: input.sourceId } });
    if (!u) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Usuário não encontrado.", 404);
    if (u.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: u.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: u.name,
        corporateEmail: normalizeEmailLoose(u.email),
        status: u.isActive ? "ACTIVE" : "INACTIVE",
        origin: "APP_USER",
      },
    });
    await prisma.appUser.update({ where: { id: u.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  if (input.sourceKind === "commission_person") {
    const c = await prisma.commissionPerson.findUnique({ where: { id: input.sourceId } });
    if (!c) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Pessoa comissionada não encontrada.", 404);
    if (c.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: c.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: c.name,
        corporateEmail: normalizeEmailLoose(c.email),
        cpfNormalized: normalizeCpfLoose(c.document),
        status: c.active ? "ACTIVE" : "INACTIVE",
        origin: "COMMISSION",
      },
    });
    await prisma.commissionPerson.update({ where: { id: c.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  if (input.sourceKind === "fleet_driver") {
    const d = await prisma.fleetDriver.findUnique({ where: { id: input.sourceId } });
    if (!d) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Motorista não encontrado.", 404);
    if (d.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: d.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: d.name,
        corporateEmail: normalizeEmailLoose(d.email),
        cpfNormalized: normalizeCpfLoose(d.cpf),
        phoneNormalized: normalizePhone(d.phone),
        status: "ACTIVE",
        origin: "SYSTEM",
      },
    });
    await prisma.fleetDriver.update({ where: { id: d.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  if (input.sourceKind === "customer_pf") {
    const c = await prisma.customer.findUnique({ where: { id: input.sourceId } });
    if (!c) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Cliente não encontrado.", 404);
    if (classifyCustomerDocument(c.taxId) !== "PF") {
      throw new CanonicalPersonError(
        "CUSTOMER_NOT_PF",
        "Somente cliente pessoa física pode vincular identidade a Person."
      );
    }
    if (c.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: c.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: c.contactName?.trim() || c.companyName,
        corporateEmail: normalizeEmailLoose(c.email),
        cpfNormalized: normalizeCpfLoose(c.taxId),
        phoneNormalized: normalizePhone(c.phone),
        status: c.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        origin: "SYSTEM",
      },
    });
    await prisma.customer.update({ where: { id: c.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  throw new CanonicalPersonError("INVALID_SOURCE", "Tipo de origem não suportado.");
}

export async function createCanonicalPerson(
  prisma: PrismaClient,
  snapshot: PersonIdentitySnapshot,
  options?: { origin?: string; createdByUserId?: string | null }
): Promise<{ id: string; displayName: string }> {
  const { createPersonCore } = await import("@/src/lib/canonicalPersonCore.server.js");
  const created = await createPersonCore(prisma, {
    displayName: snapshot.displayName ?? "",
    socialName: snapshot.socialName,
    corporateEmail: snapshot.corporateEmail,
    personalEmail: snapshot.personalEmail,
    cpf: snapshot.cpfNormalized,
    phone: snapshot.phoneNormalized,
    origin: (options?.origin as "MANUAL" | "EMPLOYEE" | "APP_USER" | "COMMISSION" | "SYSTEM" | "BACKFILL") ?? "MANUAL",
    createdByUserId: options?.createdByUserId ?? null,
  });
  return { id: created.id, displayName: created.displayName };
}

export async function previewLinkEmployeeToPerson(
  prisma: PrismaClient,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    form: PersonIdentitySnapshot;
  }
): Promise<{
  personId: string;
  conflicts: FieldConflict[];
  person: PersonIdentitySnapshot;
}> {
  let personId = input.personId ?? null;
  if (!personId && input.sourceKind && input.sourceId) {
    const ensured = await ensurePersonFromSource(prisma, {
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
    });
    personId = ensured.id;
  }
  if (!personId || !isPersonUuid(personId)) {
    throw new CanonicalPersonError("PERSON_REQUIRED", "Selecione uma pessoa válida.");
  }
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);

  const personSnap: PersonIdentitySnapshot = {
    displayName: person.displayName,
    socialName: person.socialName,
    corporateEmail: person.corporateEmail,
    personalEmail: person.personalEmail,
    cpfNormalized: person.cpfNormalized,
    phoneNormalized: person.phoneNormalized,
  };
  const formSnap: PersonIdentitySnapshot = {
    displayName: input.form.displayName,
    socialName: input.form.socialName,
    corporateEmail: normalizeEmailLoose(input.form.corporateEmail),
    personalEmail: normalizeEmailLoose(input.form.personalEmail),
    cpfNormalized: normalizeCpfLoose(input.form.cpfNormalized),
    phoneNormalized: normalizePhone(input.form.phoneNormalized),
  };

  return {
    personId: person.id,
    conflicts: detectPersonFieldConflicts(formSnap, personSnap),
    person: personSnap,
  };
}

export async function resolveEmployeePersonIdForPersist(
  prisma: PrismaClient,
  input: {
    personId?: string | null;
    createNewPerson?: boolean;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    form: PersonIdentitySnapshot & { name?: string | null; cpf?: string | null; phone?: string | null };
    fieldResolutions?: Partial<Record<PersonFieldKey, FieldResolutionChoice>>;
    existingEmployeeId?: string | null;
  }
): Promise<{
  personId: string | null;
  appliedForm: PersonIdentitySnapshot;
  conflicts: FieldConflict[];
}> {
  const formSnap: PersonIdentitySnapshot = {
    displayName: (input.form.displayName || input.form.name || "").trim() || null,
    socialName: input.form.socialName ?? null,
    corporateEmail: normalizeEmailLoose(input.form.corporateEmail),
    personalEmail: normalizeEmailLoose(input.form.personalEmail),
    cpfNormalized: normalizeCpfLoose(input.form.cpfNormalized ?? input.form.cpf),
    phoneNormalized: normalizePhone(input.form.phoneNormalized ?? input.form.phone),
  };

  // Vincular origem ou personId
  if (input.personId || (input.sourceKind && input.sourceId)) {
    const preview = await previewLinkEmployeeToPerson(prisma, {
      personId: input.personId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      form: formSnap,
    });
    const unresolved = preview.conflicts.filter(
      (c) => !input.fieldResolutions?.[c.field]
    );
    if (unresolved.length > 0) {
      throw new CanonicalPersonError(
        "FIELD_CONFLICTS",
        "Há conflitos de dados com a pessoa selecionada. Resolva antes de salvar.",
        409,
        unresolved
      );
    }
    const other = await prisma.employee.findFirst({
      where: {
        personId: preview.personId,
        ...(input.existingEmployeeId ? { id: { not: input.existingEmployeeId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (other) {
      throw new CanonicalPersonError(
        "PERSON_ALREADY_HAS_EMPLOYEE",
        `Esta pessoa já está vinculada ao colaborador "${other.name}".`,
        409
      );
    }
    const applied = applyFieldResolutions(
      formSnap,
      preview.person,
      input.fieldResolutions ?? {}
    );
    return {
      personId: preview.personId,
      appliedForm: applied,
      conflicts: preview.conflicts,
    };
  }

  if (input.createNewPerson === true) {
    const created = await createCanonicalPerson(prisma, formSnap);
    return {
      personId: created.id,
      appliedForm: formSnap,
      conflicts: [],
    };
  }

  return { personId: null, appliedForm: formSnap, conflicts: [] };
}

export async function getPersonSystemLinks(
  prisma: PrismaClient,
  personId: string,
  opts: { canViewPii: boolean }
) {
  if (!isPersonUuid(personId)) {
    throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.");
  }
  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: {
      employees: {
        select: {
          id: true,
          name: true,
          socialName: true,
          status: true,
          department: true,
          corporateEmail: true,
        },
      },
      appUsers: {
        select: { id: true, name: true, email: true, isActive: true, role: true },
      },
      commissionPeople: {
        select: { id: true, name: true, email: true, active: true, type: true },
      },
      fleetDrivers: {
        select: { id: true, name: true, status: true, email: true, cpf: true },
      },
      customers: {
        select: {
          id: true,
          companyName: true,
          contactName: true,
          taxId: true,
          status: true,
          email: true,
        },
      },
    },
  });
  if (!person) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);

  return {
    person: {
      id: person.id,
      displayName: person.displayName,
      socialName: person.socialName,
      corporateEmail: opts.canViewPii
        ? person.corporateEmail
        : maskEmail(person.corporateEmail),
      personalEmail: opts.canViewPii
        ? person.personalEmail
        : maskEmail(person.personalEmail),
      cpfNormalized: opts.canViewPii
        ? person.cpfNormalized
        : maskCpf(person.cpfNormalized),
      status: person.status,
    },
    links: {
      employees: person.employees,
      appUsers: person.appUsers.map((u) => ({
        ...u,
        email: opts.canViewPii ? u.email : maskEmail(u.email),
      })),
      commissionPeople: person.commissionPeople.map((c) => ({
        ...c,
        email: opts.canViewPii ? c.email : maskEmail(c.email),
      })),
      fleetDrivers: person.fleetDrivers.map((d) => ({
        ...d,
        email: opts.canViewPii ? d.email : maskEmail(d.email),
        cpf: opts.canViewPii ? d.cpf : maskCpf(d.cpf),
      })),
      customers: person.customers.map((c) => ({
        ...c,
        email: opts.canViewPii ? c.email : maskEmail(c.email),
        taxId: opts.canViewPii ? c.taxId : maskCpf(c.taxId),
        documentKind: classifyCustomerDocument(c.taxId),
      })),
    },
  };
}

export async function unlinkEmployeeFromPerson(
  prisma: PrismaClient,
  employeeId: string
): Promise<void> {
  if (!isPersonUuid(employeeId)) {
    throw new CanonicalPersonError("INVALID_ID", "ID inválido.");
  }
  await prisma.employee.update({
    where: { id: employeeId },
    data: { personId: null },
  });
  console.info(
    JSON.stringify({
      audit: "person.unlink_employee",
      employeeId,
      at: new Date().toISOString(),
    })
  );
}

/** Dry-run de correspondências inequívocas (e-mail/CPF). Não grava. */
export async function diagnoseUnequivocalPersonMatches(prisma: PrismaClient) {
  const report: Array<{
    kind: string;
    leftId: string;
    rightId: string;
    evidence: "email" | "cpf";
    autoLinkSafe: boolean;
  }> = [];

  const employees = await prisma.employee.findMany({
    where: { personId: null },
    select: {
      id: true,
      corporateEmail: true,
      personalEmail: true,
      cpf: true,
      name: true,
    },
    take: 2000,
  });
  const users = await prisma.appUser.findMany({
    where: { personId: null },
    select: { id: true, email: true, name: true },
    take: 2000,
  });

  for (const e of employees) {
    const emails = [e.corporateEmail, e.personalEmail]
      .map(normalizeEmailLoose)
      .filter(Boolean) as string[];
    const cpf = normalizeCpfLoose(e.cpf);
    for (const u of users) {
      const uEmail = normalizeEmailLoose(u.email);
      const emailExact = Boolean(uEmail && emails.includes(uEmail));
      const cpfExact = false; // AppUser sem CPF
      if (
        isUnequivocalMatchEvidence({ emailExact, cpfExact, nameOnly: false }) &&
        emailExact
      ) {
        report.push({
          kind: "employee↔app_user",
          leftId: e.id,
          rightId: u.id,
          evidence: "email",
          autoLinkSafe: true,
        });
      }
    }
  }

  return {
    scannedEmployees: employees.length,
    scannedUsers: users.length,
    unequivocalMatches: report,
    note: "Nome semelhante nunca é auto-link. CPF/e-mail exato apenas.",
  };
}

export async function getCustomerPeopleLinks(
  prisma: PrismaClient,
  customerId: string,
  opts: { canViewPii: boolean }
) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      person: true,
      CrmCustomerCommercialOwner: true,
    },
  });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);

  const docKind = classifyCustomerDocument(customer.taxId);
  return {
    customerId: customer.id,
    documentKind: docKind,
    identity: {
      canLinkPerson: docKind === "PF",
      personId: customer.personId,
      person: customer.person
        ? {
            id: customer.person.id,
            displayName: customer.person.displayName,
            status: customer.person.status,
          }
        : null,
    },
    relationshipLinks: {
      commercialOwner: customer.CrmCustomerCommercialOwner
        ? {
            type: "responsável_carteira",
            sellerResponsibleName: customer.CrmCustomerCommercialOwner.sellerResponsibleName,
            sellerCanonicalName: customer.CrmCustomerCommercialOwner.sellerCanonicalName,
            sellerExternalId: customer.CrmCustomerCommercialOwner.sellerExternalId,
            isActive: customer.CrmCustomerCommercialOwner.isActive,
            note: "Relacionamento comercial — não é identidade Person.",
          }
        : null,
      contactSnapshot: {
        type: "contato_cadastral",
        contactName: customer.contactName,
        email: opts.canViewPii ? customer.email : maskEmail(customer.email),
        phone: opts.canViewPii ? customer.phone : customer.phone ? "***" : null,
        note: "Campo denormalizado do cliente — não existe CustomerContact.",
      },
      accountOwner: customer.accountOwner
        ? { type: "account_owner_texto", value: customer.accountOwner }
        : null,
    },
  };
}
