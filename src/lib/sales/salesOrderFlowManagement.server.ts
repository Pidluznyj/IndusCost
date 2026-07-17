/**
 * OP-62 — Persistência das ações manuais do overlay de gestão.
 * Transação + CAS em updatedAt + evento append-only + CommercialAuditLog.
 * Não altera currentStage / snapshots / SalesOrder oficial / Nomus.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  appendSalesOrderFlowEvent,
  findSalesOrderFlowManagementByOrderId,
} from "./salesOrderFlowRepository.server.js";
import {
  applySalesOrderFlowManagementPatch,
  auditActionForField,
  defaultSalesOrderFlowManagementSnapshot,
  fieldValueForAudit,
  listChangedManagementFields,
  parseSalesOrderFlowManagementPatch,
  sanitizeManagementAuditSnapshot,
  serializeManagementForApi,
  SALES_ORDER_FLOW_MANAGEMENT_ENTITY,
  SALES_ORDER_FLOW_MANAGEMENT_EVENT_TYPE,
  SalesOrderFlowManagementError,
  type SalesOrderFlowManagementApi,
  type SalesOrderFlowManagementSnapshot,
} from "./salesOrderFlowManagement.js";
import {
  assertSalesOrderFlowDetailId,
  SalesOrderFlowDetailQueryError,
} from "./salesOrderFlowDetail.js";

export type SalesOrderFlowManagementDb = Pick<
  PrismaClient,
  | "salesOrder"
  | "salesOrderFlowManagement"
  | "salesOrderFlowEvent"
  | "appUser"
  | "commercialAuditLog"
> & {
  $transaction: PrismaClient["$transaction"];
};

export type ApplySalesOrderFlowManagementInput = {
  prisma: SalesOrderFlowManagementDb;
  salesOrderId: string;
  body: unknown;
  actor: { id: string; name: string };
  scopeCustomerIds?: string[] | null;
};

export type ApplySalesOrderFlowManagementResult =
  | {
      ok: true;
      payload: {
        salesOrderId: string;
        management: SalesOrderFlowManagementApi;
        changedFields: string[];
        eventId: string;
      };
    }
  | {
      ok: false;
      status: number;
      body: { error: string; code?: string; field?: string };
    };

function rowToSnapshot(
  row: NonNullable<
    Awaited<ReturnType<typeof findSalesOrderFlowManagementByOrderId>>
  >
): SalesOrderFlowManagementSnapshot {
  return {
    priority: row.priority,
    responsibleUserId: row.responsibleUserId,
    responsibleName: row.responsibleName,
    responsibleArea: row.responsibleArea,
    isBlocked: row.isBlocked,
    blockReason: row.blockReason,
    reason: row.reason,
    expectedResolutionAt: row.expectedResolutionAt,
    internalNote: row.internalNote,
    updatedAt: row.updatedAt,
  };
}

function toWriteData(next: SalesOrderFlowManagementSnapshot) {
  return {
    priority: next.priority,
    responsibleUserId: next.responsibleUserId,
    responsibleName: next.responsibleName,
    responsibleArea: next.responsibleArea,
    isBlocked: next.isBlocked,
    blockReason: next.blockReason,
    reason: next.reason,
    expectedResolutionAt: next.expectedResolutionAt,
    internalNote: next.internalNote,
  };
}

async function resolveResponsibleName(
  prisma: SalesOrderFlowManagementDb,
  responsibleUserId: string
): Promise<string> {
  const user = await prisma.appUser.findUnique({
    where: { id: responsibleUserId },
    select: {
      id: true,
      name: true,
      isActive: true,
      person: { select: { displayName: true, socialName: true } },
      employee: { select: { name: true, socialName: true } },
    },
  });

  if (!user) {
    throw new SalesOrderFlowManagementError(
      "Responsável inválido: AppUser não encontrado.",
      { code: "INVALID_RESPONSIBLE", status: 400, field: "responsibleUserId" }
    );
  }
  if (!user.isActive) {
    throw new SalesOrderFlowManagementError(
      "Responsável inválido: AppUser inativo.",
      { code: "INVALID_RESPONSIBLE", status: 400, field: "responsibleUserId" }
    );
  }

  const fromPerson =
    user.person?.socialName?.trim() || user.person?.displayName?.trim();
  const fromEmployee =
    user.employee?.socialName?.trim() || user.employee?.name?.trim();
  return fromPerson || fromEmployee || user.name;
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function applySalesOrderFlowManagement(
  input: ApplySalesOrderFlowManagementInput
): Promise<ApplySalesOrderFlowManagementResult> {
  try {
    const salesOrderId = assertSalesOrderFlowDetailId(input.salesOrderId);
    const patch = parseSalesOrderFlowManagementPatch(input.body);

    const orderMeta = await input.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: { id: true, customerId: true },
    });
    if (!orderMeta) {
      return {
        ok: false,
        status: 404,
        body: {
          error: "Pedido não encontrado.",
          code: "SALES_ORDER_NOT_FOUND",
        },
      };
    }

    if (
      input.scopeCustomerIds &&
      !input.scopeCustomerIds.includes(orderMeta.customerId)
    ) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "Pedido fora da sua carteira comercial.",
          code: "SALES_ORDER_FLOW_SCOPE_DENIED",
        },
      };
    }

    const existing = await findSalesOrderFlowManagementByOrderId(
      input.prisma,
      salesOrderId
    );
    const before = existing
      ? rowToSnapshot(existing)
      : defaultSalesOrderFlowManagementSnapshot();

    if (existing) {
      if (patch.expectedUpdatedAt == null) {
        throw new SalesOrderFlowManagementError(
          "expectedUpdatedAt é obrigatório para atualizar o overlay existente.",
          { code: "VALIDATION", status: 400, field: "expectedUpdatedAt" }
        );
      }
      if (
        before.updatedAt &&
        patch.expectedUpdatedAt.getTime() !== before.updatedAt.getTime()
      ) {
        return {
          ok: false,
          status: 409,
          body: {
            error: "Overlay de gestão foi alterado por outro usuário.",
            code: "MANAGEMENT_UPDATE_CONFLICT",
          },
        };
      }
    } else if (patch.expectedUpdatedAt != null) {
      throw new SalesOrderFlowManagementError(
        "expectedUpdatedAt deve ser null na primeira criação do overlay.",
        { code: "VALIDATION", status: 400, field: "expectedUpdatedAt" }
      );
    }

    let derivedName: string | null | undefined;
    if (patch.responsibleUserId) {
      derivedName = await resolveResponsibleName(
        input.prisma,
        patch.responsibleUserId
      );
    } else if (patch.responsibleUserId === null) {
      derivedName = null;
    }

    const next = applySalesOrderFlowManagementPatch(
      before,
      patch,
      derivedName
    );
    const changedFields = listChangedManagementFields(before, next);
    if (changedFields.length === 0) {
      return {
        ok: true,
        payload: {
          salesOrderId,
          management: serializeManagementForApi(before),
          changedFields: [],
          eventId: "",
        },
      };
    }

    const writeData = toWriteData(next);
    const occurredAt = new Date();

    const result = await input.prisma.$transaction(async (tx) => {
      let afterRow: Awaited<
        ReturnType<typeof findSalesOrderFlowManagementByOrderId>
      >;

      if (!existing) {
        try {
          afterRow = await tx.salesOrderFlowManagement.create({
            data: {
              salesOrderId,
              ...writeData,
            },
          });
        } catch (error) {
          if (isPrismaUniqueViolation(error)) {
            throw new SalesOrderFlowManagementError(
              "Overlay de gestão foi criado concorrentemente.",
              { code: "MANAGEMENT_UPDATE_CONFLICT", status: 409 }
            );
          }
          throw error;
        }
      } else {
        const updated = await tx.salesOrderFlowManagement.updateMany({
          where: {
            salesOrderId,
            updatedAt: patch.expectedUpdatedAt!,
          },
          data: writeData as Prisma.SalesOrderFlowManagementUpdateManyMutationInput,
        });
        if (updated.count !== 1) {
          throw new SalesOrderFlowManagementError(
            "Overlay de gestão foi alterado por outro usuário.",
            { code: "MANAGEMENT_UPDATE_CONFLICT", status: 409 }
          );
        }
        afterRow = await tx.salesOrderFlowManagement.findUnique({
          where: { salesOrderId },
        });
        if (!afterRow) {
          throw new SalesOrderFlowManagementError(
            "Overlay de gestão desapareceu durante a atualização.",
            { code: "MANAGEMENT_UPDATE_CONFLICT", status: 409 }
          );
        }
      }

      const after = rowToSnapshot(afterRow);
      const dedupeKey = `management:${salesOrderId}:${after.updatedAt!.toISOString()}:${input.actor.id}`;

      const event = await appendSalesOrderFlowEvent(tx, {
        salesOrderId,
        eventType: SALES_ORDER_FLOW_MANAGEMENT_EVENT_TYPE,
        dedupeKey,
        actorId: input.actor.id,
        occurredAt,
        observedAt: occurredAt,
        detailsJson: {
          changedFields,
          before: sanitizeManagementAuditSnapshot(before),
          after: sanitizeManagementAuditSnapshot(after),
          actorName: input.actor.name,
        },
      });

      const auditFields = changedFields.filter(
        (field) => field !== "responsibleName" || !changedFields.includes("responsibleUserId")
      );

      for (const field of auditFields) {
        await tx.commercialAuditLog.create({
          data: {
            entityType: SALES_ORDER_FLOW_MANAGEMENT_ENTITY,
            entityId: salesOrderId,
            action:
              field === "isBlocked"
                ? after.isBlocked
                  ? "REGISTER_BLOCK"
                  : "REMOVE_BLOCK"
                : auditActionForField(field),
            fieldName: field,
            oldValue: fieldValueForAudit(field, before),
            newValue: fieldValueForAudit(field, after),
            performedBy: input.actor.name,
            performedAt: occurredAt,
          },
        });
      }

      return { after, eventId: event.id };
    });

    return {
      ok: true,
      payload: {
        salesOrderId,
        management: serializeManagementForApi(result.after),
        changedFields,
        eventId: result.eventId,
      },
    };
  } catch (error) {
    if (error instanceof SalesOrderFlowManagementError) {
      return {
        ok: false,
        status: error.status,
        body: {
          error: error.message,
          code: error.code,
          ...(error.field ? { field: error.field } : {}),
        },
      };
    }
    if (error instanceof SalesOrderFlowDetailQueryError) {
      return {
        ok: false,
        status: 400,
        body: { error: error.message, code: "VALIDATION" },
      };
    }
    throw error;
  }
}
