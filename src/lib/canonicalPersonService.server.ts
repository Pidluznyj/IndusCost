/**
 * Pessoa canônica — busca federada e vínculos (server-only).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  applyFieldResolutions,
  CanonicalPersonError,
  classifyCustomerDocument,
  detectPersonFieldConflicts,
  isPersonUuid,
  maskCpf,
  maskEmail,
  normalizeCpfLoose,
  normalizeEmailLoose,
  normalizePhone,
  type FieldConflict,
  type FieldResolutionChoice,
  type PersonFieldKey,
  type PersonIdentitySnapshot,
  type PersonLinkSourceKind,
} from "@/src/lib/canonicalPerson.js";
import {
  mapResolveItemToLegacyHit,
  resolvePeopleSearch,
} from "@/src/lib/canonicalPersonSearch.server.js";
import { employeePersonChangeDenial } from "@/src/lib/security/accountIdentityLinkPolicy.js";
import { findAccountGainingEmployeeEvidence } from "@/src/lib/security/accountIdentityGuard.server.js";
import type { SuperAdminGuardActor } from "@/src/lib/security/superAdminRoleGuard.js";

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
  podeVincular?: boolean;
  motivoBloqueio?: string | null;
  linkStatus?: string;
};

/**
 * Compat FE legado — delega ao motor unificado `resolvePeopleSearch`.
 */
export async function searchCanonicalPeople(
  prisma: PrismaClient,
  input: {
    q: string;
    limit?: number;
    canViewPii: boolean;
    excludeEmployeeId?: string | null;
  }
): Promise<PersonSearchHit[]> {
  const result = await resolvePeopleSearch(prisma, {
    q: input.q,
    page: 1,
    limit: Math.min(Math.max(input.limit ?? 20, 1), 40),
    canViewPii: input.canViewPii,
    excludeEmployeeId: input.excludeEmployeeId,
    includeInactive: false,
  });
  return result.items.map(mapResolveItemToLegacyHit);
}

/** Cliente aceito pelas operações de identidade: o Prisma ou a transação do chamador. */
export type PersonDb = Prisma.TransactionClient;

export type SourceIdentity = {
  sourceKind: PersonLinkSourceKind;
  sourceId: string;
  personId: string | null;
  label: string;
  snapshot: PersonIdentitySnapshot;
  origin: "EMPLOYEE" | "APP_USER" | "COMMISSION" | "SYSTEM";
  status: "ACTIVE" | "INACTIVE";
};

/**
 * Lê a identidade de uma origem SEM gravar nada (prévia). É daqui que a prévia tira o
 * retrato para comparar com o formulário quando a origem ainda não tem Pessoa.
 */
export async function loadSourceIdentity(
  db: PersonDb,
  input: { sourceKind: PersonLinkSourceKind; sourceId: string }
): Promise<SourceIdentity> {
  if (!isPersonUuid(input.sourceId)) {
    throw new CanonicalPersonError("INVALID_SOURCE", "Origem inválida.");
  }
  if (input.sourceKind === "person") {
    const p = await db.person.findUnique({ where: { id: input.sourceId } });
    if (!p) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    return {
      sourceKind: "person",
      sourceId: p.id,
      personId: p.id,
      label: p.displayName,
      snapshot: { displayName: p.displayName, socialName: p.socialName, corporateEmail: p.corporateEmail, personalEmail: p.personalEmail, cpfNormalized: p.cpfNormalized, phoneNormalized: p.phoneNormalized },
      origin: "SYSTEM",
      status: p.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    };
  }
  if (input.sourceKind === "employee") {
    const e = await db.employee.findUnique({ where: { id: input.sourceId } });
    if (!e) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Colaborador não encontrado.", 404);
    return {
      sourceKind: "employee",
      sourceId: e.id,
      personId: e.personId,
      label: e.socialName?.trim() || e.name,
      // Nome civil é o displayName; nome social fica no campo próprio (regra única de exibição).
      snapshot: { displayName: e.name, socialName: e.socialName, corporateEmail: normalizeEmailLoose(e.corporateEmail), personalEmail: normalizeEmailLoose(e.personalEmail), cpfNormalized: normalizeCpfLoose(e.cpf), phoneNormalized: normalizePhone(e.phone) },
      origin: "EMPLOYEE",
      status: (e.status ?? "ACTIVE") === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    };
  }
  if (input.sourceKind === "app_user") {
    const u = await db.appUser.findUnique({ where: { id: input.sourceId } });
    if (!u) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Usuário não encontrado.", 404);
    return {
      sourceKind: "app_user",
      sourceId: u.id,
      personId: u.personId,
      label: u.name,
      snapshot: { displayName: u.name, corporateEmail: normalizeEmailLoose(u.email) },
      origin: "APP_USER",
      status: u.isActive ? "ACTIVE" : "INACTIVE",
    };
  }
  if (input.sourceKind === "commission_person") {
    const c = await db.commissionPerson.findUnique({ where: { id: input.sourceId } });
    if (!c) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Pessoa comissionada não encontrada.", 404);
    return {
      sourceKind: "commission_person",
      sourceId: c.id,
      personId: c.personId,
      label: c.name,
      snapshot: { displayName: c.name, corporateEmail: normalizeEmailLoose(c.email), cpfNormalized: normalizeCpfLoose(c.document) },
      origin: "COMMISSION",
      status: c.active ? "ACTIVE" : "INACTIVE",
    };
  }
  if (input.sourceKind === "fleet_driver") {
    const d = await db.fleetDriver.findUnique({ where: { id: input.sourceId } });
    if (!d) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Motorista não encontrado.", 404);
    return {
      sourceKind: "fleet_driver",
      sourceId: d.id,
      personId: d.personId,
      label: d.name,
      snapshot: { displayName: d.name, corporateEmail: normalizeEmailLoose(d.email), cpfNormalized: normalizeCpfLoose(d.cpf), phoneNormalized: normalizePhone(d.phone) },
      origin: "SYSTEM",
      status: String(d.status) === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    };
  }
  if (input.sourceKind === "customer_pf") {
    const c = await db.customer.findUnique({ where: { id: input.sourceId } });
    if (!c) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Cliente não encontrado.", 404);
    if (classifyCustomerDocument(c.taxId) !== "PF") {
      throw new CanonicalPersonError("CUSTOMER_NOT_PF", "Somente cliente pessoa física pode vincular identidade a Person.");
    }
    return {
      sourceKind: "customer_pf",
      sourceId: c.id,
      personId: c.personId,
      label: c.contactName?.trim() || c.companyName,
      snapshot: { displayName: c.contactName?.trim() || c.companyName, corporateEmail: normalizeEmailLoose(c.email), cpfNormalized: normalizeCpfLoose(c.taxId), phoneNormalized: normalizePhone(c.phone) },
      origin: "SYSTEM",
      status: c.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    };
  }
  throw new CanonicalPersonError("INVALID_SOURCE", "Tipo de origem não suportado.");
}

