/**
 * Pessoas 360° (v1, consulta): lista paginada no banco, ficha da identidade com cartões de
 * vínculo e pendências/conflitos calculados on-line. Nada aqui grava.
 *
 * Regras de exposição: CPF e e-mails só mascarados sem `canViewPii`; os cartões vêm do
 * agregador existente (`getPersonSystemLinks`), que já aplica as capacidades do visualizador.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  CanonicalPersonError,
  isPersonUuid,
  maskCpf,
  maskEmail,
  normalizeCpfLoose,
  normalizeEmailLoose,
  resolvePersonDisplayName,
} from "@/src/lib/canonicalPerson.js";
import type { SystemLinksViewerCaps } from "@/src/lib/employeeSystemLinks.js";
import { getPersonSystemLinks } from "@/src/lib/employeeSystemLinks.server.js";
import { listPersonLinkEvents } from "@/src/lib/people/personLinkEvents.server.js";

export type PersonLinkState = "LINKED" | "NOT_LINKED" | "INACTIVE" | "PENDING_REVIEW" | "CONFLICT";

export type PeopleListFilters = {
  q?: string | null;
  page?: number;
  limit?: number;
  /** ACTIVE | INACTIVE | MERGED | NEEDS_REVIEW | all */
  status?: string | null;
  /** employee | app_user | fleet_driver | commission_person — presença (has) ou ausência (missing). */
  has?: string | null;
  missing?: string | null;
  /** orphan (sem vínculos) | mismatch (usuário e colaborador em Pessoas diferentes) | duplicate (CPF repetido) */
  pending?: string | null;
  canViewPii: boolean;
};

export type PeopleListRow = {
  id: string;
  shortId: string;
  displayName: string;
  civilName: string;
  socialName: string | null;
  status: string;
  origin: string;
  cpfMasked: string | null;
  updatedAt: string;
  links: {
    employee: PersonLinkState;
    appUser: PersonLinkState;
    fleetDriver: PersonLinkState;
    commissionPerson: PersonLinkState;
  };
  documentsCount: number;
  flags: string[];
};

const PERSON_LINK_SELECT = {
  id: true,
  displayName: true,
  socialName: true,
  status: true,
  origin: true,
  cpfNormalized: true,
  corporateEmail: true,
  personalEmail: true,
  phoneNormalized: true,
  createdAt: true,
  updatedAt: true,
  mergedIntoPersonId: true,
  employees: {
    select: {
      id: true,
      status: true,
      appUser: { select: { id: true, personId: true, isActive: true } },
      _count: { select: { hrDocuments: true } },
    },
    take: 3,
  },
  appUsers: { select: { id: true, isActive: true, employeeId: true }, take: 3 },
  fleetDrivers: { select: { id: true, status: true }, take: 5 },
  commissionPeople: { select: { id: true, active: true }, take: 5 },
} satisfies Prisma.PersonSelect;

type PersonRow = Prisma.PersonGetPayload<{ select: typeof PERSON_LINK_SELECT }>;

function stateOf(args: { exists: boolean; active: boolean; conflict?: boolean; pending?: boolean }): PersonLinkState {
  if (args.conflict) return "CONFLICT";
  if (args.exists) return args.active ? "LINKED" : "INACTIVE";
  if (args.pending) return "PENDING_REVIEW";
  return "NOT_LINKED";
}

