/**
 * Pessoas 360° v1.1 — execução transacional de vincular, corrigir, desvincular, unificar e
 * reverter. Toda operação: prévia somente leitura → confirmação com estado esperado →
 * transação → `PersonLinkEvent`. Conflitos viram 409 com código claro; nada operacional muda.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { CanonicalPersonError, isPersonUuid, maskCpf, maskEmail } from "@/src/lib/canonicalPerson.js";
import {
  decideRelink,
  isValidLinkEntityKind,
  planPersonMerge,
  type IdentityForMerge,
  type LinkEntityKind,
  type MergePlan,
} from "@/src/lib/people/personLinkOps.js";
import { PERSON_LINK_EVENT_KINDS, recordPersonLinkEvent, type PersonLinkEvidence } from "@/src/lib/people/personLinkEvents.server.js";
import type { SuperAdminGuardActor } from "@/src/lib/security/superAdminRoleGuard.js";
import { accountIdentityChangeDenial, employeePersonChangeDenial } from "@/src/lib/security/accountIdentityLinkPolicy.js";
import { findAccountGainingEmployeeEvidence } from "@/src/lib/security/accountIdentityGuard.server.js";
import { decideAttachAccount, emailsMatch } from "@/src/lib/people/personAccountLink.js";
import { SECURITY_AUDIT_EVENTS, writeSecurityAuditLog } from "@/src/lib/auth/securityAudit.server.js";
import { lockPersonAccountLinks, lockPersonRows } from "@/src/lib/people/personLocks.server.js";

type Db = Prisma.TransactionClient;
export type OpsActor = { id: string | null; name?: string | null };
/** Ator com papel/elevação: operações sobre contas SUPER_ADMIN exigem SUPER_ADMIN elevado. */
export type OpsActorWithRole = OpsActor & Partial<Pick<SuperAdminGuardActor, "role" | "elevated">>;

/** Mudar a Pessoa de uma conta: permissão efetiva de vínculo com usuário + política única (também usada pelo RH). */
function assertAccountOperationAllowed(actor: OpsActorWithRole | undefined, account: { id: string; role: string | null | undefined }, canManageAccountIdentity: boolean | undefined) {
  if (!canManageAccountIdentity) {
    throw new CanonicalPersonError("ACCOUNT_LINK_PERMISSION_REQUIRED", "Corrigir o vínculo de uma conta de acesso exige a permissão de vínculo com usuário (RH).", 403);
  }
  const denial = accountIdentityChangeDenial({ actor: toGuardActor(actor), account });
  if (denial) throw new CanonicalPersonError(denial.code, denial.message, denial.status);
}

const toGuardActor = (actor: OpsActorWithRole | undefined) => ({ id: actor?.id ?? null, role: actor?.role ?? null, elevated: Boolean(actor?.elevated) });

function assertUuid(value: unknown, label: string): string {
  if (!isPersonUuid(value)) throw new CanonicalPersonError("INVALID_ID", `${label} inválido.`, 400);
  return value as string;
}

export async function loadIdentityForMerge(db: Db, personId: string): Promise<IdentityForMerge> {
  const p = await db.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      displayName: true,
      status: true,
      cpfNormalized: true,
      corporateEmail: true,
      employees: { select: { id: true } },
      appUsers: { select: { id: true, isActive: true } },
      fleetDrivers: { select: { id: true } },
      commissionPeople: { select: { id: true } },
      customersAsIdentity: { select: { id: true } },
      customersAsContact: { select: { id: true } },
    },
  });
  if (!p) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  return {
    id: p.id,
    displayName: p.displayName,
    status: p.status,
    cpfNormalized: p.cpfNormalized,
    corporateEmail: p.corporateEmail,
    employeeIds: p.employees.map((e) => e.id),
    activeUserIds: p.appUsers.filter((u) => u.isActive).map((u) => u.id),
    inactiveUserIds: p.appUsers.filter((u) => !u.isActive).map((u) => u.id),
    fleetDriverIds: p.fleetDrivers.map((d) => d.id),
    commissionPersonIds: p.commissionPeople.map((c) => c.id),
    customerIdentityIds: p.customersAsIdentity.map((c) => c.id),
    customerContactIds: p.customersAsContact.map((c) => c.id),
  };
}

type EntitySnapshot = { id: string; label: string; personId: string | null; detail: string | null; cpfNormalized: string | null; email: string | null; role?: string | null; employeeId?: string | null; isActive?: boolean };

