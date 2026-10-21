/**
 * Pessoas 360° — cadastro mestre: criar Pessoa direta, editar dados canônicos e mudar situação.
 * Reaproveita createPersonCore/updatePersonCore (única regra de duplicidade) e grava
 * PersonLinkEvent com ator e motivo. Transação em toda escrita. Nada é apagado.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { CanonicalPersonError, isPersonUuid, maskCpf, maskEmail } from "@/src/lib/canonicalPerson.js";
import { createPersonCore, updatePersonCore } from "@/src/lib/canonicalPersonCore.server.js";
import { PERSON_LINK_EVENT_KINDS, recordPersonLinkEvent } from "@/src/lib/people/personLinkEvents.server.js";
import { decidePersonStatusChange, maskedIdentityDiff, validatePersonIdentityInput, type PersonIdentityPatch } from "@/src/lib/people/personMaster.js";

export type PersonMasterActor = { id: string | null; name?: string | null };

const IDENTITY_SELECT = {
  id: true,
  displayName: true,
  socialName: true,
  corporateEmail: true,
  personalEmail: true,
  cpfNormalized: true,
  phoneNormalized: true,
  status: true,
  origin: true,
  mergedIntoPersonId: true,
} as const;

function requireReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  return r;
}

/** Criar Pessoa diretamente (origem MANUAL). Duplicidade por CPF/e-mail → 409 (nunca cria). */
export async function createPersonManual(prisma: PrismaClient, input: { actor: PersonMasterActor; body: unknown }) {
  const patch = validatePersonIdentityInput(input.body, { partial: false });
  return prisma.$transaction(async (tx) => {
    const created = await createPersonCore(tx as unknown as PrismaClient, {
      displayName: patch.displayName!,
      socialName: patch.socialName ?? null,
      corporateEmail: patch.corporateEmail ?? null,
      personalEmail: patch.personalEmail ?? null,
      cpf: patch.cpf ?? null,
      phone: patch.phone ?? null,
      origin: "MANUAL",
      createdByUserId: input.actor.id ?? null,
    });
    await recordPersonLinkEvent(tx, {
      personId: created.id,
      eventKind: PERSON_LINK_EVENT_KINDS.PERSON_CREATED,
      entityKind: null,
      entityId: null,
      toPersonId: created.id,
      actorUserId: input.actor.id,
      actorName: input.actor.name ?? null,
      evidence: "MANUAL",
      snapshot: { origin: "MANUAL", source: "PESSOAS_360" },
      reversible: false,
    });
    return { id: created.id, displayName: created.displayName };
  });
}

/** Dados canônicos para a tela de edição; CPF/e-mails/telefone em claro só com PII. */
export async function loadPersonIdentityForEdit(prisma: PrismaClient, personId: string, caps: { canViewPii: boolean }) {
  if (!isPersonUuid(personId)) throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.", 400);
  const row = await prisma.person.findUnique({ where: { id: personId }, select: IDENTITY_SELECT });
  if (!row) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  return {
    id: row.id,
    status: row.status,
    origin: row.origin,
    displayName: row.displayName,
    socialName: row.socialName,
    corporateEmail: caps.canViewPii ? row.corporateEmail : null,
    corporateEmailMasked: maskEmail(row.corporateEmail),
    personalEmail: caps.canViewPii ? row.personalEmail : null,
    personalEmailMasked: maskEmail(row.personalEmail),
    cpf: caps.canViewPii ? row.cpfNormalized : null,
    cpfMasked: maskCpf(row.cpfNormalized),
    phone: caps.canViewPii ? row.phoneNormalized : null,
    editable: row.status !== "MERGED",
  };
}

/**
 * Editar identidade (patch parcial: campos ausentes não mudam; null apaga).
 * Pessoa MERGED não é editável. Nunca propaga para AppUser/Employee/Frota/Comissões.
 */
