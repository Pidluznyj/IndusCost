/**
 * Motor backend de busca e resolução de pessoas (Prompt 03).
 * Sem integração UI ao Novo Colaborador neste prompt.
 */

import type { PrismaClient } from "@prisma/client";
import {
  classifyCustomerDocument,
  foldAscii,
  maskCpf,
  maskEmail,
  maskPhone,
  normalizeCpfLoose,
  normalizeEmailLoose,
  normalizePhone,
  sourceKindLabel,
  type PersonLinkSourceKind,
} from "@/src/lib/canonicalPerson.js";

export type PersonResolveLinkStatus =
  | "canonical_linked"
  | "legacy_unlinked"
  | "possible_match"
  | "conflict"
  | "unavailable";

export type PersonResolveItem = {
  key: string;
  displayName: string;
  socialName: string | null;
  email: string | null;
  emailMasked: string | null;
  phoneMasked: string | null;
  cpfMasked: string | null;
  /** Presente só com permissão PII. */
  cpf: string | null;
  origin: string;
  sourceKind: PersonLinkSourceKind;
  /** ID interno IndusCost do registro de origem (não Nomus). */
  sourceEntityId: string;
  roles: string[];
  status: string;
  personId: string | null;
  linkStatus: PersonResolveLinkStatus;
  podeVincular: boolean;
  motivoBloqueio: string | null;
  matchReason: "email" | "cpf" | "phone" | "name" | "person" | "code";
  /** Score relativo (maior = melhor evidência). */
  score: number;
};

export type PersonResolveMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  q: string;
};

