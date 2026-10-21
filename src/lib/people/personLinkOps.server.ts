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

type Db = Prisma.TransactionClient;
export type OpsActor = { id: string | null; name?: string | null };

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

type EntitySnapshot = { id: string; label: string; personId: string | null; detail: string | null; cpfNormalized: string | null; email: string | null };

async function loadEntity(db: Db, kind: LinkEntityKind, id: string): Promise<EntitySnapshot> {
  if (kind === "employee") {
    const e = await db.employee.findUnique({ where: { id }, select: { id: true, name: true, socialName: true, personId: true, cpf: true, corporateEmail: true, department: true } });
    if (!e) throw new CanonicalPersonError("ENTITY_NOT_FOUND", "Colaborador não encontrado.", 404);
    return { id: e.id, label: e.socialName?.trim() || e.name, personId: e.personId, detail: e.department, cpfNormalized: e.cpf ? e.cpf.replace(/\D/g, "") || null : null, email: e.corporateEmail };
  }
  if (kind === "app_user") {
    const u = await db.appUser.findUnique({ where: { id }, select: { id: true, name: true, email: true, personId: true, role: true, employeeId: true } });
    if (!u) throw new CanonicalPersonError("ENTITY_NOT_FOUND", "Usuário não encontrado.", 404);
    return { id: u.id, label: u.name, personId: u.personId, detail: `${u.role}${u.employeeId ? " · ligado a colaborador" : ""}`, cpfNormalized: null, email: u.email };
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
  input: { targetPersonId: string; entityKind: unknown; entityId: unknown; expectedCurrentPersonId: string | null | undefined; reason: string | null; actor: OpsActor }
) {
  const targetId = assertUuid(input.targetPersonId, "Pessoa");
  if (!isValidLinkEntityKind(input.entityKind)) throw new CanonicalPersonError("INVALID_ENTITY_KIND", "Tipo de cadastro inválido.", 400);
  const kind = input.entityKind;
  const entityId = assertUuid(input.entityId, "Cadastro");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  try {
    return await prisma.$transaction(async (tx) => {
      const [target, entity] = await Promise.all([loadIdentityForMerge(tx, targetId), loadEntity(tx, kind, entityId)]);
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

export async function unlinkEntity(prisma: PrismaClient, input: { personId: string; entityKind: unknown; entityId: unknown; reason: string | null; actor: OpsActor }) {
  const personId = assertUuid(input.personId, "Pessoa");
  if (!isValidLinkEntityKind(input.entityKind)) throw new CanonicalPersonError("INVALID_ENTITY_KIND", "Tipo de cadastro inválido.", 400);
  const kind = input.entityKind;
  const entityId = assertUuid(input.entityId, "Cadastro");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  return prisma.$transaction(async (tx) => {
    const entity = await loadEntity(tx, kind, entityId);
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
      const snapshot = { moves: plan.moves, fillFromLoser: plan.fillFromLoser, loserDisplayName: loser.displayName, winnerDisplayName: winner.displayName };
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
      await tx.person.update({ where: { id: loserId }, data: { status: "ACTIVE", mergedIntoPersonId: null, inactivatedAt: null } });
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