async function loadEntity(db: Db, kind: LinkEntityKind, id: string): Promise<EntitySnapshot> {
  if (kind === "employee") {
    const e = await db.employee.findUnique({ where: { id }, select: { id: true, name: true, socialName: true, personId: true, cpf: true, corporateEmail: true, department: true } });
    if (!e) throw new CanonicalPersonError("ENTITY_NOT_FOUND", "Colaborador não encontrado.", 404);
    return { id: e.id, label: e.socialName?.trim() || e.name, personId: e.personId, detail: e.department, cpfNormalized: e.cpf ? e.cpf.replace(/\D/g, "") || null : null, email: e.corporateEmail };
  }
  if (kind === "app_user") {
    const u = await db.appUser.findUnique({ where: { id }, select: { id: true, name: true, email: true, personId: true, role: true, employeeId: true, isActive: true } });
    if (!u) throw new CanonicalPersonError("ENTITY_NOT_FOUND", "Usuário não encontrado.", 404);
    return { id: u.id, label: u.name, personId: u.personId, detail: `${u.role}${u.employeeId ? " · ligado a colaborador" : ""}`, cpfNormalized: null, email: u.email, role: u.role, employeeId: u.employeeId, isActive: u.isActive };
  }
  if (kind === "fleet_driver") {
    const d = await db.fleetDriver.findUnique({ where: { id }, select: { id: true, name: true, personId: true, cpf: true, email: true, status: true } });
    if (!d) throw new CanonicalPersonError("ENTITY_NOT_FOUND", "Motorista não encontrado.", 404);
    return { id: d.id, label: d.name, personId: d.personId, detail: String(d.status), cpfNormalized: d.cpf.replace(/\D/g, "") || null, email: d.email };
  }
  const c = await db.commissionPerson.findUnique({ where: { id }, select: { id: true, name: true, personId: true, document: true, email: true, type: true, nomusPersonId: true } });
  if (!c) throw new CanonicalPersonError("ENTITY_NOT_FOUND", "Pessoa comissionada não encontrada.", 404);
  return { id: c.id, label: c.name, personId: c.personId, detail: `${c.type}${c.nomusPersonId ? ` · Nomus ${c.nomusPersonId}` : ""}`, cpfNormalized: c.document ? c.document.replace(/\D/g, "") || null : null, email: c.email };
}

async function setEntityPerson(db: Db, kind: LinkEntityKind, id: string, personId: string | null, expectedCurrent: string | null): Promise<void> {
  // updateMany com o estado esperado = comparação-e-troca: concorrência vira STALE, não sobrescrita.
  let count = 0;
  const where = { id, personId: expectedCurrent } as const;
  if (kind === "employee") count = (await db.employee.updateMany({ where, data: { personId } })).count;
  else if (kind === "app_user") count = (await db.appUser.updateMany({ where, data: { personId } })).count;
  else if (kind === "fleet_driver") count = (await db.fleetDriver.updateMany({ where, data: { personId } })).count;
  else count = (await db.commissionPerson.updateMany({ where, data: { personId } })).count;
  if (count !== 1) {
    throw new CanonicalPersonError("STALE", "O registro mudou desde a prévia. Recarregue e confira antes de confirmar.", 409);
  }
}

function evidenceFor(target: { cpfNormalized: string | null; corporateEmail: string | null }, entity: EntitySnapshot): PersonLinkEvidence {
  if (target.cpfNormalized && entity.cpfNormalized && target.cpfNormalized === entity.cpfNormalized) return "CPF_EXACT";
  const a = (target.corporateEmail ?? "").toLowerCase();
  const b = (entity.email ?? "").toLowerCase();
  if (a && b && a === b) return "EMAIL_EXACT";
  return "MANUAL";
}

function mapUnique(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new CanonicalPersonError("UNIQUE_CONFLICT", "Outra operação ocupou este vínculo ao mesmo tempo (unicidade). Recarregue e confira.", 409);
  }
  throw error;
}

export async function previewRelink(prisma: PrismaClient, input: { targetPersonId: string; entityKind: unknown; entityId: unknown }) {
  const targetId = assertUuid(input.targetPersonId, "Pessoa");
  if (!isValidLinkEntityKind(input.entityKind)) throw new CanonicalPersonError("INVALID_ENTITY_KIND", "Tipo de cadastro inválido.", 400);
  const entityId = assertUuid(input.entityId, "Cadastro");
  const [target, entity] = await Promise.all([loadIdentityForMerge(prisma, targetId), loadEntity(prisma, input.entityKind, entityId)]);
  const current = entity.personId ? await prisma.person.findUnique({ where: { id: entity.personId }, select: { id: true, displayName: true, status: true } }) : null;
  const decision = decideRelink({
    entityKind: input.entityKind,
    currentPersonId: entity.personId,
    expectedCurrentPersonId: undefined,
    targetPersonId: target.id,
    targetStatus: target.status,
    targetHasEmployee: target.employeeIds.length > 0,
    targetHasUser: target.activeUserIds.length + target.inactiveUserIds.length > 0,
  });
  const targetRow = await prisma.person.findUniqueOrThrow({ where: { id: target.id }, select: { cpfNormalized: true, corporateEmail: true } });
  return {
    entity: { kind: input.entityKind, id: entity.id, label: entity.label, detail: entity.detail, cpfMasked: maskCpf(entity.cpfNormalized), emailMasked: maskEmail(entity.email) },
    currentPerson: current,
    targetPerson: { id: target.id, displayName: target.displayName, status: target.status },
    evidence: evidenceFor(targetRow, entity),
    decision,
    changes: decision.ok
      ? [`${input.entityKind}.personId: ${entity.personId ? entity.personId.slice(0, 8) + "…" : "—"} → ${target.id.slice(0, 8)}…`]
      : [],
    unchanged: ["IDs e dados do cadastro", "Permissões, sessões e senha (contas)", "Comissões, ids Nomus e aliases", "Documentos e históricos"],
    expectedCurrentPersonId: entity.personId,
  };
}