async function linkSourceToPerson(db: PersonDb, source: SourceIdentity, personId: string): Promise<void> {
  switch (source.sourceKind) {
    case "employee":
      await db.employee.update({ where: { id: source.sourceId }, data: { personId } });
      return;
    case "app_user":
      // Conta de acesso só muda de Pessoa pela política de identidade (Pessoas 360°), nunca por aqui.
      throw accountRegularizationRequired();
    case "commission_person":
      await db.commissionPerson.update({ where: { id: source.sourceId }, data: { personId } });
      return;
    case "fleet_driver":
      await db.fleetDriver.update({ where: { id: source.sourceId }, data: { personId } });
      return;
    case "customer_pf":
      await db.customer.update({ where: { id: source.sourceId }, data: { personId } });
      return;
    default:
      return;
  }
}

const ACCOUNT_REGULARIZATION_MESSAGE =
  "Conta de acesso só é ligada a uma Pessoa em Pessoas 360° › Regularizar vínculo existente (prévia, justificativa e auditoria).";
const accountRegularizationRequired = () => new CanonicalPersonError("ACCOUNT_REGULARIZATION_REQUIRED", ACCOUNT_REGULARIZATION_MESSAGE, 409);

/**
 * Garante a Pessoa de uma origem (colaborador, usuário, comissionável, motorista, cliente PF).
 *
 * Governança (E4/A): este caminho NUNCA cria uma Pessoa duplicada.
 *  - origem já com Pessoa → devolve;
 *  - CPF validado igual ao de uma Pessoa existente → reutiliza (evidência forte) e liga a origem;
 *  - e-mail igual sem CPF → NÃO decide sozinho: 409 `DUPLICATE_PRIMARY_EMAIL` nomeando a candidata;
 *  - caso contrário cria pela regra canônica (`createPersonCore`, com as mesmas checagens).
 * Tudo dentro de uma transação (do chamador, ou própria).
 *
 * Identidade de conta: esta rotina não tem ator com autoridade sobre contas. Por isso nunca liga
 * uma conta (origem `app_user` sem Pessoa → 409) e nunca põe um colaborador na Pessoa de uma
 * conta sem colaborador (criaria a evidência "mesma Pessoa") — os dois vão para Pessoas 360°.
 */