export function summarizePersonRow(p: PersonRow): PeopleListRow {
  const employee = p.employees[0] ?? null;
  const employeeActive = employee ? (employee.status ?? "ACTIVE").toUpperCase() !== "INACTIVE" : false;
  const linkedUser = p.appUsers[0] ?? null;
  // Conflito: o colaborador desta Pessoa tem uma conta que aponta para OUTRA Pessoa.
  const employeeUserOther = Boolean(employee?.appUser && employee.appUser.personId && employee.appUser.personId !== p.id);
  // Pendência: o colaborador tem conta sem Pessoa (vínculo a confirmar).
  const employeeUserPending = Boolean(employee?.appUser && !employee.appUser.personId && !linkedUser);
  const flags: string[] = [];
  if (p.status === "MERGED") flags.push("MERGED");
  if (p.status === "NEEDS_REVIEW") flags.push("NEEDS_REVIEW");
  if (employeeUserOther) flags.push("USER_ON_OTHER_PERSON");
  if (employeeUserPending) flags.push("USER_WITHOUT_PERSON");
  // Pessoa INACTIVE com vínculo ativo: estado contraditório do legado (ex.: colaborador ativo apontando para Pessoa inativa).
  const activeUser = p.appUsers.some((u) => u.isActive);
  const activeDriver = p.fleetDrivers.some((d) => d.status !== "INACTIVE");
  const activeCommission = p.commissionPeople.some((c) => c.active);
  if (p.status === "INACTIVE" && (employeeActive || activeUser || activeDriver || activeCommission)) flags.push("PERSON_INACTIVE_WITH_ACTIVE_LINKS");
  const totalLinks = p.employees.length + p.appUsers.length + p.fleetDrivers.length + p.commissionPeople.length;
  if (totalLinks === 0) flags.push("NO_LINKS");
  return {
    id: p.id,
    shortId: p.id.slice(0, 8),
    displayName: resolvePersonDisplayName(p),
    civilName: p.displayName,
    socialName: p.socialName,
    status: p.status,
    origin: p.origin,
    cpfMasked: maskCpf(p.cpfNormalized),
    updatedAt: p.updatedAt.toISOString(),
    links: {
      employee: stateOf({ exists: Boolean(employee), active: employeeActive }),
      appUser: stateOf({
        exists: Boolean(linkedUser),
        active: Boolean(linkedUser?.isActive),
        conflict: employeeUserOther,
        pending: employeeUserPending,
      }),
      fleetDriver: stateOf({
        exists: p.fleetDrivers.length > 0,
        active: p.fleetDrivers.some((d) => String(d.status) !== "INACTIVE"),
      }),
      commissionPerson: stateOf({
        exists: p.commissionPeople.length > 0,
        active: p.commissionPeople.some((c) => c.active),
      }),
    },
    documentsCount: p.employees.reduce((acc, e) => acc + e._count.hrDocuments, 0),
    flags,
  };
}

function linkFilter(kind: string, mode: "some" | "none"): Prisma.PersonWhereInput | null {
  switch (kind) {
    case "employee":
      return { employees: { [mode]: {} } };
    case "app_user":
      return { appUsers: { [mode]: {} } };
    case "fleet_driver":
      return { fleetDrivers: { [mode]: {} } };
    case "commission_person":
      return { commissionPeople: { [mode]: {} } };
    default:
      return null;
  }
}