export async function relinkEntity(
  prisma: PrismaClient,
  input: {
    targetPersonId: string;
    entityKind: unknown;
    entityId: unknown;
    expectedCurrentPersonId: string | null | undefined;
    reason: string | null;
    actor: OpsActorWithRole;
    /** Permissão efetiva de vínculo com usuário, resolvida pela rota (ausente = não tem). */
    canManageAccountIdentity?: boolean;
  }
) {
  const targetId = assertUuid(input.targetPersonId, "Pessoa");
  if (!isValidLinkEntityKind(input.entityKind)) throw new CanonicalPersonError("INVALID_ENTITY_KIND", "Tipo de cadastro inválido.", 400);
  const kind = input.entityKind;
  const entityId = assertUuid(input.entityId, "Cadastro");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockPersonRows(tx, [targetId], "SHARE");
      const [target, entity] = await Promise.all([loadIdentityForMerge(tx, targetId), loadEntity(tx, kind, entityId)]);
      if (kind === "app_user") {
        assertAccountOperationAllowed(input.actor, { id: entity.id, role: entity.role }, input.canManageAccountIdentity);
        // Conta entrando na Pessoa: serializa com quem põe colaborador nela (evidência "mesma Pessoa").
        await lockPersonAccountLinks(tx, [entity.personId, target.id]);
      }
      if (kind === "employee") {
        // Colaborador entrando na Pessoa de uma conta sem colaborador = mudança de identidade daquela conta.
        const affectedAccount = await findAccountGainingEmployeeEvidence(tx, { fromPersonId: entity.personId, toPersonId: target.id });
        const denial = employeePersonChangeDenial({ actor: toGuardActor(input.actor), canManageAccountIdentity: Boolean(input.canManageAccountIdentity), affectedAccount });
        if (denial) throw new CanonicalPersonError(denial.code, denial.message, denial.status);
      }
      const decision = decideRelink({
        entityKind: kind,
        currentPersonId: entity.personId,
        expectedCurrentPersonId: input.expectedCurrentPersonId,
        targetPersonId: target.id,
        targetStatus: target.status,
        targetHasEmployee: target.employeeIds.length > 0,
        targetHasUser: target.activeUserIds.length + target.inactiveUserIds.length > 0,
      });
      if ("code" in decision) throw new CanonicalPersonError(decision.code, decision.message, decision.status);
      await setEntityPerson(tx, kind, entityId, target.id, entity.personId);
      const targetRow = await tx.person.findUniqueOrThrow({ where: { id: target.id }, select: { cpfNormalized: true, corporateEmail: true } });
      const event = await recordPersonLinkEvent(tx, {
        personId: target.id,
        eventKind: decision.kind === "RELINK" ? PERSON_LINK_EVENT_KINDS.RELINKED : PERSON_LINK_EVENT_KINDS.LINKED,
        entityKind: kind,
        entityId,
        fromPersonId: decision.fromPersonId,
        toPersonId: target.id,
        actorUserId: input.actor.id,
        actorName: input.actor.name ?? null,
        reason,
        evidence: evidenceFor(targetRow, entity),
        snapshot: { entityLabel: entity.label, emailMasked: maskEmail(entity.email) },
        reversible: true,
      });
      return { eventId: event.id, kind: decision.kind, fromPersonId: decision.fromPersonId, toPersonId: target.id };
    });
  } catch (error) {
    mapUnique(error);
  }
}