export async function ensurePersonFromSource(
  prisma: PrismaClient | PersonDb,
  input: { sourceKind: PersonLinkSourceKind; sourceId: string; actorUserId?: string | null }
): Promise<{ id: string; displayName: string; created: boolean; reused: boolean; evidence: "CPF_EXACT" | "SYSTEM" | null }> {
  const run = async (db: PersonDb) => {
    const source = await loadSourceIdentity(db, input);
    if (source.personId) {
      const p = await db.person.findUniqueOrThrow({ where: { id: source.personId } });
      return { id: p.id, displayName: p.displayName, created: false, reused: false, evidence: null };
    }
    if (source.sourceKind === "app_user") throw accountRegularizationRequired();
    const { createPersonCore, findPersonIdentityHints } = await import("@/src/lib/canonicalPersonCore.server.js");
    const { recordPersonLinkEvent, PERSON_LINK_EVENT_KINDS } = await import("@/src/lib/people/personLinkEvents.server.js");
    const cpf = source.snapshot.cpfNormalized ?? null;
    if (cpf) {
      const hints = await findPersonIdentityHints(db as unknown as PrismaClient, { cpfNormalized: cpf });
      if (hints.byCpf.length === 1) {
        const existing = await db.person.findUniqueOrThrow({ where: { id: hints.byCpf[0]! } });
        if (existing.status !== "MERGED") {
          if (source.sourceKind === "employee" && (await findAccountGainingEmployeeEvidence(db, { fromPersonId: null, toPersonId: existing.id }))) {
            throw accountRegularizationRequired();
          }
          await linkSourceToPerson(db, source, existing.id);
          await recordPersonLinkEvent(db, {
            personId: existing.id,
            eventKind: PERSON_LINK_EVENT_KINDS.LINKED,
            entityKind: source.sourceKind,
            entityId: source.sourceId,
            toPersonId: existing.id,
            actorUserId: input.actorUserId ?? null,
            evidence: "CPF_EXACT",
            snapshot: { label: source.label, origin: source.origin },
          });
          return { id: existing.id, displayName: existing.displayName, created: false, reused: true, evidence: "CPF_EXACT" as const };
        }
      }
      if (hints.byCpf.length > 1) {
        throw new CanonicalPersonError(
          "DUPLICATE_CPF",
          "Há mais de uma pessoa canônica com este CPF. Resolva a duplicidade em Pessoas antes de vincular.",
          409
        );
      }
    }
    // Sem CPF decisivo: a regra canônica cria (e recusa e-mail já usado por outra Pessoa).
    const created = await createPersonCore(db as unknown as PrismaClient, {
      displayName: source.snapshot.displayName ?? source.label,
      socialName: source.snapshot.socialName ?? null,
      corporateEmail: source.snapshot.corporateEmail ?? null,
      personalEmail: source.snapshot.personalEmail ?? null,
      cpf,
      phone: source.snapshot.phoneNormalized ?? null,
      origin: source.origin,
      createdByUserId: input.actorUserId ?? null,
    });
    if (source.status === "INACTIVE") {
      await db.person.update({ where: { id: created.id }, data: { status: "INACTIVE" } });
    }
    await linkSourceToPerson(db, source, created.id);
    await recordPersonLinkEvent(db, {
      personId: created.id,
      eventKind: PERSON_LINK_EVENT_KINDS.PERSON_CREATED,
      entityKind: source.sourceKind,
      entityId: source.sourceId,
      toPersonId: created.id,
      actorUserId: input.actorUserId ?? null,
      evidence: "SYSTEM",
      snapshot: { label: source.label, origin: source.origin },
    });
    return { id: created.id, displayName: created.displayName, created: true, reused: false, evidence: "SYSTEM" as const };
  };
  const maybeClient = prisma as PrismaClient;
  if (typeof maybeClient.$transaction === "function") {
    return maybeClient.$transaction((tx) => run(tx));
  }
  return run(prisma as PersonDb);
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

/** Atualiza a Pessoa canônica com o snapshot já resolvido (form vs person). */
export async function syncPersonIdentityFromAppliedForm(
  prisma: PrismaClient,
  personId: string,
  applied: PersonIdentitySnapshot
): Promise<void> {
  const { updatePersonCore } = await import("@/src/lib/canonicalPersonCore.server.js");
  const displayName = (applied.displayName ?? "").trim();
  if (!displayName) {
    throw new CanonicalPersonError(
      "NAME_REQUIRED",
      "Informe o nome canônico da pessoa."
    );
  }
  await updatePersonCore(prisma, personId, {
    displayName,
    socialName: applied.socialName,
    corporateEmail: applied.corporateEmail,
    personalEmail: applied.personalEmail,
    cpf: applied.cpfNormalized,
    phone: applied.phoneNormalized,
  });
}

/**
 * Prévia do vínculo colaborador ↔ Pessoa. SOMENTE LEITURA: nunca cria Pessoa.
 * Quando a origem ainda não tem Pessoa, compara com o retrato da própria origem e
 * devolve `personId: null` + `wouldCreatePerson: true` (a criação acontece só no salvar).
 */
export async function previewLinkEmployeeToPerson(
  prisma: PrismaClient | PersonDb,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    form: PersonIdentitySnapshot;
    /** Pessoa atual do colaborador: pode continuar mesmo se INACTIVE (edição de legado). */
    currentPersonId?: string | null;
  }
): Promise<{
  personId: string | null;
  conflicts: FieldConflict[];
  person: PersonIdentitySnapshot;
  wouldCreatePerson: boolean;
  source?: { kind: PersonLinkSourceKind; id: string; label: string };
}> {
  const db = prisma as PersonDb;
  let personId = input.personId ?? null;
  let personSnap: PersonIdentitySnapshot | null = null;
  let source: { kind: PersonLinkSourceKind; id: string; label: string } | undefined;
  let wouldCreatePerson = false;

  if (!personId && input.sourceKind && input.sourceId) {
    const loaded = await loadSourceIdentity(db, { sourceKind: input.sourceKind, sourceId: input.sourceId });
    source = { kind: loaded.sourceKind, id: loaded.sourceId, label: loaded.label };
    if (loaded.personId) {
      personId = loaded.personId;
    } else {
      personSnap = loaded.snapshot;
      wouldCreatePerson = true;
    }
  }
  if (personId) {
    if (!isPersonUuid(personId)) {
      throw new CanonicalPersonError("PERSON_REQUIRED", "Selecione uma pessoa válida.");
    }
    const person = await db.person.findUnique({ where: { id: personId } });
    if (!person) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    if (person.status === "MERGED") {
      throw new CanonicalPersonError("PERSON_MERGED", "Esta pessoa foi unificada em outra. Selecione a pessoa que ficou.", 409);
    }
    if (person.status === "INACTIVE" && person.id !== (input.currentPersonId ?? null)) {
      throw new CanonicalPersonError("PERSON_INACTIVE", "Esta pessoa está inativa. Reative-a em Pessoas 360° (com justificativa) antes de vinculá-la a um colaborador.", 409);
    }
    personSnap = {
      displayName: person.displayName,
      socialName: person.socialName,
      corporateEmail: person.corporateEmail,
      personalEmail: person.personalEmail,
      cpfNormalized: person.cpfNormalized,
      phoneNormalized: person.phoneNormalized,
    };
  }
  if (!personSnap) {
    throw new CanonicalPersonError("PERSON_REQUIRED", "Selecione uma pessoa válida.");
  }
  const formSnap: PersonIdentitySnapshot = {
    displayName: input.form.displayName,
    socialName: input.form.socialName,
    corporateEmail: normalizeEmailLoose(input.form.corporateEmail),
    personalEmail: normalizeEmailLoose(input.form.personalEmail),
    cpfNormalized: normalizeCpfLoose(input.form.cpfNormalized),
    phoneNormalized: normalizePhone(input.form.phoneNormalized),
  };
  return {
    personId,
    conflicts: detectPersonFieldConflicts(formSnap, personSnap),
    person: personSnap,
    wouldCreatePerson,
    source,
  };
}