export async function listPeople(prisma: PrismaClient, filters: PeopleListFilters) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const q = (filters.q ?? "").trim();
  const and: Prisma.PersonWhereInput[] = [];

  const status = (filters.status ?? "ACTIVE").toUpperCase();
  if (status !== "ALL") and.push({ status });

  if (q) {
    const or: Prisma.PersonWhereInput[] = [
      { displayName: { contains: q, mode: "insensitive" } },
      { socialName: { contains: q, mode: "insensitive" } },
    ];
    if (isPersonUuid(q)) or.push({ id: q });
    const email = normalizeEmailLoose(q);
    if (email && email.includes("@")) {
      or.push({ corporateEmail: { equals: email, mode: "insensitive" } });
      or.push({ personalEmail: { equals: email, mode: "insensitive" } });
    }
    const cpf = filters.canViewPii ? normalizeCpfLoose(q) : null;
    if (cpf) or.push({ cpfNormalized: cpf });
    and.push({ OR: or });
  }
  if (filters.has) {
    const f = linkFilter(filters.has, "some");
    if (f) and.push(f);
  }
  if (filters.missing) {
    const f = linkFilter(filters.missing, "none");
    if (f) and.push(f);
  }
  if (filters.pending === "orphan") {
    and.push({ employees: { none: {} }, appUsers: { none: {} }, fleetDrivers: { none: {} }, commissionPeople: { none: {} } });
  }
  if (filters.pending === "duplicate") {
    // CPF presente em mais de uma Pessoa (consulta em duas etapas, sem N+1).
    const dup = await prisma.person.groupBy({
      by: ["cpfNormalized"],
      where: { cpfNormalized: { not: null } },
      having: { cpfNormalized: { _count: { gt: 1 } } },
      _count: { _all: true },
    });
    const cpfs = dup.map((d) => d.cpfNormalized).filter((c): c is string => Boolean(c));
    and.push(cpfs.length ? { cpfNormalized: { in: cpfs } } : { id: "00000000-0000-0000-0000-000000000000" });
  }
  if (filters.pending === "mismatch") {
    // Colaborador desta Pessoa cuja conta aponta para outra Pessoa, ou conta sem Pessoa.
    and.push({ employees: { some: { appUser: { isNot: null } } } });
  }

  const where: Prisma.PersonWhereInput = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([
    prisma.person.count({ where }),
    prisma.person.findMany({
      where,
      select: PERSON_LINK_SELECT,
      orderBy: [{ displayName: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  let items = rows.map(summarizePersonRow);
  if (filters.pending === "mismatch") {
    items = items.filter((r) => r.flags.includes("USER_ON_OTHER_PERSON") || r.flags.includes("USER_WITHOUT_PERSON"));
  }
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export type PendingLink = {
  kind: "employee" | "app_user" | "fleet_driver" | "commission_person" | "person";
  entityId: string;
  label: string;
  evidence: "CPF_EXACT" | "EMAIL_EXACT" | "EMPLOYEE_USER_LINK";
  /** Pessoa para a qual o registro aponta hoje (null = nenhuma). */
  currentPersonId: string | null;
  currentPersonLabel: string | null;
  severity: "PENDING" | "CONFLICT";
  hint: string;
};

/**
 * Candidatos a vínculo e conflitos desta Pessoa, por evidência forte (CPF validado) ou
 * pelo vínculo colaborador↔conta. E-mail só aparece como pendência (nunca decide sozinho).
 */
export async function findPendingLinksForPerson(prisma: PrismaClient, personId: string): Promise<PendingLink[]> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, displayName: true, status: true, cpfNormalized: true, corporateEmail: true, employees: { select: { id: true, name: true, appUser: { select: { id: true, name: true, email: true, personId: true, person: { select: { displayName: true } } } } } } },
  });
  if (!person) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  const out: PendingLink[] = [];
  // Pessoa já unificada em outra: nada pendente aqui — os vínculos vivem na Pessoa que ficou.
  if (person.status === "MERGED") return out;
  const cpf = person.cpfNormalized;
  const email = normalizeEmailLoose(person.corporateEmail);

  // Conta do colaborador desta Pessoa apontando para outra Pessoa (caso real) ou sem Pessoa.
  for (const e of person.employees) {
    const u = e.appUser;
    if (!u) continue;
    if (u.personId && u.personId !== person.id) {
      out.push({
        kind: "app_user",
        entityId: u.id,
        label: u.name,
        evidence: "EMPLOYEE_USER_LINK",
        currentPersonId: u.personId,
        currentPersonLabel: u.person?.displayName ?? null,
        severity: "CONFLICT",
        hint: `A conta ${maskEmail(u.email) ?? ""} está ligada ao colaborador ${e.name}, mas aponta para outra Pessoa.`,
      });
    } else if (!u.personId) {
      out.push({
        kind: "app_user",
        entityId: u.id,
        label: u.name,
        evidence: "EMPLOYEE_USER_LINK",
        currentPersonId: null,
        currentPersonLabel: null,
        severity: "PENDING",
        hint: `A conta ${maskEmail(u.email) ?? ""} está ligada ao colaborador ${e.name} e ainda não tem Pessoa.`,
      });
    }
  }

  if (cpf) {
    const [employees, drivers, commission, others] = await Promise.all([
      prisma.employee.findMany({ where: { cpf: { contains: cpf }, OR: [{ personId: null }, { personId: { not: person.id } }] }, select: { id: true, name: true, cpf: true, personId: true, person: { select: { displayName: true } } }, take: 10 }),
      prisma.fleetDriver.findMany({ where: { cpf: { contains: cpf }, OR: [{ personId: null }, { personId: { not: person.id } }] }, select: { id: true, name: true, cpf: true, personId: true, person: { select: { displayName: true } } }, take: 10 }),
      prisma.commissionPerson.findMany({ where: { document: { contains: cpf }, OR: [{ personId: null }, { personId: { not: person.id } }] }, select: { id: true, name: true, document: true, personId: true, person: { select: { displayName: true } } }, take: 10 }),
      prisma.person.findMany({ where: { cpfNormalized: cpf, id: { not: person.id } }, select: { id: true, displayName: true, status: true }, take: 10 }),
    ]);
    for (const e of employees) {
      if (normalizeCpfLoose(e.cpf) !== cpf) continue;
      out.push({ kind: "employee", entityId: e.id, label: e.name, evidence: "CPF_EXACT", currentPersonId: e.personId, currentPersonLabel: e.person?.displayName ?? null, severity: e.personId ? "CONFLICT" : "PENDING", hint: e.personId ? "Colaborador com o mesmo CPF ligado a outra Pessoa." : "Colaborador com o mesmo CPF ainda sem Pessoa." });
    }
    for (const d of drivers) {
      if (normalizeCpfLoose(d.cpf) !== cpf) continue;
      out.push({ kind: "fleet_driver", entityId: d.id, label: d.name, evidence: "CPF_EXACT", currentPersonId: d.personId, currentPersonLabel: d.person?.displayName ?? null, severity: d.personId ? "CONFLICT" : "PENDING", hint: d.personId ? "Motorista com o mesmo CPF ligado a outra Pessoa." : "Motorista com o mesmo CPF ainda sem Pessoa." });
    }
    for (const c of commission) {
      if (normalizeCpfLoose(c.document) !== cpf) continue;
      out.push({ kind: "commission_person", entityId: c.id, label: c.name, evidence: "CPF_EXACT", currentPersonId: c.personId, currentPersonLabel: c.person?.displayName ?? null, severity: c.personId ? "CONFLICT" : "PENDING", hint: c.personId ? "Comissionável com o mesmo CPF ligado a outra Pessoa." : "Comissionável com o mesmo CPF ainda sem Pessoa." });
    }
    for (const o of others) {
      if (o.status === "MERGED") continue;
      out.push({ kind: "person", entityId: o.id, label: o.displayName, evidence: "CPF_EXACT", currentPersonId: o.id, currentPersonLabel: o.displayName, severity: "CONFLICT", hint: "Outra Pessoa canônica com o mesmo CPF (duplicidade a unificar)." });
    }
  }

  if (email) {
    const users = await prisma.appUser.findMany({ where: { email: { equals: email, mode: "insensitive" }, OR: [{ personId: null }, { personId: { not: person.id } }] }, select: { id: true, name: true, personId: true, person: { select: { displayName: true } } }, take: 5 });
    for (const u of users) {
      if (out.some((x) => x.kind === "app_user" && x.entityId === u.id)) continue;
      out.push({ kind: "app_user", entityId: u.id, label: u.name, evidence: "EMAIL_EXACT", currentPersonId: u.personId, currentPersonLabel: u.person?.displayName ?? null, severity: "PENDING", hint: u.personId ? "Conta com o mesmo e-mail ligada a outra Pessoa — confirme antes de corrigir." : "Conta com o mesmo e-mail ainda sem Pessoa — e-mail não prova identidade; confirme." });
    }
  }
  return out;
}

type MasterCapsInput = SystemLinksViewerCaps & Partial<{ canEditPerson: boolean; canManagePersonStatus: boolean; canCreateUsers: boolean; canManageDrivers: boolean; canAttachAccount: boolean }>;

export async function getPersonProfile(prisma: PrismaClient, personId: string, caps: MasterCapsInput, viewer?: { role?: string | null }) {
  if (!isPersonUuid(personId)) throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.");
  const row = await prisma.person.findUnique({ where: { id: personId }, select: PERSON_LINK_SELECT });
  if (!row) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  const summary = summarizePersonRow(row);
  const linkedEntities = [
    ...row.employees.map((e) => ({ kind: "employee" as const, id: e.id })),
    ...row.appUsers.map((u) => ({ kind: "app_user" as const, id: u.id })),
    ...row.fleetDrivers.map((d) => ({ kind: "fleet_driver" as const, id: d.id })),
    ...row.commissionPeople.map((c) => ({ kind: "commission_person" as const, id: c.id })),
  ];
  const [links, pending, events, mergedInto] = await Promise.all([
    getPersonSystemLinks(prisma, personId, caps),
    findPendingLinksForPerson(prisma, personId),
    listPersonLinkEvents(prisma, personId, 50),
    row.mergedIntoPersonId ? prisma.person.findUnique({ where: { id: row.mergedIntoPersonId }, select: { id: true, displayName: true } }) : Promise.resolve(null),
  ]);
  const pendingKinds = new Set(pending.map((p) => p.kind));
  const conflictKinds = new Set(pending.filter((p) => p.severity === "CONFLICT").map((p) => p.kind));
  const withPending = (state: PersonLinkState, kind: PendingLink["kind"]): PersonLinkState => {
    if (state === "LINKED" || state === "INACTIVE") return conflictKinds.has(kind) ? "CONFLICT" : state;
    if (conflictKinds.has(kind)) return "CONFLICT";
    if (pendingKinds.has(kind)) return "PENDING_REVIEW";
    return state;
  };
  return {
    person: {
      id: row.id,
      shortId: summary.shortId,
      displayName: summary.displayName,
      civilName: row.displayName,
      socialName: row.socialName,
      status: row.status,
      origin: row.origin,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      cpfMasked: maskCpf(row.cpfNormalized),
      cpf: caps.canViewPii ? row.cpfNormalized : null,
      corporateEmailMasked: maskEmail(row.corporateEmail),
      corporateEmail: caps.canViewPii ? row.corporateEmail : null,
      personalEmailMasked: maskEmail(row.personalEmail),
      phoneMasked: row.phoneNormalized ? `${"*".repeat(Math.max(0, row.phoneNormalized.length - 4))}${row.phoneNormalized.slice(-4)}` : null,
      mergedInto,
    },
    linkStates: {
      employee: withPending(summary.links.employee, "employee"),
      appUser: withPending(summary.links.appUser, "app_user"),
      fleetDriver: withPending(summary.links.fleetDriver, "fleet_driver"),
      commissionPerson: withPending(summary.links.commissionPerson, "commission_person"),
    },
    documentsCount: summary.documentsCount,
    flags: summary.flags,
    cards: links.executive,
    linkedEntities,
    pending,
    events: events.map((e) => ({
      id: e.id,
      eventKind: e.eventKind,
      entityKind: e.entityKind,
      entityId: e.entityId,
      fromPersonId: e.fromPersonId,
      toPersonId: e.toPersonId,
      actorUserId: e.actorUserId,
      actorName: e.actorName,
      reason: e.reason,
      evidence: e.evidence,
      reversible: e.reversible,
      revertedAt: e.revertedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    caps: {
      canViewPii: caps.canViewPii,
      canManagePersonLink: caps.canManagePersonLink,
      canViewUsers: caps.canViewUsers,
      canViewFleet: caps.canViewFleet,
      canViewCommissions: caps.canViewCommissions,
      canViewEmployees: caps.canViewEmployees,
      /** Unificar/reverter exige SUPER_ADMIN (com step-up no servidor). */
      canMerge: viewer?.role === "SUPER_ADMIN",
      /** Cadastro mestre (a UI só mostra; a rota aplica a guarda). */
      canEditPerson: Boolean(caps.canEditPerson),
      canManagePersonStatus: Boolean(caps.canManagePersonStatus),
      canCreateUsers: Boolean(caps.canCreateUsers),
      canManageDrivers: Boolean(caps.canManageDrivers),
      canAttachAccount: Boolean(caps.canAttachAccount),
    },
  };
}

export type PersonProfile = Awaited<ReturnType<typeof getPersonProfile>>;