export async function unlinkEntity(
  prisma: PrismaClient,
  input: { personId: string; entityKind: unknown; entityId: unknown; reason: string | null; actor: OpsActorWithRole; canManageAccountIdentity?: boolean }
) {
  const personId = assertUuid(input.personId, "Pessoa");
  if (!isValidLinkEntityKind(input.entityKind)) throw new CanonicalPersonError("INVALID_ENTITY_KIND", "Tipo de cadastro inválido.", 400);
  const kind = input.entityKind;
  const entityId = assertUuid(input.entityId, "Cadastro");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  return prisma.$transaction(async (tx) => {
    const entity = await loadEntity(tx, kind, entityId);
    if (kind === "app_user") assertAccountOperationAllowed(input.actor, { id: entity.id, role: entity.role }, input.canManageAccountIdentity);
    if (entity.personId !== personId) throw new CanonicalPersonError("STALE", "O registro não aponta mais para esta pessoa. Recarregue.", 409);
    await setEntityPerson(tx, kind, entityId, null, personId);
    const event = await recordPersonLinkEvent(tx, {
      personId,
      eventKind: PERSON_LINK_EVENT_KINDS.UNLINKED,
      entityKind: kind,
      entityId,
      fromPersonId: personId,
      toPersonId: null,
      actorUserId: input.actor.id,
      actorName: input.actor.name ?? null,
      reason,
      evidence: "MANUAL",
      snapshot: { entityLabel: entity.label },
      reversible: true,
    });
    return { eventId: event.id };
  });
}

export async function previewPersonMerge(prisma: PrismaClient, input: { winnerId: string; loserId: string }) {
  const winnerId = assertUuid(input.winnerId, "Pessoa que fica");
  const loserId = assertUuid(input.loserId, "Pessoa absorvida");
  const [winner, loser] = await Promise.all([loadIdentityForMerge(prisma, winnerId), loadIdentityForMerge(prisma, loserId)]);
  const plan = planPersonMerge(winner, loser);
  const describe = (p: IdentityForMerge) => ({
    id: p.id,
    displayName: p.displayName,
    status: p.status,
    cpfMasked: maskCpf(p.cpfNormalized),
    emailMasked: maskEmail(p.corporateEmail),
    counts: {
      employees: p.employeeIds.length,
      users: p.activeUserIds.length + p.inactiveUserIds.length,
      fleetDrivers: p.fleetDriverIds.length,
      commissionPeople: p.commissionPersonIds.length,
      customers: p.customerIdentityIds.length + p.customerContactIds.length,
    },
  });
  return { winner: describe(winner), loser: describe(loser), plan };
}

async function applyMoves(tx: Db, plan: MergePlan, fromPersonId: string, toPersonId: string): Promise<void> {
  const expect = async (count: number, kind: string) => {
    if (count !== 1) throw new CanonicalPersonError("STALE", `O vínculo (${kind}) mudou durante a unificação. Nada foi gravado.`, 409);
  };
  for (const m of plan.moves) {
    if (m.entityKind === "employee") await expect((await tx.employee.updateMany({ where: { id: m.entityId, personId: fromPersonId }, data: { personId: toPersonId } })).count, "colaborador");
    else if (m.entityKind === "app_user") await expect((await tx.appUser.updateMany({ where: { id: m.entityId, personId: fromPersonId }, data: { personId: toPersonId } })).count, "usuário");
    else if (m.entityKind === "fleet_driver") await expect((await tx.fleetDriver.updateMany({ where: { id: m.entityId, personId: fromPersonId }, data: { personId: toPersonId } })).count, "motorista");
    else if (m.entityKind === "commission_person") await expect((await tx.commissionPerson.updateMany({ where: { id: m.entityId, personId: fromPersonId }, data: { personId: toPersonId } })).count, "comissionável");
    else if (m.entityKind === "customer_identity") await expect((await tx.customer.updateMany({ where: { id: m.entityId, personId: fromPersonId }, data: { personId: toPersonId } })).count, "cliente");
    else if (m.entityKind === "customer_contact") await expect((await tx.customer.updateMany({ where: { id: m.entityId, contactPersonId: fromPersonId }, data: { contactPersonId: toPersonId } })).count, "contato de cliente");
  }
}