export type EmployeePersonLinkPlan = {
  kind: "LINK" | "LINK_FROM_SOURCE" | "CREATE" | "NONE";
  personId: string | null;
  sourceKind: PersonLinkSourceKind | null;
  sourceId: string | null;
  appliedForm: PersonIdentitySnapshot;
  conflicts: FieldConflict[];
  existingEmployeeId: string | null;
  actorUserId: string | null;
};

/**
 * Etapa 1 (somente leitura): valida o pedido de vínculo/criação de Pessoa do formulário do
 * colaborador e devolve um plano. Nenhuma escrita acontece aqui — por isso pode rodar antes
 * das demais validações do cadastro sem deixar rastro em caso de erro.
 */
export async function planEmployeePersonLink(
  prisma: PrismaClient | PersonDb,
  input: {
    personId?: string | null;
    createNewPerson?: boolean;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    form: PersonIdentitySnapshot & { name?: string | null; cpf?: string | null; phone?: string | null };
    fieldResolutions?: Partial<Record<PersonFieldKey, FieldResolutionChoice>>;
    existingEmployeeId?: string | null;
    actorUserId?: string | null;
  }
): Promise<EmployeePersonLinkPlan> {
  const db = prisma as PersonDb;
  const formSnap: PersonIdentitySnapshot = {
    displayName: (input.form.displayName || input.form.name || "").trim() || null,
    socialName: input.form.socialName ?? null,
    corporateEmail: normalizeEmailLoose(input.form.corporateEmail),
    personalEmail: normalizeEmailLoose(input.form.personalEmail),
    cpfNormalized: normalizeCpfLoose(input.form.cpfNormalized ?? input.form.cpf),
    phoneNormalized: normalizePhone(input.form.phoneNormalized ?? input.form.phone),
  };
  const base = {
    sourceKind: input.sourceKind ?? null,
    sourceId: input.sourceId ?? null,
    existingEmployeeId: input.existingEmployeeId ?? null,
    actorUserId: input.actorUserId ?? null,
  };

  if (input.personId || (input.sourceKind && input.sourceId)) {
    const currentPersonId = input.existingEmployeeId
      ? (await db.employee.findUnique({ where: { id: input.existingEmployeeId }, select: { personId: true } }))?.personId ?? null
      : null;
    const preview = await previewLinkEmployeeToPerson(db, {
      personId: input.personId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      form: formSnap,
      currentPersonId,
    });
    const unresolved = preview.conflicts.filter((c) => !input.fieldResolutions?.[c.field]);
    if (unresolved.length > 0) {
      throw new CanonicalPersonError(
        "FIELD_CONFLICTS",
        "Há conflitos de dados com a pessoa selecionada. Resolva antes de salvar.",
        409,
        unresolved
      );
    }
    if (preview.personId) {
      const other = await db.employee.findFirst({
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
    }
    const applied = applyFieldResolutions(formSnap, preview.person, input.fieldResolutions ?? {});
    return {
      ...base,
      kind: preview.personId ? "LINK" : "LINK_FROM_SOURCE",
      personId: preview.personId,
      appliedForm: applied,
      conflicts: preview.conflicts,
    };
  }

  if (input.createNewPerson === true) {
    return { ...base, kind: "CREATE", personId: null, appliedForm: formSnap, conflicts: [] };
  }
  return { ...base, kind: "NONE", personId: null, appliedForm: formSnap, conflicts: [] };
}

/**
 * Etapa 2 (escrita, dentro da transação do colaborador): executa o plano.
 * Falhas aqui revertem junto com o colaborador — nada de Pessoa órfã ou meio-sincronizada.
 */
export async function applyEmployeePersonLinkPlan(
  db: PersonDb,
  plan: EmployeePersonLinkPlan,
  /** Ator e permissão efetiva de vínculo com usuário da requisição (ausente = sem autoridade sobre contas). */
  accountIdentity?: { actor: SuperAdminGuardActor | null; canManageAccountIdentity: boolean }
): Promise<{ personId: string | null; appliedForm: PersonIdentitySnapshot; conflicts: FieldConflict[] }> {
  if (plan.kind === "NONE") {
    return { personId: null, appliedForm: plan.appliedForm, conflicts: [] };
  }
  if (plan.kind === "CREATE") {
    const created = await createCanonicalPerson(db as unknown as PrismaClient, plan.appliedForm, {
      origin: "EMPLOYEE",
      createdByUserId: plan.actorUserId,
    });
    const { recordPersonLinkEvent, PERSON_LINK_EVENT_KINDS } = await import("@/src/lib/people/personLinkEvents.server.js");
    await recordPersonLinkEvent(db, {
      personId: created.id,
      eventKind: PERSON_LINK_EVENT_KINDS.PERSON_CREATED,
      entityKind: "employee",
      entityId: plan.existingEmployeeId,
      toPersonId: created.id,
      actorUserId: plan.actorUserId,
      evidence: "MANUAL",
      snapshot: { origin: "EMPLOYEE" },
    });
    return { personId: created.id, appliedForm: plan.appliedForm, conflicts: [] };
  }
  let personId = plan.personId;
  if (plan.kind === "LINK_FROM_SOURCE") {
    if (!plan.sourceKind || !plan.sourceId) {
      throw new CanonicalPersonError("PERSON_REQUIRED", "Selecione uma pessoa válida.");
    }
    const ensured = await ensurePersonFromSource(db, {
      sourceKind: plan.sourceKind,
      sourceId: plan.sourceId,
      actorUserId: plan.actorUserId,
    });
    personId = ensured.id;
    const other = await db.employee.findFirst({
      where: { personId, ...(plan.existingEmployeeId ? { id: { not: plan.existingEmployeeId } } : {}) },
      select: { id: true, name: true },
    });
    if (other) {
      throw new CanonicalPersonError(
        "PERSON_ALREADY_HAS_EMPLOYEE",
        `Esta pessoa já está vinculada ao colaborador "${other.name}".`,
        409
      );
    }
  }
  if (!personId) throw new CanonicalPersonError("PERSON_REQUIRED", "Selecione uma pessoa válida.");
  // Colaborador entrando na Pessoa de uma conta sem colaborador = mudança de identidade daquela conta.
  const fromPersonId = plan.existingEmployeeId
    ? (await db.employee.findUnique({ where: { id: plan.existingEmployeeId }, select: { personId: true } }))?.personId ?? null
    : null;
  const affectedAccount = await findAccountGainingEmployeeEvidence(db, { fromPersonId, toPersonId: personId });
  const denial = employeePersonChangeDenial({
    actor: accountIdentity?.actor ?? null,
    canManageAccountIdentity: Boolean(accountIdentity?.canManageAccountIdentity),
    affectedAccount,
  });
  if (denial) throw new CanonicalPersonError(denial.code, denial.message, denial.status);
  await syncPersonIdentityFromAppliedForm(db as unknown as PrismaClient, personId, plan.appliedForm);
  if (plan.existingEmployeeId) {
    const { recordPersonLinkEvent, PERSON_LINK_EVENT_KINDS } = await import("@/src/lib/people/personLinkEvents.server.js");
    const current = await db.employee.findUnique({ where: { id: plan.existingEmployeeId }, select: { personId: true } });
    if (current && current.personId !== personId) {
      await recordPersonLinkEvent(db, {
        personId,
        eventKind: current.personId ? PERSON_LINK_EVENT_KINDS.RELINKED : PERSON_LINK_EVENT_KINDS.LINKED,
        entityKind: "employee",
        entityId: plan.existingEmployeeId,
        fromPersonId: current.personId,
        toPersonId: personId,
        actorUserId: plan.actorUserId,
        evidence: "MANUAL",
        reversible: Boolean(current.personId),
      });
    }
  }
  return { personId, appliedForm: plan.appliedForm, conflicts: plan.conflicts };
}

/**
 * Compatibilidade: plano + execução numa transação própria. Os fluxos do cadastro de
 * colaborador usam `planEmployeePersonLink` antes das validações e
 * `applyEmployeePersonLinkPlan` dentro da transação do colaborador.
 */
export async function resolveEmployeePersonIdForPersist(
  prisma: PrismaClient,
  input: Parameters<typeof planEmployeePersonLink>[1]
): Promise<{ personId: string | null; appliedForm: PersonIdentitySnapshot; conflicts: FieldConflict[] }> {
  const plan = await planEmployeePersonLink(prisma, input);
  return prisma.$transaction((tx) => applyEmployeePersonLinkPlan(tx, plan));
}

export async function getPersonSystemLinks(
  prisma: PrismaClient,
  personId: string,
  opts: { canViewPii: boolean }
) {
  const { getPersonSystemLinks: getLinks } = await import(
    "@/src/lib/employeeSystemLinks.server.js"
  );
  return getLinks(prisma, personId, opts);
}

export async function unlinkEmployeeFromPerson(
  prisma: PrismaClient,
  employeeId: string,
  opts?: { actorUserId?: string | null; reason?: string | null }
): Promise<void> {
  if (!isPersonUuid(employeeId)) {
    throw new CanonicalPersonError("INVALID_ID", "ID inválido.");
  }
  await prisma.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({ where: { id: employeeId }, select: { personId: true } });
    await tx.employee.update({ where: { id: employeeId }, data: { personId: null } });
    if (current?.personId) {
      const { recordPersonLinkEvent, PERSON_LINK_EVENT_KINDS } = await import("@/src/lib/people/personLinkEvents.server.js");
      await recordPersonLinkEvent(tx, {
        personId: current.personId,
        eventKind: PERSON_LINK_EVENT_KINDS.UNLINKED,
        entityKind: "employee",
        entityId: employeeId,
        fromPersonId: current.personId,
        actorUserId: opts?.actorUserId ?? null,
        reason: opts?.reason ?? null,
        evidence: "MANUAL",
        reversible: true,
      });
    }
  });
  console.info(
    JSON.stringify({
      audit: "person.unlink_employee",
      employeeId,
      at: new Date().toISOString(),
    })
  );
}

