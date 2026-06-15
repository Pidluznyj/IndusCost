/**
 * Regras de follow-up de pedidos em carteira (CommercialActivity.salesOrderId + fallback por cliente).
 */

import { Prisma } from "@prisma/client";

export type OrderFollowUpActivity = {
  contactDate: Date | null;
  createdAt: Date;
  salesOrderId?: string | null;
};

export function activityEffectiveMs(a: OrderFollowUpActivity): number {
  const d = a.contactDate ?? a.createdAt;
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

export function orderFollowUpCutoffMs(updatedAt: Date | null | undefined, issueDate: Date): number {
  const u = updatedAt?.getTime();
  if (u != null && Number.isFinite(u)) return u;
  const i = issueDate.getTime();
  return Number.isFinite(i) ? i : 0;
}

/**
 * Pedido tem follow-up quando:
 * 1) existe atividade com salesOrderId = pedido após cutoff; ou
 * 2) fallback: atividade do cliente sem salesOrderId após cutoff.
 */
export function orderHasFollowUpAfterCutoff(
  orderId: string,
  orderCutoff: Date,
  activities: OrderFollowUpActivity[]
): boolean {
  const cutoff = orderCutoff.getTime();

  for (const a of activities) {
    if (a.salesOrderId === orderId && activityEffectiveMs(a) >= cutoff) {
      return true;
    }
  }

  for (const a of activities) {
    if (!a.salesOrderId && activityEffectiveMs(a) >= cutoff) {
      return true;
    }
  }

  return false;
}

/** SQL: pedido tem follow-up (vínculo direto tem prioridade; fallback por cliente sem salesOrderId). */
export function crmOrderHasFollowUpExistsSql(alias: string) {
  return Prisma.sql`
    (
      EXISTS (
        SELECT 1
        FROM "CommercialActivity" a
        WHERE a."salesOrderId" = ${Prisma.raw(`${alias}.id`)}
          AND COALESCE(a."contactDate", a."createdAt") >= COALESCE(
            ${Prisma.raw(`${alias}."updatedAt"`)},
            ${Prisma.raw(`${alias}."issueDate"`)}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM "CommercialActivity" a
        WHERE a."customerId" = ${Prisma.raw(`${alias}."customerId"`)}
          AND a."salesOrderId" IS NULL
          AND COALESCE(a."contactDate", a."createdAt") >= COALESCE(
            ${Prisma.raw(`${alias}."updatedAt"`)},
            ${Prisma.raw(`${alias}."issueDate"`)}
          )
      )
    )
  `;
}
