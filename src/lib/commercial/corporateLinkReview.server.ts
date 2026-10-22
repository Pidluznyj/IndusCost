/**
 * Grava a decisão humana do vínculo. Não apaga histórico e não altera cadastro Nomus.
 * As duas pontas recebem o mesmo estado para o grupo enxergar o vínculo.
 */

import { assessCorporateLinkReview, type CorporateLinkAction } from "./corporateLinkReview.js";

type LinkRow = { id: string; status: string };

export type CorporateLinkReviewStore = {
  customerCorporateLink: {
    upsert(args: {
      where: { customerId_relatedCustomerId: { customerId: string; relatedCustomerId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<LinkRow>;
  };
};

export async function applyCorporateLinkReview(
  db: CorporateLinkReviewStore,
  input: {
    actor: { id: string; role: string; assignedPermissions: readonly string[] };
    subjectCustomerId: string;
    relatedCustomerId: string;
    action: string;
    justification: string;
    evidenceFingerprint?: string | null;
    now?: Date;
  },
  audit?: (entry: {
    entityType: string;
    entityId: string;
    action: string;
    newValue?: string | null;
    performedBy?: string | null;
  }) => Promise<void>
): Promise<{ ok: true; status: string } | { ok: false; code: string; message: string }> {
  const assessed = assessCorporateLinkReview(input);
  if (!assessed.ok) return assessed;
  const now = input.now ?? new Date();
  const status = assessed.action === "confirm" ? "CONFIRMED" : assessed.action === "reject" ? "REJECTED" : "CLOSED";
  const fingerprint = assessed.action === "reject" ? input.evidenceFingerprint ?? null : null;
  const payload = {
    status,
    evidenceKind: assessed.action === "confirm" ? "MANUAL" : assessed.action === "reject" ? "REJECTED_CANDIDATE" : "CLOSED",
    justification: assessed.justification,
    actorUserId: input.actor.id,
    evidenceFingerprint: fingerprint,
    closedAt: assessed.action === "close" ? now : null,
  };
  const pairs: Array<[string, string]> = [
    [input.subjectCustomerId, input.relatedCustomerId],
    [input.relatedCustomerId, input.subjectCustomerId],
  ];
  let written: LinkRow | null = null;
  for (const [customerId, relatedCustomerId] of pairs) {
    written = await db.customerCorporateLink.upsert({
      where: { customerId_relatedCustomerId: { customerId, relatedCustomerId } },
      create: { customerId, relatedCustomerId, ...payload },
      update: payload,
    });
    if (audit && written) {
      await audit({
        entityType: "CustomerCorporateLink",
        entityId: written.id,
        action: `CORPORATE_LINK_${assessed.action.toUpperCase()}`,
        newValue: status,
        performedBy: input.actor.id,
      });
    }
  }
  return { ok: true, status };
}

export function corporateLinkActionStatus(action: CorporateLinkAction): string {
  if (action === "confirm") return "CONFIRMED";
  if (action === "reject") return "REJECTED";
  return "CLOSED";
}