/** Dry-run de correspondências inequívocas — motor de backfill (não grava). */
export async function diagnoseUnequivocalPersonMatches(prisma: PrismaClient) {
  const { diagnoseUnequivocalPersonMatchesViaBackfill } = await import(
    "@/src/lib/canonicalPersonBackfill.server.js"
  );
  return diagnoseUnequivocalPersonMatchesViaBackfill(prisma);
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
      contactPerson: true,
      CrmCustomerCommercialOwner: true,
    },
  });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);

  const docKind = classifyCustomerDocument(customer.taxId);

  const otherCustomersWithSamePerson = customer.personId
    ? await prisma.customer.findMany({
        where: { personId: customer.personId, id: { not: customer.id } },
        select: { id: true, companyName: true, taxId: true },
        take: 10,
      })
    : [];

  const contactPersonOtherCustomers = customer.contactPersonId
    ? await prisma.customer.findMany({
        where: { contactPersonId: customer.contactPersonId, id: { not: customer.id } },
        select: { id: true, companyName: true },
        take: 10,
      })
    : [];

  const orders = await prisma.salesOrder.findMany({
    where: { customerId },
    select: {
      id: true,
      orderCode: true,
      externalSellerId: true,
      nomusSellerName: true,
      responsible: true,
      issueDate: true,
    },
    orderBy: { issueDate: "desc" },
    take: 200,
  });

  const sellerMap = new Map<
    string,
    {
      type: "vendedor_pedido_nomus";
      externalSellerId: number | null;
      nomusSellerName: string | null;
      displayName: string;
      orderCount: number;
      sampleOrderCodes: string[];
      note: string;
    }
  >();
  for (const o of orders) {
    const name =
      (o.nomusSellerName || "").trim() ||
      (o.externalSellerId != null ? `Vendedor ID ${o.externalSellerId}` : "");
    if (!name && o.externalSellerId == null) continue;
    const key =
      o.externalSellerId != null
        ? `id:${o.externalSellerId}`
        : `name:${name.toLowerCase()}`;
    const existing = sellerMap.get(key);
    if (existing) {
      existing.orderCount += 1;
      if (existing.sampleOrderCodes.length < 3 && o.orderCode) {
        existing.sampleOrderCodes.push(o.orderCode);
      }
    } else {
      sellerMap.set(key, {
        type: "vendedor_pedido_nomus",
        externalSellerId: o.externalSellerId,
        nomusSellerName: o.nomusSellerName,
        displayName: (o.nomusSellerName || "").trim() || name || "—",
        orderCount: 1,
        sampleOrderCodes: o.orderCode ? [o.orderCode] : [],
        note:
          "Vendedor do Pedido de Venda Nomus — relacionamento comercial, não identidade do cliente nem responsável da carteira.",
      });
    }
  }

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
            email: opts.canViewPii
              ? customer.person.corporateEmail || customer.person.personalEmail
              : maskEmail(
                  customer.person.corporateEmail || customer.person.personalEmail
                ),
            cpfMasked: maskCpf(customer.person.cpfNormalized),
          }
        : null,
      alsoLinkedCustomers: otherCustomersWithSamePerson.map((c) => ({
        id: c.id,
        companyName: c.companyName,
      })),
      note:
        docKind === "PF"
          ? "Identidade: o cliente PF é (ou pode ser) a mesma Pessoa Canônica."
          : "Cliente PJ não possui identidade Person.",
    },
    relationshipLinks: {
      commercialOwner: customer.CrmCustomerCommercialOwner
        ? {
            type: "responsável_carteira",
            sellerResponsibleName: customer.CrmCustomerCommercialOwner.sellerResponsibleName,
            sellerCanonicalName: customer.CrmCustomerCommercialOwner.sellerCanonicalName,
            sellerExternalId: customer.CrmCustomerCommercialOwner.sellerExternalId,
            isActive: customer.CrmCustomerCommercialOwner.isActive,
            note:
              "Responsável da carteira (CRM) — relacionamento. Não é vendedor comissionável do pedido.",
          }
        : null,
      contactSnapshot: {
        type: "contato_cadastral",
        contactName: customer.contactName,
        email: opts.canViewPii ? customer.email : maskEmail(customer.email),
        phone: opts.canViewPii ? customer.phone : customer.phone ? "***" : null,
        note: "Snapshot cadastral do cliente (campos denormalizados).",
      },
      contactPerson: {
        canLink: true,
        personId: customer.contactPersonId,
        person: customer.contactPerson
          ? {
              id: customer.contactPerson.id,
              displayName: customer.contactPerson.displayName,
              status: customer.contactPerson.status,
              email: opts.canViewPii
                ? customer.contactPerson.corporateEmail ||
                  customer.contactPerson.personalEmail
                : maskEmail(
                    customer.contactPerson.corporateEmail ||
                      customer.contactPerson.personalEmail
                  ),
              }
          : null,
        alsoContactOfCustomers: contactPersonOtherCustomers,
        note:
          "Contato externo apontando para Pessoa Canônica. Em PJ, não confunde com a empresa.",
      },
      orderSellers: [...sellerMap.values()],
      accountOwner: customer.accountOwner
        ? {
            type: "gestor_conta_texto",
            value: customer.accountOwner,
            note: "Texto legado accountOwner — não é Person nem carteira CRM.",
          }
        : null,
    },
  };
}