export async function executePersonMerge(
  prisma: PrismaClient,
  input: { winnerId: string; loserId: string; reason: string | null; actor: OpsActor; expectedMoveCount?: number }
) {
  const winnerId = assertUuid(input.winnerId, "Pessoa que fica");
  const loserId = assertUuid(input.loserId, "Pessoa absorvida");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockPersonRows(tx, [winnerId, loserId], "UPDATE");
      const [winner, loser] = await Promise.all([loadIdentityForMerge(tx, winnerId), loadIdentityForMerge(tx, loserId)]);
      const plan = planPersonMerge(winner, loser);
      if (plan.blockers.length > 0) {
        throw new CanonicalPersonError("MERGE_BLOCKED", plan.blockers.map((b) => b.message).join(" "), 409, undefined);
      }
      if (input.expectedMoveCount !== undefined && input.expectedMoveCount !== plan.moves.length) {
        throw new CanonicalPersonError("STALE", "Os vínculos mudaram desde a prévia. Recarregue e confira.", 409);
      }
      await applyMoves(tx, plan, loser.id, winner.id);
      const fill: Prisma.PersonUpdateInput = {};
      if (plan.fillFromLoser.includes("cpfNormalized")) fill.cpfNormalized = loser.cpfNormalized;
      if (plan.fillFromLoser.includes("corporateEmail")) fill.corporateEmail = loser.corporateEmail;
      if (Object.keys(fill).length > 0) await tx.person.update({ where: { id: winner.id }, data: fill });
      const marked = await tx.person.updateMany({
        where: { id: loser.id, status: { not: "MERGED" } },
        data: { status: "MERGED", mergedIntoPersonId: winner.id, inactivatedAt: new Date() },
      });
      if (marked.count !== 1) throw new CanonicalPersonError("STALE", "A pessoa absorvida mudou durante a unificação.", 409);
      const snapshot = { moves: plan.moves, fillFromLoser: plan.fillFromLoser, loserDisplayName: loser.displayName, winnerDisplayName: winner.displayName, loserStatus: loser.status };
      const event = await recordPersonLinkEvent(tx, {
        personId: winner.id,
        eventKind: PERSON_LINK_EVENT_KINDS.MERGED,
        entityKind: "person",
        entityId: loser.id,
        fromPersonId: loser.id,
        toPersonId: winner.id,
        actorUserId: input.actor.id,
        actorName: input.actor.name ?? null,
        reason,
        evidence: plan.evidence,
        snapshot,
        reversible: true,
      });
      await recordPersonLinkEvent(tx, {
        personId: loser.id,
        eventKind: PERSON_LINK_EVENT_KINDS.MERGED,
        entityKind: "person",
        entityId: winner.id,
        fromPersonId: loser.id,
        toPersonId: winner.id,
        actorUserId: input.actor.id,
        actorName: input.actor.name ?? null,
        reason,
        evidence: plan.evidence,
        snapshot: { mergedInto: winner.id, mainEventId: event.id },
        reversible: false,
      });
      return { eventId: event.id, moved: plan.moves.length, winnerId: winner.id, loserId: loser.id };
    });
  } catch (error) {
    mapUnique(error);
  }
}

export async function revertPersonMerge(prisma: PrismaClient, input: { eventId: string; reason: string | null; actor: OpsActor }) {
  const eventId = assertUuid(input.eventId, "Evento");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  try {
    return await prisma.$transaction(async (tx) => {
      const ev = await tx.personLinkEvent.findUnique({ where: { id: eventId } });
      if (ev?.fromPersonId && ev?.toPersonId) await lockPersonRows(tx, [ev.fromPersonId, ev.toPersonId], "UPDATE");
      if (!ev || ev.eventKind !== PERSON_LINK_EVENT_KINDS.MERGED || !ev.reversible) throw new CanonicalPersonError("EVENT_NOT_REVERSIBLE", "Este evento não pode ser revertido.", 409);
      if (ev.revertedAt) throw new CanonicalPersonError("ALREADY_REVERTED", "Esta unificação já foi revertida.", 409);
      const winnerId = ev.toPersonId!;
      const loserId = ev.fromPersonId!;
      // Dependências novas na vencedora depois da unificação impedem reverter com segurança.
      const newer = await tx.personLinkEvent.count({ where: { personId: winnerId, createdAt: { gt: ev.createdAt }, eventKind: { not: PERSON_LINK_EVENT_KINDS.MERGE_REVERTED } } });
      if (newer > 0) throw new CanonicalPersonError("NEWER_DEPENDENCIES", "Houve vínculos novos na pessoa que ficou depois da unificação. Reverta-os antes.", 409);
      const snapshot = (ev.snapshot ?? {}) as { moves?: MergePlan["moves"]; fillFromLoser?: MergePlan["fillFromLoser"] };
      const plan: MergePlan = { winnerId, loserId, evidence: "MANUAL", blockers: [], moves: snapshot.moves ?? [], fillFromLoser: snapshot.fillFromLoser ?? [], unchanged: [] };
      await applyMoves(tx, plan, winnerId, loserId);
      const unfill: Prisma.PersonUpdateInput = {};
      if (plan.fillFromLoser.includes("cpfNormalized")) unfill.cpfNormalized = null;
      if (plan.fillFromLoser.includes("corporateEmail")) unfill.corporateEmail = null;
      if (Object.keys(unfill).length > 0) await tx.person.update({ where: { id: winnerId }, data: unfill });
      // Reversão restaura a situação que a absorvida tinha antes (INACTIVE continua inativa).
      const loserStatusBefore = (ev.snapshot as { loserStatus?: string } | null)?.loserStatus === "INACTIVE" ? "INACTIVE" : "ACTIVE";
      await tx.person.update({
        where: { id: loserId },
        data: loserStatusBefore === "INACTIVE" ? { status: "INACTIVE", mergedIntoPersonId: null } : { status: "ACTIVE", mergedIntoPersonId: null, inactivatedAt: null },
      });
      const revert = await recordPersonLinkEvent(tx, {
        personId: loserId,
        eventKind: PERSON_LINK_EVENT_KINDS.MERGE_REVERTED,
        entityKind: "person",
        entityId: winnerId,
        fromPersonId: winnerId,
        toPersonId: loserId,
        actorUserId: input.actor.id,
        actorName: input.actor.name ?? null,
        reason,
        evidence: "MANUAL",
        snapshot: { revertedEventId: ev.id, moves: plan.moves },
        reversible: false,
      });
      await tx.personLinkEvent.update({ where: { id: ev.id }, data: { revertedAt: new Date(), revertedByEventId: revert.id } });
      return { eventId: revert.id, restored: plan.moves.length };
    });
  } catch (error) {
    mapUnique(error);
  }
}


