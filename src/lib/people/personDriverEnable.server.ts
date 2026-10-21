/**
 * Pessoas 360° — "Habilitar motorista": prévia somente leitura e execução transacional.
 * Nome, CPF, telefone e e-mail vêm da Pessoa; os campos da Frota vêm do formulário.
 * Motorista legado nunca é sobrescrito (só personId / status ao reativar).
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { CanonicalPersonError, isPersonUuid, maskCpf } from "@/src/lib/canonicalPerson.js";
import { PERSON_LINK_EVENT_KINDS, recordPersonLinkEvent } from "@/src/lib/people/personLinkEvents.server.js";
import { parseDriverFleetFields, planDriverEnable, type DriverCandidate, type DriverEnablePlan } from "@/src/lib/people/personDriverEnable.js";

type Actor = { id: string | null; name?: string | null };

async function loadContext(db: Pick<PrismaClient, "person" | "fleetDriver">, personId: string) {
  if (!isPersonUuid(personId)) throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.", 400);
  const person = await db.person.findUnique({
    where: { id: personId },
    select: { id: true, displayName: true, socialName: true, status: true, cpfNormalized: true, phoneNormalized: true, corporateEmail: true, personalEmail: true },
  });
  if (!person) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  const cpf = person.cpfNormalized ?? "";
  const [drivers, duplicates] = await Promise.all([
    db.fleetDriver.findMany({
      where: { OR: [{ personId: person.id }, ...(cpf ? [{ cpf: { contains: cpf } }, { cpf: { contains: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` } }] : [])] },
      select: { id: true, name: true, status: true, personId: true, cpf: true, cnhNumber: true, cnhExpirationDate: true, createdFromPublicReservation: true },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 20,
    }),
    cpf ? db.person.count({ where: { cpfNormalized: cpf, status: { not: "MERGED" }, id: { not: person.id } } }) : Promise.resolve(0),
  ]);
  const candidates: DriverCandidate[] = drivers
    .filter((d) => d.personId === person.id || d.cpf.replace(/\D/g, "") === cpf)
    .map((d) => ({ id: d.id, name: d.name, status: d.status, personId: d.personId, cpf: d.cpf }));
  const plan = planDriverEnable({ person, duplicatePersonCount: duplicates, drivers: candidates });
  return { person, drivers, candidates, plan };
}

export async function previewDriverEnable(prisma: PrismaClient, personId: string) {
  const ctx = await loadContext(prisma, personId);
  return {
    person: {
      id: ctx.person.id,
      displayName: ctx.person.socialName?.trim() || ctx.person.displayName,
      status: ctx.person.status,
      cpfMasked: maskCpf(ctx.person.cpfNormalized),
      hasPhone: Boolean(ctx.person.phoneNormalized),
      hasEmail: Boolean(ctx.person.corporateEmail || ctx.person.personalEmail),
    },
    plan: ctx.plan,
    candidates: ctx.drivers.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      linkedToThisPerson: d.personId === ctx.person.id,
      linkedToOtherPerson: Boolean(d.personId && d.personId !== ctx.person.id),
      cpfMasked: maskCpf(d.cpf.replace(/\D/g, "")),
      hasCnh: Boolean(d.cnhNumber),
      createdFromPublicReservation: d.createdFromPublicReservation,
    })),
    fromPerson: ["nome", "CPF", "telefone", "e-mail"],
    fleetFields: ["CNH (número, categoria, validade)", "unidade", "centro de custo", "observações"],
  };
}

export async function enableDriverForPerson(
  prisma: PrismaClient,
  personId: string,
  input: { actor: Actor; body: unknown; fleetAuditUserId: string | null }
): Promise<{ action: DriverEnablePlan["action"]; driverId: string; eventId: string }> {
  const body = (input.body && typeof input.body === "object" ? input.body : {}) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 5) throw new CanonicalPersonError("REASON_REQUIRED", "Informe a justificativa (mínimo 5 caracteres).", 400);
  let fleet;
  try {
    fleet = parseDriverFleetFields(body);
  } catch (e) {
    throw new CanonicalPersonError("INVALID_FIELD", e instanceof Error ? e.message : "Campos da Frota inválidos.", 400);
  }
  const requested = typeof body.action === "string" ? body.action.toUpperCase() : null;
  try {
    return await prisma.$transaction(async (tx) => {
      const ctx = await loadContext(tx as unknown as PrismaClient, personId);
      const plan = ctx.plan;
      if (plan.action === "BLOCKED" || plan.action === "CONFLICT") {
        const first = plan.blockers[0];
        throw new CanonicalPersonError(first?.code ?? "BLOCKED", first?.message ?? "Não é possível habilitar o motorista.", 409);
      }
      if (plan.action === "ALREADY_ENABLED") {
        throw new CanonicalPersonError("ALREADY_ENABLED", "Esta pessoa já tem um motorista ativo vinculado.", 409);
      }
      if (requested && requested !== plan.action) {
        throw new CanonicalPersonError("STALE", `A situação mudou desde a prévia (ação atual: ${plan.action}). Recarregue.`, 409);
      }
      const cpf = ctx.person.cpfNormalized!;
      const name = ctx.person.socialName?.trim() || ctx.person.displayName;
      const audit = (entityId: string, action: string, oldValue: string | null, newValue: Record<string, unknown>) =>
        tx.fleetAuditLog.create({
          data: { entityType: "FleetDriver", entityId, action, oldValue, newValue: JSON.stringify({ ...newValue, cpf: maskCpf(cpf) }), reason, userId: input.fleetAuditUserId },
        });

      if (plan.action === "CREATE") {
        // Unicidade entre ativos (além do índice parcial): dois operadores ao mesmo tempo caem no P2002 → 409 claro.
        const active = await tx.fleetDriver.findFirst({ where: { cpf, status: { not: "INACTIVE" } }, select: { id: true } });
        if (active) throw new CanonicalPersonError("DRIVER_CPF_ACTIVE", "Já existe motorista ativo com este CPF.", 409);
        const created = await tx.fleetDriver.create({
          data: {
            name,
            cpf,
            personId: ctx.person.id,
            phone: ctx.person.phoneNormalized,
            email: ctx.person.corporateEmail ?? ctx.person.personalEmail,
            cnhNumber: fleet.cnhNumber,
            cnhCategory: fleet.cnhCategory,
            cnhExpirationDate: fleet.cnhExpirationDate,
            unit: fleet.unit,
            costCenter: fleet.costCenter,
            status: "PENDING",
            notes: fleet.notes,
          },
        });
        await audit(created.id, "CREATE", null, { name: created.name, status: created.status, personId: ctx.person.id, origin: "PERSON_360" });
        const event = await recordPersonLinkEvent(tx, {
          personId: ctx.person.id,
          eventKind: PERSON_LINK_EVENT_KINDS.LINKED,
          entityKind: "fleet_driver",
          entityId: created.id,
          toPersonId: ctx.person.id,
          actorUserId: input.actor.id,
          actorName: input.actor.name ?? null,
          reason,
          evidence: "CPF_EXACT",
          snapshot: { entityLabel: created.name, action: "CREATE", source: "PERSON_360" },
          reversible: true,
        });
        return { action: "CREATE" as const, driverId: created.id, eventId: event.id };
      }

      const driverId = plan.driverId!;
      const driver = ctx.drivers.find((d) => d.id === driverId)!;
      if (plan.action === "LINK") {
        const r = await tx.fleetDriver.updateMany({ where: { id: driverId, personId: null }, data: { personId: ctx.person.id } });
        if (r.count !== 1) throw new CanonicalPersonError("STALE", "O motorista mudou desde a prévia. Recarregue.", 409);
        await audit(driverId, "UPDATE", JSON.stringify({ personId: null }), { personId: ctx.person.id, origin: "PERSON_360" });
      } else {
        // REACTIVATE: INACTIVE → PENDING, ligado à Pessoa; CNH e histórico intocados.
        const active = await tx.fleetDriver.findFirst({ where: { cpf: driver.cpf, status: { not: "INACTIVE" }, id: { not: driverId } }, select: { id: true } });
        if (active) throw new CanonicalPersonError("DRIVER_CPF_ACTIVE", "Já existe motorista ativo com este CPF.", 409);
        const r = await tx.fleetDriver.updateMany({ where: { id: driverId, status: "INACTIVE" }, data: { status: "PENDING", personId: ctx.person.id } });
        if (r.count !== 1) throw new CanonicalPersonError("STALE", "O motorista mudou desde a prévia. Recarregue.", 409);
        await audit(driverId, "REACTIVATE", JSON.stringify({ status: "INACTIVE", personId: driver.personId }), { status: "PENDING", personId: ctx.person.id, origin: "PERSON_360" });
      }
      const event = await recordPersonLinkEvent(tx, {
        personId: ctx.person.id,
        eventKind: PERSON_LINK_EVENT_KINDS.LINKED,
        entityKind: "fleet_driver",
        entityId: driverId,
        fromPersonId: driver.personId,
        toPersonId: ctx.person.id,
        actorUserId: input.actor.id,
        actorName: input.actor.name ?? null,
        reason,
        evidence: "CPF_EXACT",
        snapshot: { entityLabel: driver.name, action: plan.action, source: "PERSON_360" },
        reversible: true,
      });
      return { action: plan.action, driverId, eventId: event.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CanonicalPersonError("DRIVER_CPF_ACTIVE", "Já existe motorista ativo com este CPF (gravado ao mesmo tempo por outra operação).", 409);
    }
    throw error;
  }
}