async function resolvePersonTargetId(
  prisma: PrismaClient,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    createNewFromContact?: boolean;
    customer: {
      id: string;
      contactName: string | null;
      companyName: string;
      email: string | null;
      phone: string | null;
      taxId: string;
    };
  }
): Promise<string> {
  if (input.personId) {
    if (!isPersonUuid(input.personId)) {
      throw new CanonicalPersonError("INVALID_PERSON", "Pessoa inválida.");
    }
    const p = await prisma.person.findUnique({ where: { id: input.personId } });
    if (!p) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    return p.id;
  }
  if (input.sourceKind && input.sourceId) {
    const ensured = await ensurePersonFromSource(prisma, {
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
    });
    return ensured.id;
  }
  if (input.createNewFromContact) {
    const created = await createCanonicalPerson(
      prisma,
      {
        displayName: input.customer.contactName?.trim() || input.customer.companyName,
        personalEmail: normalizeEmailLoose(input.customer.email),
        corporateEmail: null,
        cpfNormalized:
          classifyCustomerDocument(input.customer.taxId) === "PF"
            ? normalizeCpfLoose(input.customer.taxId)
            : null,
        phoneNormalized: normalizePhone(input.customer.phone),
      },
      { origin: "SYSTEM" }
    );
    return created.id;
  }
  throw new CanonicalPersonError(
    "PERSON_REQUIRED",
    "Informe personId, origem da busca ou createNewFromContact."
  );
}