export async function updatePersonIdentity(prisma: PrismaClient, personId: string, input: { actor: PersonMasterActor; body: unknown; reason?: unknown }) {
  if (!isPersonUuid(personId)) throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.", 400);
  const patch: PersonIdentityPatch = validatePersonIdentityInput(input.body, { partial: true });
  if (Object.keys(patch).length === 0) throw new CanonicalPersonError("NOTHING_TO_UPDATE", "Nenhum campo para alterar.", 400);
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : null;
  return prisma.$transaction(async (tx) => {
    const before = await tx.person.findUnique({ where: { id: personId }, select: IDENTITY_SELECT });
    if (!before) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    if (before.status === "MERGED") throw new CanonicalPersonError("PERSON_MERGED", "Esta pessoa foi unificada em outra; edite a pessoa que ficou.", 409);
    await updatePersonCore(tx as unknown as PrismaClient, personId, {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.socialName !== undefined ? { socialName: patch.socialName } : {}),
      ...(patch.corporateEmail !== undefined ? { corporateEmail: patch.corporateEmail } : {}),
      ...(patch.personalEmail !== undefined ? { personalEmail: patch.personalEmail } : {}),
      ...(patch.cpf !== undefined ? { cpf: patch.cpf } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    });
    const after = await tx.person.findUniqueOrThrow({ where: { id: personId }, select: IDENTITY_SELECT });
    const diff = maskedIdentityDiff(before, after);
    if (diff.changed.length === 0) return { id: personId, changed: [] as string[], eventId: null as string | null };
    const event = await recordPersonLinkEvent(tx, {
      personId,
      eventKind: PERSON_LINK_EVENT_KINDS.IDENTITY_UPDATED,
      entityKind: "person",
      entityId: personId,
      actorUserId: input.actor.id,
      actorName: input.actor.name ?? null,
      reason,
      evidence: "MANUAL",
      snapshot: diff,
      reversible: false,
    });
    return { id: personId, changed: diff.changed, eventId: event.id };
  });
}

/** Inativar/reativar identidade. Inativar exige ausência de vínculos ativos (regra explícita). */
export async function setPersonStatus(prisma: PrismaClient, personId: string, input: { actor: PersonMasterActor; status: unknown; reason: unknown }) {
  if (!isPersonUuid(personId)) throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.", 400);
  const reason = requireReason(input.reason);
  return prisma.$transaction(async (tx) => {
    const row = await tx.person.findUnique({
      where: { id: personId },
      select: {
        id: true,
        status: true,
        appUsers: { select: { id: true, isActive: true } },
        employees: { select: { id: true, status: true } },
        fleetDrivers: { select: { id: true, status: true } },
      },
    });
    if (!row) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    const decision = decidePersonStatusChange({
      currentStatus: row.status,
      nextStatus: input.status,
      activeLinks: {
        activeUsers: row.appUsers.filter((u) => u.isActive).length,
        activeEmployees: row.employees.filter((e) => (e.status ?? "ACTIVE").toUpperCase() !== "INACTIVE").length,
        activeDrivers: row.fleetDrivers.filter((d) => d.status !== "INACTIVE").length,
      },
    });
    if ("code" in decision) {
      throw new CanonicalPersonError(decision.code, decision.details ? `${decision.message} (${decision.details.join("; ")})` : decision.message, decision.status);
    }
    const data: Prisma.PersonUpdateInput = decision.to === "INACTIVE" ? { status: "INACTIVE", inactivatedAt: new Date() } : { status: "ACTIVE", inactivatedAt: null };
    // Comparação-e-troca na situação: concorrência vira SAME_STATUS, não sobrescrita.
    const updated = await tx.person.updateMany({ where: { id: personId, status: decision.from }, data });
    if (updated.count !== 1) throw new CanonicalPersonError("STALE", "A situação da pessoa mudou. Recarregue e tente de novo.", 409);
    const event = await recordPersonLinkEvent(tx, {
      personId,
      eventKind: decision.to === "INACTIVE" ? PERSON_LINK_EVENT_KINDS.PERSON_INACTIVATED : PERSON_LINK_EVENT_KINDS.PERSON_REACTIVATED,
      entityKind: "person",
      entityId: personId,
      actorUserId: input.actor.id,
      actorName: input.actor.name ?? null,
      reason,
      evidence: "MANUAL",
      snapshot: { from: decision.from, to: decision.to },
      reversible: false,
    });
    return { id: personId, status: decision.to, eventId: event.id };
  });
}
