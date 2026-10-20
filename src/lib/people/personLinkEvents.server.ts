/**
 * Auditoria imutável de identidade (Pessoas 360°): todo vínculo, desvínculo, correção e
 * unificação grava um `PersonLinkEvent`. Nunca recebe CPF completo; o snapshot leva só o
 * necessário para rastrear e reverter (ids, nomes, e-mails mascarados, origem).
 */
import type { Prisma } from "@prisma/client";

export const PERSON_LINK_EVENT_KINDS = {
  PERSON_CREATED: "PERSON_CREATED",
  LINKED: "LINKED",
  UNLINKED: "UNLINKED",
  RELINKED: "RELINKED",
  MERGED: "MERGED",
  MERGE_REVERTED: "MERGE_REVERTED",
  REVIEW_FLAGGED: "REVIEW_FLAGGED",
} as const;
export type PersonLinkEventKind = (typeof PERSON_LINK_EVENT_KINDS)[keyof typeof PERSON_LINK_EVENT_KINDS];

export const PERSON_LINK_EVIDENCE = {
  CPF_EXACT: "CPF_EXACT",
  EMAIL_EXACT: "EMAIL_EXACT",
  MANUAL: "MANUAL",
  BACKFILL: "BACKFILL",
  SYSTEM: "SYSTEM",
} as const;
export type PersonLinkEvidence = (typeof PERSON_LINK_EVIDENCE)[keyof typeof PERSON_LINK_EVIDENCE];

export type PersonLinkEntityKind = "employee" | "app_user" | "fleet_driver" | "commission_person" | "customer_pf" | "person";

export type PersonLinkEventInput = {
  personId: string;
  eventKind: PersonLinkEventKind;
  entityKind?: PersonLinkEntityKind | null;
  entityId?: string | null;
  fromPersonId?: string | null;
  toPersonId?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  reason?: string | null;
  evidence?: PersonLinkEvidence | null;
  snapshot?: Record<string, unknown> | null;
  reversible?: boolean;
};

const FORBIDDEN_SNAPSHOT_KEYS = ["cpf", "password", "senha", "hash", "token", "secret"];

/** Remove do snapshot qualquer chave que pareça carregar documento completo ou credencial. */
export function sanitizePersonLinkSnapshot(
  snapshot: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!snapshot) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_SNAPSHOT_KEYS.some((f) => lower.includes(f)) && !lower.includes("masked")) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

type EventDb = Pick<Prisma.TransactionClient, "personLinkEvent">;

export async function recordPersonLinkEvent(db: EventDb, input: PersonLinkEventInput): Promise<{ id: string }> {
  const snapshot = sanitizePersonLinkSnapshot(input.snapshot);
  const row = await db.personLinkEvent.create({
    data: {
      personId: input.personId,
      eventKind: input.eventKind,
      entityKind: input.entityKind ?? null,
      entityId: input.entityId ?? null,
      fromPersonId: input.fromPersonId ?? null,
      toPersonId: input.toPersonId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName ?? null,
      reason: input.reason ?? null,
      evidence: input.evidence ?? null,
      snapshot: snapshot === null ? undefined : (snapshot as Prisma.InputJsonValue),
      reversible: input.reversible ?? false,
    },
    select: { id: true },
  });
  return row;
}

export async function listPersonLinkEvents(db: EventDb, personId: string, limit = 50) {
  const rows = await db.personLinkEvent.findMany({
    where: { OR: [{ personId }, { fromPersonId: personId }, { toPersonId: personId }] },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
  });
  // Operações entre duas Pessoas (unificação/reversão) gravam um evento por lado; na ficha, mostra-se um só,
  // preferindo o registro da própria Pessoa (é nele que fica o controle de reversão).
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = [r.eventKind, r.entityKind ?? "", r.entityId ?? "", r.fromPersonId ?? "", r.toPersonId ?? "", r.createdAt.toISOString()].join("|");
    const prev = seen.get(key);
    if (!prev || (prev.personId !== personId && r.personId === personId)) seen.set(key, r);
  }
  return rows.filter((r) => seen.get([r.eventKind, r.entityKind ?? "", r.entityId ?? "", r.fromPersonId ?? "", r.toPersonId ?? "", r.createdAt.toISOString()].join("|")) === r);
}