/**
 * Vincula identidade Person ↔ Customer (somente PF).
 * Não altera responsável da carteira nem vendedor de pedido.
 */
export async function linkCustomerIdentityPerson(
  prisma: PrismaClient,
  customerId: string,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    createNewFromContact?: boolean;
    fieldResolutions?: Partial<Record<PersonFieldKey, FieldResolutionChoice>>;
  }
) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);
  if (classifyCustomerDocument(customer.taxId) !== "PF") {
    throw new CanonicalPersonError(
      "CUSTOMER_NOT_PF",
      "Somente cliente pessoa física pode vincular identidade a Person."
    );
  }

  const personId = await resolvePersonTargetId(prisma, {
    ...input,
    customer,
  });

  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
  const formSnap: PersonIdentitySnapshot = {
    displayName: customer.contactName?.trim() || customer.companyName,
    personalEmail: normalizeEmailLoose(customer.email),
    corporateEmail: null,
    cpfNormalized: normalizeCpfLoose(customer.taxId),
    phoneNormalized: normalizePhone(customer.phone),
  };
  const personSnap: PersonIdentitySnapshot = {
    displayName: person.displayName,
    socialName: person.socialName,
    corporateEmail: person.corporateEmail,
    personalEmail: person.personalEmail,
    cpfNormalized: person.cpfNormalized,
    phoneNormalized: person.phoneNormalized,
  };
  const conflicts = detectPersonFieldConflicts(formSnap, personSnap);
  if (conflicts.length > 0) {
    const unresolved = conflicts.filter((c) => !input.fieldResolutions?.[c.field]);
    if (unresolved.length > 0) {
      throw new CanonicalPersonError(
        "FIELD_CONFLICTS",
        "Há conflitos entre o cadastro do cliente e a pessoa. Resolva campo a campo.",
        409,
        unresolved
      );
    }
    // Resoluções informadas — apenas vincula; não reescreve Person nem snapshot neste endpoint.
    void applyFieldResolutions(formSnap, personSnap, input.fieldResolutions ?? {});
  }

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { personId },
    select: { id: true, personId: true },
  });

  console.info(
    JSON.stringify({
      audit: "customer.person_identity.link",
      customerId,
      personId,
      at: new Date().toISOString(),
    })
  );

  return {
    ok: true,
    customerId: updated.id,
    personId: updated.personId,
    person: { id: person.id, displayName: person.displayName },
  };
}