export type PersonResolveResult = {
  items: PersonResolveItem[];
  meta: PersonResolveMeta;
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

function paginate<T>(rows: T[], page: number, limit: number): { items: T[]; meta: Omit<PersonResolveMeta, "q"> & { q?: string } } {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const start = (safePage - 1) * safeLimit;
  return {
    items: rows.slice(start, start + safeLimit),
    meta: { page: safePage, limit: safeLimit, total, totalPages },
  };
}

function scoreFor(reason: PersonResolveItem["matchReason"], linkStatus: PersonResolveLinkStatus): number {
  const base =
    reason === "cpf" ? 100 : reason === "email" ? 90 : reason === "phone" ? 50 : reason === "person" ? 70 : 30;
  if (linkStatus === "conflict") return base - 5;
  if (linkStatus === "canonical_linked") return base + 10;
  if (linkStatus === "possible_match") return base + 5;
  return base;
}

function resolveLinkFlags(input: {
  personId: string | null;
  alreadyHasEmployee?: boolean;
  selfEmployeeId?: string | null;
  sourceEmployeeId?: string | null;
  conflictSameEmailOtherPerson?: boolean;
}): Pick<PersonResolveItem, "linkStatus" | "podeVincular" | "motivoBloqueio"> {
  if (input.conflictSameEmailOtherPerson) {
    return {
      linkStatus: "conflict",
      podeVincular: false,
      motivoBloqueio: "E-mail associado a outra pessoa canônica.",
    };
  }
  if (input.personId) {
    // Conflito de "já tem colaborador" só no contexto de vínculo (excludeEmployeeId informado).
    if (
      input.alreadyHasEmployee &&
      input.selfEmployeeId != null &&
      input.sourceEmployeeId !== input.selfEmployeeId
    ) {
      return {
        linkStatus: "conflict",
        podeVincular: false,
        motivoBloqueio: "Esta pessoa já possui colaborador vinculado.",
      };
    }
    return {
      linkStatus: "canonical_linked",
      podeVincular: true,
      motivoBloqueio: null,
    };
  }
  return {
    linkStatus: "legacy_unlinked",
    podeVincular: true,
    motivoBloqueio: null,
  };
}

/** Exposto para testes unitários de resolução. */
export function resolvePersonLinkFlagsForTest(
  input: Parameters<typeof resolveLinkFlags>[0]
): ReturnType<typeof resolveLinkFlags> {
  return resolveLinkFlags(input);
}

export function scorePersonResolveForTest(
  reason: PersonResolveItem["matchReason"],
  linkStatus: PersonResolveLinkStatus
): number {
  return scoreFor(reason, linkStatus);
}

function matchesFold(haystack: string, needleFold: string): boolean {
  return foldAscii(haystack).includes(needleFold);
}

/** Prefixo ASCII p/ contains no PG (ex.: "jose"→"jos" encontra "José"). Pós-filtro com fold. */
export function accentSearchPrefix(qFold: string): string {
  const t = qFold.trim();
  if (t.length <= 2) return t;
  return t.slice(0, Math.min(4, t.length));
}

function nameSearchOr(field: "displayName" | "socialName" | "name", qRaw: string, qFold: string) {
  const prefix = accentSearchPrefix(qFold);
  const clauses: Array<Record<string, unknown>> = [
    { [field]: { contains: qRaw, mode: "insensitive" } },
  ];
  if (prefix && foldAscii(qRaw) === qFold) {
    // Consulta sem acento: ampliar com prefixo ASCII e filtrar depois.
    clauses.push({ [field]: { contains: prefix, mode: "insensitive" } });
  }
  return clauses;
}

/**
 * Busca unificada server-side com resolução de vínculo.
 * Contatos de cliente = campo denormalizado em Customer PF (não há CustomerContact).
 * Fornecedor contato: sem catálogo — não inventa SupplierContact.
 */
export async function resolvePeopleSearch(
  prisma: PrismaClient,
  input: {
    q: string;
    page?: number;
    limit?: number;
    canViewPii: boolean;
    /** Exclui o colaborador em edição da lista de gestores/self. */
    excludeEmployeeId?: string | null;
    includeInactive?: boolean;
  }
): Promise<PersonResolveResult> {
  const qRaw = input.q.trim();
  if (qRaw.length < 2) {
    return {
      items: [],
      meta: { page: 1, limit: input.limit ?? 20, total: 0, totalPages: 1, q: qRaw },
    };
  }

  const qFold = foldAscii(qRaw);
  const qEmail = normalizeEmailLoose(qRaw);
  const qCpf = input.canViewPii ? normalizeCpfLoose(qRaw) : null;
  const qPhone = normalizePhone(qRaw);
  const includeInactive = input.includeInactive === true;
  const items: PersonResolveItem[] = [];
  const seen = new Set<string>();

  const push = (item: PersonResolveItem) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    items.push(item);
  };

  const matchReason = (): PersonResolveItem["matchReason"] =>
    qCpf ? "cpf" : qEmail ? "email" : qPhone ? "phone" : "name";

  // —— Person canônica
  const people = await prisma.person.findMany({
    where: {
      AND: [
        includeInactive ? {} : { status: "ACTIVE" },
        {
          OR: [
            ...nameSearchOr("displayName", qRaw, qFold),
            ...nameSearchOr("socialName", qRaw, qFold),
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
      ],
    },
    take: 80,
    include: {
      employees: { select: { id: true, status: true }, take: 5 },
      appUsers: { select: { id: true, isActive: true }, take: 5 },
      commissionPeople: { select: { id: true, active: true }, take: 5 },
      fleetDrivers: { select: { id: true, status: true }, take: 5 },
      customers: { select: { id: true, companyName: true }, take: 5 },
    },
    orderBy: { displayName: "asc" },
  });

  for (const p of people) {
    const nameHit =
      matchesFold(p.displayName, qFold) || matchesFold(p.socialName ?? "", qFold);
    if (!qEmail && !qCpf && !qPhone && !nameHit) continue;
    const roles: string[] = [];
    if (p.employees.length) roles.push("Colaborador");
    if (p.appUsers.length) roles.push("Usuário");
    if (p.commissionPeople.length) roles.push("Pessoa comissionada");
    if (p.fleetDrivers.length) roles.push("Motorista");
    if (p.customers.length) roles.push("Cliente PF");
    const email = emailOf(p);
    const hasOtherEmployee = p.employees.some((e) => e.id !== input.excludeEmployeeId);
    const flags = resolveLinkFlags({
      personId: p.id,
      alreadyHasEmployee: hasOtherEmployee,
      selfEmployeeId: input.excludeEmployeeId,
      sourceEmployeeId: p.employees[0]?.id ?? null,
    });
    const reason = matchReason() === "name" ? "person" : matchReason();
    push({
      key: `person:${p.id}`,
      displayName: p.displayName,
      socialName: p.socialName,
      email: input.canViewPii ? email : null,
      emailMasked: maskEmail(email),
      phoneMasked: maskPhone(p.phoneNormalized),
      cpfMasked: maskCpf(p.cpfNormalized),
      cpf: input.canViewPii ? p.cpfNormalized : null,
      origin: sourceKindLabel("person"),
      sourceKind: "person",
      sourceEntityId: p.id,
      roles,
      status: p.status,
      personId: p.id,
      ...flags,
      matchReason: reason,
      score: scoreFor(reason, flags.linkStatus),
    });
  }

  // —— Employees legado
  const employees = await prisma.employee.findMany({
    where: {
      AND: [
        input.excludeEmployeeId ? { id: { not: input.excludeEmployeeId } } : {},
        includeInactive ? {} : { OR: [{ status: "ACTIVE" }, { status: null }] },
        {
          OR: [
            ...nameSearchOr("name", qRaw, qFold),
            ...nameSearchOr("socialName", qRaw, qFold),
            ...(qEmail
              ? [
                  { corporateEmail: { equals: qEmail, mode: "insensitive" as const } },
                  { personalEmail: { equals: qEmail, mode: "insensitive" as const } },
                ]
              : []),
            ...(qCpf ? [{ cpf: { contains: qCpf } }] : []),
            ...(qPhone ? [{ phone: { contains: qPhone } }] : []),
          ],
        },
      ],
    },
    take: 60,
    select: {
      id: true,
      name: true,
      socialName: true,
      corporateEmail: true,
      personalEmail: true,
      phone: true,
      cpf: true,
      status: true,
      personId: true,
    },
    orderBy: { name: "asc" },
  });

  for (const e of employees) {
    const nameHit = matchesFold(e.name, qFold) || matchesFold(e.socialName ?? "", qFold);
    if (!qEmail && !qCpf && !qPhone && !nameHit) continue;
    const email = emailOf(e);
    const flags = resolveLinkFlags({ personId: e.personId });
    // Se já está na lista via Person, skip duplicate key person:...
    if (e.personId && seen.has(`person:${e.personId}`)) continue;
    const reason = matchReason();
    push({
      key: `employee:${e.id}`,
      displayName: e.socialName?.trim() || e.name,
      socialName: e.socialName,
      email: input.canViewPii ? email : null,
      emailMasked: maskEmail(email),
      phoneMasked: maskPhone(e.phone),
      cpfMasked: maskCpf(e.cpf),
      cpf: input.canViewPii ? normalizeCpfLoose(e.cpf) : null,
      origin: "Colaborador",
      sourceKind: "employee",
      sourceEntityId: e.id,
      roles: ["Colaborador"],
      status: e.status ?? "ACTIVE",
      personId: e.personId,
      ...flags,
      matchReason: reason,
      score: scoreFor(reason, flags.linkStatus),
    });
  }

  // —— AppUsers (sem N+1: um prefetch de e-mails → Person)
  const users = await prisma.appUser.findMany({
    where: {
      AND: [
        includeInactive ? {} : { isActive: true },
        {
          OR: [
            ...(nameSearchOr("name", qRaw, qFold) as Array<{ name: { contains: string; mode: "insensitive" } }>),
            ...(qEmail ? [{ email: { equals: qEmail, mode: "insensitive" as const } }] : []),
          ],
        },
      ],
    },
    take: 40,
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      personId: true,
      employeeId: true,
    },
    orderBy: { name: "asc" },
  });

  const userEmails = users
    .filter((u) => !u.personId)
    .map((u) => normalizeEmailLoose(u.email))
    .filter((e): e is string => Boolean(e));
  const peopleByEmail = new Map<string, string>();
  if (userEmails.length > 0) {
    const matched = await prisma.person.findMany({
      where: {
        OR: userEmails.map((e) => ({
          corporateEmail: { equals: e, mode: "insensitive" as const },
        })),
      },
      select: { id: true, corporateEmail: true },
      take: 80,
    });
    for (const m of matched) {
      const e = normalizeEmailLoose(m.corporateEmail);
      if (e) peopleByEmail.set(e, m.id);
    }
  }

  for (const u of users) {
    if (u.personId && seen.has(`person:${u.personId}`)) continue;
    const nameHit = matchesFold(u.name, qFold);
    if (!qEmail && !nameHit) continue;
    const email = normalizeEmailLoose(u.email);
    const conflict = Boolean(email && !u.personId && peopleByEmail.has(email));
    const flags = resolveLinkFlags({
      personId: u.personId,
      conflictSameEmailOtherPerson: false,
    });
    if (conflict) {
      flags.linkStatus = "possible_match";
      flags.podeVincular = true;
      flags.motivoBloqueio = "Há Person com o mesmo e-mail — vincular exige confirmação.";
    }
    const reason = qEmail ? "email" : "name";
    push({
      key: `app_user:${u.id}`,
      displayName: u.name,
      socialName: null,
      email: input.canViewPii ? email : null,
      emailMasked: maskEmail(email),
      phoneMasked: null,
      cpfMasked: null,
      cpf: null,
      origin: "Usuário do sistema",
      sourceKind: "app_user",
      sourceEntityId: u.id,
      roles: ["Usuário"],
      status: u.isActive ? "ACTIVE" : "INACTIVE",
      personId: u.personId,
      ...flags,
      matchReason: reason,
      score: scoreFor(reason, flags.linkStatus) + (conflict ? 5 : 0),
    });
  }

  // —— CommissionPerson
  const cps = await prisma.commissionPerson.findMany({
    where: {
      AND: [
        includeInactive ? {} : { active: true },
        {
          OR: [
            ...(nameSearchOr("name", qRaw, qFold) as Array<{ name: { contains: string; mode: "insensitive" } }>),
            ...(qEmail ? [{ email: { equals: qEmail, mode: "insensitive" as const } }] : []),
            ...(qCpf ? [{ document: { contains: qCpf } }] : []),
          ],
        },
      ],
    },
    take: 40,
    select: {
      id: true,
      name: true,
      email: true,
      document: true,
      active: true,
      personId: true,
      type: true,
    },
    orderBy: { name: "asc" },
  });

  for (const c of cps) {
    if (c.personId && seen.has(`person:${c.personId}`)) continue;
    const nameHit = matchesFold(c.name, qFold);
    if (!qEmail && !qCpf && !nameHit) continue;
    const email = normalizeEmailLoose(c.email);
    const flags = resolveLinkFlags({ personId: c.personId });
    const reason = matchReason();
    push({
      key: `commission_person:${c.id}`,
      displayName: c.name,
      socialName: null,
      email: input.canViewPii ? email : null,
      emailMasked: maskEmail(email),
      phoneMasked: null,
      cpfMasked: maskCpf(c.document),
      cpf: input.canViewPii ? normalizeCpfLoose(c.document) : null,
      origin: "Pessoa comissionada",
      sourceKind: "commission_person",
      sourceEntityId: c.id,
      roles: ["Pessoa comissionada", c.type],
      status: c.active ? "ACTIVE" : "INACTIVE",
      personId: c.personId,
      ...flags,
      matchReason: reason,
      // não expor nomusPersonId
      score: scoreFor(reason, flags.linkStatus),
    });
  }

  // —— FleetDriver
  const drivers = await prisma.fleetDriver.findMany({
    where: {
      AND: [
        includeInactive ? {} : { status: { in: ["AUTHORIZED", "PENDING", "BLOCKED"] } },
        {
          OR: [
            ...(nameSearchOr("name", qRaw, qFold) as Array<{ name: { contains: string; mode: "insensitive" } }>),
            ...(qEmail ? [{ email: { equals: qEmail, mode: "insensitive" as const } }] : []),
            ...(qCpf ? [{ cpf: { contains: qCpf } }] : []),
            ...(qPhone ? [{ phone: { contains: qPhone } }] : []),
          ],
        },
      ],
    },
    take: 40,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      cpf: true,
      status: true,
      personId: true,
    },
    orderBy: { name: "asc" },
  });

  for (const d of drivers) {
    if (d.personId && seen.has(`person:${d.personId}`)) continue;
    const nameHit = matchesFold(d.name, qFold);
    if (!qEmail && !qCpf && !qPhone && !nameHit) continue;
    const email = normalizeEmailLoose(d.email);
    const flags = resolveLinkFlags({ personId: d.personId });
    const reason = matchReason();
    push({
      key: `fleet_driver:${d.id}`,
      displayName: d.name,
      socialName: null,
      email: input.canViewPii ? email : null,
      emailMasked: maskEmail(email),
      phoneMasked: maskPhone(d.phone),
      cpfMasked: maskCpf(d.cpf),
      cpf: input.canViewPii ? normalizeCpfLoose(d.cpf) : null,
      origin: "Motorista",
      sourceKind: "fleet_driver",
      sourceEntityId: d.id,
      roles: ["Motorista"],
      status: String(d.status),
      personId: d.personId,
      ...flags,
      matchReason: reason,
      score: scoreFor(reason, flags.linkStatus),
    });
  }

  // —— Customer PF (contato denormalizado — não há CustomerContact)
  const customers = await prisma.customer.findMany({
    where: {
      AND: [
        includeInactive ? {} : { status: "ACTIVE" },
        {
          OR: [
            { companyName: { contains: qRaw, mode: "insensitive" } },
            { contactName: { contains: qRaw, mode: "insensitive" } },
            { tradeName: { contains: qRaw, mode: "insensitive" } },
            ...(qEmail ? [{ email: { equals: qEmail, mode: "insensitive" as const } }] : []),
            ...(qCpf ? [{ taxId: { contains: qCpf } }] : []),
            ...(qPhone ? [{ phone: { contains: qPhone } }] : []),
          ],
        },
      ],
    },
    take: 40,
    select: {
      id: true,
      companyName: true,
      contactName: true,
      tradeName: true,
      taxId: true,
      email: true,
      phone: true,
      status: true,
      personId: true,
    },
  });

  for (const c of customers) {
    if (classifyCustomerDocument(c.taxId) !== "PF") continue;
    if (c.personId && seen.has(`person:${c.personId}`)) continue;
    const nameHit =
      matchesFold(c.companyName, qFold) ||
      matchesFold(c.contactName ?? "", qFold) ||
      matchesFold(c.tradeName ?? "", qFold);
    if (!qEmail && !qCpf && !qPhone && !nameHit) continue;
    const email = normalizeEmailLoose(c.email);
    const flags = resolveLinkFlags({ personId: c.personId });
    const reason = matchReason();
    push({
      key: `customer_pf:${c.id}`,
      displayName: c.contactName?.trim() || c.companyName,
      socialName: null,
      email: input.canViewPii ? email : null,
      emailMasked: maskEmail(email),
      phoneMasked: maskPhone(c.phone),
      cpfMasked: maskCpf(c.taxId),
      cpf: input.canViewPii ? normalizeCpfLoose(c.taxId) : null,
      origin: `Cliente PF · ${c.companyName}`,
      sourceKind: "customer_pf",
      sourceEntityId: c.id,
      roles: ["Cliente (pessoa física)", "Contato cadastral"],
      status: c.status,
      personId: c.personId,
      ...flags,
      matchReason: reason,
      score: scoreFor(reason, flags.linkStatus),
    });
  }

  // Nomes iguais → não vira merge; apenas ordenação por score
  items.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName, "pt-BR"));

  const page = Number(input.page) || 1;
  const limit = Number(input.limit) || 20;
  const paged = paginate(items, page, limit);
  return {
    items: paged.items,
    meta: { ...paged.meta, q: qRaw },
  };
}

/** Adapta o motor novo ao formato legado `PersonSearchHit` (compat FE). */
export function mapResolveItemToLegacyHit(item: PersonResolveItem): {
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
  podeVincular: boolean;
  motivoBloqueio: string | null;
  linkStatus: PersonResolveLinkStatus;
} {
  return {
    key: item.key,
    personId: item.personId,
    sourceKind: item.sourceKind,
    sourceId: item.sourceEntityId,
    displayName: item.displayName,
    socialName: item.socialName,
    emailMasked: item.emailMasked,
    email: item.email,
    originLabel: item.origin,
    roles: item.roles,
    status: item.status,
    matchReason:
      item.matchReason === "code" ? "name" : (item.matchReason as "email" | "cpf" | "phone" | "name" | "person"),
    podeVincular: item.podeVincular,
    motivoBloqueio: item.motivoBloqueio,
    linkStatus: item.linkStatus,
  };
}