// ---------------------------------------------------------------------------
// Regularizar vínculo existente: conta legada (sem Pessoa, ou apontando para outra)
// ganha personId — e employeeId quando ainda não tem — numa única transação.
// Nunca toca id, senha, papel, permissões, perfil, sessões ou vínculo comercial.
// ---------------------------------------------------------------------------

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  personId: true,
  employeeId: true,
  employee: { select: { id: true, name: true, status: true, personId: true, corporateEmail: true, appUser: { select: { id: true } } } },
  person: { select: { id: true, displayName: true } },
} as const;

const EMPLOYEE_FOR_LINK_SELECT = { id: true, name: true, status: true, personId: true, corporateEmail: true, appUser: { select: { id: true } } } as const;

async function loadAttachContext(db: Db | PrismaClient, targetPersonId: string, appUserId: string, employeeIdRaw: unknown) {
  const [target, account] = await Promise.all([
    db.person.findUnique({
      where: { id: targetPersonId },
      select: { id: true, displayName: true, status: true, corporateEmail: true, personalEmail: true, appUsers: { select: { id: true } }, employees: { select: EMPLOYEE_FOR_LINK_SELECT } },
    }),
    db.appUser.findUnique({ where: { id: appUserId }, select: ACCOUNT_SELECT }),
  ]);
  if (!target) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  if (!account) throw new CanonicalPersonError("ENTITY_NOT_FOUND", "Conta não encontrada.", 404);
  // Colaborador: o informado, senão o da conta, senão o da Pessoa-alvo (se houver exatamente um).
  let employee: { id: string; name: string; status: string; personId: string | null; corporateEmail: string | null; appUser: { id: string } | null } | null = null;
  if (typeof employeeIdRaw === "string" && employeeIdRaw.trim()) {
    const id = assertUuid(employeeIdRaw.trim(), "Colaborador");
    employee = await db.employee.findUnique({ where: { id }, select: EMPLOYEE_FOR_LINK_SELECT });
    if (!employee) throw new CanonicalPersonError("EMPLOYEE_NOT_FOUND", "Colaborador não encontrado.", 404);
  } else if (account.employee) {
    employee = account.employee;
  } else if (target.employees.length === 1) {
    employee = target.employees[0]!;
  }
  const emailMismatch = Boolean(
    account.email && !emailsMatch(account.email, employee?.corporateEmail) && !emailsMatch(account.email, target.corporateEmail) && !emailsMatch(account.email, target.personalEmail)
  );
  return { target, account, employee, emailMismatch };
}