export async function unlinkCustomerIdentityPerson(
  prisma: PrismaClient,
  customerId: string
) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, personId: true },
  });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);
  if (!customer.personId) {
    return { ok: true, customerId, personId: null };
  }
  await prisma.customer.update({
    where: { id: customerId },
    data: { personId: null },
  });
  console.info(
    JSON.stringify({
      audit: "customer.person_identity.unlink",
      customerId,
      previousPersonId: customer.personId,
      at: new Date().toISOString(),
      note: "Person não é apagada — histórico preservado.",
    })
  );
  return { ok: true, customerId, personId: null };
}

/**
 * Vincula contato cadastral → Person (PF ou PJ).
 * Em PJ isto NÃO define identidade da empresa.
 */
export async function linkCustomerContactPerson(
  prisma: PrismaClient,
  customerId: string,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    createNewFromContact?: boolean;
  }
) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);

  const personId = await resolvePersonTargetId(prisma, {
    ...input,
    customer,
  });
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });

  await prisma.customer.update({
    where: { id: customerId },
    data: { contactPersonId: personId },
  });

  console.info(
    JSON.stringify({
      audit: "customer.contact_person.link",
      customerId,
      personId,
      documentKind: classifyCustomerDocument(customer.taxId),
      at: new Date().toISOString(),
    })
  );

  return {
    ok: true,
    customerId,
    contactPersonId: personId,
    person: { id: person.id, displayName: person.displayName },
  };
}

export async function unlinkCustomerContactPerson(
  prisma: PrismaClient,
  customerId: string
) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, contactPersonId: true },
  });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);
  if (!customer.contactPersonId) {
    return { ok: true, customerId, contactPersonId: null };
  }
  await prisma.customer.update({
    where: { id: customerId },
    data: { contactPersonId: null },
  });
  console.info(
    JSON.stringify({
      audit: "customer.contact_person.unlink",
      customerId,
      previousContactPersonId: customer.contactPersonId,
      at: new Date().toISOString(),
      note: "Person não é apagada.",
    })
  );
  return { ok: true, customerId, contactPersonId: null };
}
