/**
 * FIN-10 — loader Prisma / Auditoria 360° read-only para agenda efetiva.
 * Sem writes, sem chamada Nomus HTTP.
 */

import type { PrismaClient } from "@prisma/client";
import { getOrderFullAudit } from "./orderFullAuditService.js";
import {
  buildEffectiveScheduleConsumerAlerts,
  projectEffectiveScheduleForOrderAudit,
} from "./effectiveScheduleAuditProjection.js";
import {
  buildEffectiveSalesOrderScheduleAuditReport,
  salesOrderAuditCodeCandidates,
  type EffectiveSalesOrderScheduleAuditReport,
} from "./effectiveSalesOrderScheduleAudit.js";

export async function loadEffectiveSalesOrderScheduleAudit(
  prisma: PrismaClient,
  requestedOrder: string,
  referenceDate: Date = new Date()
): Promise<EffectiveSalesOrderScheduleAuditReport> {
  const candidates = salesOrderAuditCodeCandidates(requestedOrder);
  const order = await prisma.salesOrder.findFirst({
    where: {
      OR: candidates.flatMap((code) => [
        { orderCode: { equals: code, mode: "insensitive" as const } },
        { externalSalesOrderCode: { equals: code, mode: "insensitive" as const } },
      ]),
    },
    select: {
      id: true,
      orderCode: true,
    },
  });

  if (!order) {
    return buildEffectiveSalesOrderScheduleAuditReport({
      requestedOrder,
      audit: null,
      projection: null,
      generatedAt: referenceDate,
    });
  }

  const audit = await getOrderFullAudit({
    salesOrderId: order.id,
    orderCode: order.orderCode,
  });

  if (!("ok" in audit) || audit.ok !== true) {
    throw new Error(
      `Falha ao carregar Auditoria 360° do pedido ${order.orderCode}: ${
        "error" in audit ? String((audit as { error?: string }).error) : "desconhecido"
      }`
    );
  }

  const projection = projectEffectiveScheduleForOrderAudit({
    salesOrderId: audit.salesOrderId,
    orderCode: audit.orderCode ?? order.orderCode,
    issueDate: audit.salesOrder.issueDate
      ? new Date(audit.salesOrder.issueDate)
      : null,
    paymentTerms: audit.salesOrder.paymentTerms,
    paymentMethod: audit.salesOrder.paymentMethod,
    nomusRawResponse: null,
    totalActiveValue: audit.summary?.activeOrderValue ?? 0,
    items: audit.items,
    receivables: audit.receivables,
    stockDocuments: audit.stockDocuments,
    nfeNumbers: (audit.nfes ?? [])
      .map((n) => n.numero)
      .filter((n): n is string => Boolean(n?.trim())),
    referenceDate,
  });

  // Enriquecer consumerAlerts no report via buildEffectiveScheduleConsumerAlerts
  const report = buildEffectiveSalesOrderScheduleAuditReport({
    requestedOrder,
    audit,
    projection,
    generatedAt: referenceDate,
  });

  const consumer = buildEffectiveScheduleConsumerAlerts({
    schedule: projection.schedule,
    plannedReceivables: projection.plannedReceivables,
  });

  return {
    ...report,
    consumerAlerts: consumer.map((a) => ({
      code: a.code,
      severity: a.severity,
      title: a.title,
      description: a.description,
    })),
  };
}