/** Contas candidatas para regularização (sem Pessoa, ou ligadas ao colaborador desta Pessoa). */
export async function listCandidateAccounts(prisma: PrismaClient, personId: string, input: { q: string; canViewPii: boolean; limit?: number }) {
  const targetId = assertUuid(personId, "Pessoa");
  const target = await prisma.person.findUnique({
    where: { id: targetId },
    select: { id: true, corporateEmail: true, personalEmail: true, employees: { select: { id: true, corporateEmail: true, appUser: { select: { id: true } } } } },
  });
  if (!target) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  const q = input.q.trim();
  const employeeUserIds = target.employees.map((e) => e.appUser?.id).filter((x): x is string => Boolean(x));
  const where: Prisma.AppUserWhereInput = {
    OR: [
      // Sem permissão de dados pessoais a busca é só por nome (evita usar o filtro como oráculo de e-mail).
      { personId: null, ...(q ? (input.canViewPii ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : { name: { contains: q, mode: "insensitive" } }) : {}) },
      ...(employeeUserIds.length ? [{ id: { in: employeeUserIds } }] : []),
    ],
  };
  const rows = await prisma.appUser.findMany({
    where,
    select: { id: true, name: true, email: true, role: true, isActive: true, personId: true, employeeId: true, employee: { select: { id: true, name: true, personId: true, corporateEmail: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: Math.min(50, Math.max(1, input.limit ?? 20)),
  });
  const emails = new Set([target.corporateEmail, target.personalEmail, ...target.employees.map((e) => e.corporateEmail)].filter(Boolean).map((e) => (e as string).toLowerCase()));
  return rows.map((u) => {
    const employeeOfThisPerson = Boolean(u.employee && (u.employee.personId === target.id || target.employees.some((e) => e.id === u.employee!.id)));
    const emailExact = emails.has(u.email.toLowerCase());
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      emailMasked: maskEmail(u.email),
      email: input.canViewPii ? u.email : null,
      personId: u.personId,
      employee: u.employee ? { id: u.employee.id, name: u.employee.name, belongsToThisPerson: employeeOfThisPerson } : null,
      evidence: employeeOfThisPerson ? ("EMPLOYEE_LINK" as const) : emailExact ? ("EMAIL_EXACT" as const) : ("MANUAL" as const),
    };
  });
}

export async function previewAttachAccount(prisma: PrismaClient, input: { targetPersonId: string; appUserId: unknown; employeeId?: unknown; actor: OpsActorWithRole }) {
  const targetId = assertUuid(input.targetPersonId, "Pessoa");
  const appUserId = assertUuid(input.appUserId, "Conta");
  const ctx = await loadAttachContext(prisma, targetId, appUserId, input.employeeId);
  const decision = decideAttachAccount({
    account: { id: ctx.account.id, role: ctx.account.role, personId: ctx.account.personId, employeeId: ctx.account.employeeId, isActive: ctx.account.isActive, email: ctx.account.email },
    expected: {},
    target: { id: ctx.target.id, status: ctx.target.status, userIds: ctx.target.appUsers.map((u) => u.id), employeeIds: ctx.target.employees.map((e) => e.id) },
    employee: ctx.employee ? { id: ctx.employee.id, status: ctx.employee.status, personId: ctx.employee.personId, appUserId: ctx.employee.appUser?.id ?? null, corporateEmail: ctx.employee.corporateEmail } : null,
    emailMismatch: ctx.emailMismatch,
    confirmEmailMismatch: true,
    // Prévia é somente leitura: um SUPER_ADMIN ainda sem step-up vê o plano completo (o step-up
    // é exigido na confirmação, onde o 403 ADMIN_ELEVATION_REQUIRED abre a confirmação de senha).
    actor: { id: input.actor.id, role: input.actor.role ?? null, elevated: input.actor.role === "SUPER_ADMIN" ? true : Boolean(input.actor.elevated) },
  });
  const changes: string[] = [];
  if (decision.ok) {
    if (ctx.account.personId !== ctx.target.id) changes.push(`app_user.personId: ${ctx.account.personId ? ctx.account.personId.slice(0, 8) + "…" : "—"} → ${ctx.target.id.slice(0, 8)}…`);
    if (decision.setEmployeeId) changes.push(`app_user.employeeId: — → ${decision.setEmployeeId.slice(0, 8)}…`);
    if (decision.setEmployeePersonId && ctx.employee) changes.push(`employee.personId: — → ${ctx.target.id.slice(0, 8)}…`);
  }
  return {
    account: { id: ctx.account.id, name: ctx.account.name, role: ctx.account.role, isActive: ctx.account.isActive, emailMasked: maskEmail(ctx.account.email), currentPerson: ctx.account.person, currentEmployee: ctx.account.employee ? { id: ctx.account.employee.id, name: ctx.account.employee.name } : null },
    employee: ctx.employee ? { id: ctx.employee.id, name: ctx.employee.name, status: ctx.employee.status, personId: ctx.employee.personId, emailMasked: maskEmail(ctx.employee.corporateEmail) } : null,
    targetPerson: { id: ctx.target.id, displayName: ctx.target.displayName, status: ctx.target.status },
    emailMismatch: ctx.emailMismatch,
    evidence: decision.ok ? decision.evidence : null,
    decision,
    changes,
    unchanged: ["Identificador, login, senha e sessões da conta", "Papel, perfil de acesso e permissões", "Vínculo comercial (vendedor Nomus)", "Histórico e auditorias já gravados"],
    expected: { personId: ctx.account.personId, employeeId: ctx.account.employeeId, linkEmployeeId: decision.ok ? decision.setEmployeeId : null },
  };
}

export async function attachAccountToPerson(
  prisma: PrismaClient,
  input: {
    targetPersonId: string;
    appUserId: unknown;
    employeeId?: unknown;
    expected: { personId?: string | null; employeeId?: string | null; linkEmployeeId?: string | null };
    confirmEmailMismatch: boolean;
    reason: string | null;
    actor: OpsActorWithRole;
    origin?: { ipAddress: string | null; userAgent: string | null };
  }
) {
  const targetId = assertUuid(input.targetPersonId, "Pessoa");
  const appUserId = assertUuid(input.appUserId, "Conta");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockPersonRows(tx, [targetId], "SHARE");
      // Conta entrando na Pessoa: serializa com quem põe colaborador nela antes de ler os colaboradores.
      await lockPersonAccountLinks(tx, [targetId]);
      const ctx = await loadAttachContext(tx, targetId, appUserId, input.employeeId);
      const decision = decideAttachAccount({
        account: { id: ctx.account.id, role: ctx.account.role, personId: ctx.account.personId, employeeId: ctx.account.employeeId, isActive: ctx.account.isActive, email: ctx.account.email },
        expected: input.expected,
        target: { id: ctx.target.id, status: ctx.target.status, userIds: ctx.target.appUsers.map((u) => u.id), employeeIds: ctx.target.employees.map((e) => e.id) },
        employee: ctx.employee ? { id: ctx.employee.id, status: ctx.employee.status, personId: ctx.employee.personId, appUserId: ctx.employee.appUser?.id ?? null, corporateEmail: ctx.employee.corporateEmail } : null,
        emailMismatch: ctx.emailMismatch,
        confirmEmailMismatch: input.confirmEmailMismatch,
        actor: { id: input.actor.id, role: input.actor.role ?? null, elevated: Boolean(input.actor.elevated) },
      });
      if ("code" in decision) throw new CanonicalPersonError(decision.code, decision.message, decision.status);
      // CAS único na conta: só personId (+ employeeId quando a conta não tinha). Nada mais.
      const r = await tx.appUser.updateMany({
        where: { id: ctx.account.id, personId: ctx.account.personId, employeeId: ctx.account.employeeId },
        data: { personId: ctx.target.id, ...(decision.setEmployeeId ? { employeeId: decision.setEmployeeId } : {}) },
      });
      if (r.count !== 1) throw new CanonicalPersonError("STALE", "A conta mudou desde a prévia. Recarregue e confira antes de confirmar.", 409);
      let employeeEventId: string | null = null;
      if (decision.setEmployeePersonId && ctx.employee) {
        const e = await tx.employee.updateMany({ where: { id: ctx.employee.id, personId: null }, data: { personId: ctx.target.id } });
        if (e.count !== 1) throw new CanonicalPersonError("STALE", "O colaborador mudou desde a prévia. Recarregue.", 409);
        const ev = await recordPersonLinkEvent(tx, {
          personId: ctx.target.id,
          eventKind: PERSON_LINK_EVENT_KINDS.LINKED,
          entityKind: "employee",
          entityId: ctx.employee.id,
          toPersonId: ctx.target.id,
          actorUserId: input.actor.id,
          actorName: input.actor.name ?? null,
          reason,
          evidence: "MANUAL",
          snapshot: { entityLabel: ctx.employee.name, source: "PERSON_REGULARIZATION" },
          reversible: true,
        });
        employeeEventId = ev.id;
      }
      const event = await recordPersonLinkEvent(tx, {
        personId: ctx.target.id,
        eventKind: decision.kind === "RELINK" ? PERSON_LINK_EVENT_KINDS.RELINKED : PERSON_LINK_EVENT_KINDS.LINKED,
        entityKind: "app_user",
        entityId: ctx.account.id,
        fromPersonId: decision.fromPersonId,
        toPersonId: ctx.target.id,
        actorUserId: input.actor.id,
        actorName: input.actor.name ?? null,
        reason,
        evidence: decision.evidence,
        snapshot: {
          entityLabel: ctx.account.name,
          emailMasked: maskEmail(ctx.account.email),
          employeeId: decision.setEmployeeId ?? ctx.account.employeeId,
          emailMismatchConfirmed: ctx.emailMismatch,
          touchesSuperAdmin: decision.touchesSuperAdmin,
          source: "PERSON_REGULARIZATION",
        },
        reversible: true,
      });
      await writeSecurityAuditLog(tx, {
        eventType: SECURITY_AUDIT_EVENTS.USER_IDENTITY_LINKED,
        actorUserId: input.actor.id,
        targetUserId: ctx.account.id,
        ipAddress: input.origin?.ipAddress ?? null,
        userAgent: input.origin?.userAgent ?? null,
        metadata: {
          source: "PERSON_REGULARIZATION",
          personId: ctx.target.id,
          fromPersonId: decision.fromPersonId,
          employeeId: decision.setEmployeeId ?? ctx.account.employeeId,
          evidence: decision.evidence,
          emailMismatchConfirmed: ctx.emailMismatch,
          touchesSuperAdmin: decision.touchesSuperAdmin,
          personLinkEventId: event.id,
        },
      });
      return { eventId: event.id, employeeEventId, kind: decision.kind, fromPersonId: decision.fromPersonId, toPersonId: ctx.target.id, employeeId: decision.setEmployeeId ?? ctx.account.employeeId };
    });
  } catch (error) {
    mapUnique(error);
  }
}
