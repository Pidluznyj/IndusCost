import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { logFleetCriticalAction } from "@/src/lib/fleetErrors.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import { recalculateVehicleOperationalStatus } from "@/src/lib/fleetVehicleStatusOps.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE,
  FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE,
  type FleetReservationsCleanupCounts,
  type FleetReservationsCleanupPreview,
} from "@/src/lib/fleetReservationsCleanupShared.js";

export {
  FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE,
  FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE,
  type FleetReservationsCleanupCounts,
  type FleetReservationsCleanupPreview,
};

/** Auditoria de reservas/solicitações/uso — removida na limpeza. */
const RESERVATION_RELATED_AUDIT_ENTITY_TYPES = [
  "FleetReservation",
  "FleetPublicReservationRequest",
  "FleetUsage",
  "FleetChecklist",
] as const;

type CleanupClient = Prisma.TransactionClient | typeof prisma;

export function assertFleetReservationsCleanupSuperAdmin(user: AppAuthContext | null): void {
  if (!user) {
    throw new FleetValidationError("Autenticação necessária.");
  }
  if (user.role !== "SUPER_ADMIN") {
    throw new FleetValidationError("Somente SUPER_ADMIN pode executar a limpeza de reservas.");
  }
}

export function assertFleetReservationsCleanupConfirmation(confirmation: unknown): void {
  const text = typeof confirmation === "string" ? confirmation.trim() : "";
  if (text !== FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE) {
    throw new FleetValidationError(
      `Confirmação inválida. Digite exatamente: ${FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE}`
    );
  }
}

async function listReservationLinkedChecklistIds(client: CleanupClient): Promise<string[]> {
  const rows = await client.fleetChecklist.findMany({
    where: {
      OR: [{ reservationId: { not: null } }, { usageId: { not: null } }],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function collectAffectedVehicleIds(client: CleanupClient): Promise<string[]> {
  const fromReservations = await client.fleetReservation.findMany({
    select: { vehicleId: true },
    distinct: ["vehicleId"],
  });
  const fromUsages = await client.fleetUsage.findMany({
    select: { vehicleId: true },
    distinct: ["vehicleId"],
  });
  const fromPublic = await client.fleetPublicReservationRequest.findMany({
    where: { vehicleId: { not: null } },
    select: { vehicleId: true },
    distinct: ["vehicleId"],
  });
  return [
    ...new Set(
      [
        ...fromReservations.map((r) => r.vehicleId),
        ...fromUsages.map((u) => u.vehicleId),
        ...fromPublic.map((p) => p.vehicleId).filter((id): id is string => id != null),
      ]
    ),
  ];
}

export async function previewFleetReservationsCleanup(
  client: CleanupClient = prisma
): Promise<FleetReservationsCleanupPreview> {
  const checklistIds = await listReservationLinkedChecklistIds(client);

  const [
    fleetPublicReservationApprovalHistory,
    fleetPublicReservationRequest,
    fleetChecklistItem,
    fleetChecklist,
    fleetAttachment,
    fleetAuditLog,
    fleetUsage,
    fleetReservation,
    fleetVehicle,
    fleetDriver,
  ] = await Promise.all([
    client.fleetPublicReservationApprovalHistory.count(),
    client.fleetPublicReservationRequest.count(),
    checklistIds.length > 0
      ? client.fleetChecklistItem.count({ where: { checklistId: { in: checklistIds } } })
      : 0,
    checklistIds.length,
    client.fleetAttachment.count({ where: { reservationId: { not: null } } }),
    client.fleetAuditLog.count({
      where: { entityType: { in: [...RESERVATION_RELATED_AUDIT_ENTITY_TYPES] } },
    }),
    client.fleetUsage.count(),
    client.fleetReservation.count(),
    client.fleetVehicle.count(),
    client.fleetDriver.count(),
  ]);

  return {
    fleetPublicReservationApprovalHistory,
    fleetPublicReservationRequest,
    fleetChecklistItem,
    fleetChecklist,
    fleetAttachment,
    fleetAuditLog,
    fleetUsage,
    fleetReservation,
    vehiclesRecalculated: 0,
    preserved: { fleetVehicle, fleetDriver },
    confirmPhraseRequired: FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE,
  };
}

async function deleteReservationDomain(client: CleanupClient): Promise<Omit<FleetReservationsCleanupCounts, "vehiclesRecalculated" | "preserved">> {
  const checklistIds = await listReservationLinkedChecklistIds(client);

  const fleetChecklistItem =
    checklistIds.length > 0
      ? (
          await client.fleetChecklistItem.deleteMany({
            where: { checklistId: { in: checklistIds } },
          })
        ).count
      : 0;

  const fleetChecklist =
    checklistIds.length > 0
      ? (await client.fleetChecklist.deleteMany({ where: { id: { in: checklistIds } } })).count
      : 0;

  const fleetAttachment = (
    await client.fleetAttachment.deleteMany({ where: { reservationId: { not: null } } })
  ).count;

  const fleetAuditLog = (
    await client.fleetAuditLog.deleteMany({
      where: { entityType: { in: [...RESERVATION_RELATED_AUDIT_ENTITY_TYPES] } },
    })
  ).count;

  const fleetPublicReservationApprovalHistory = (
    await client.fleetPublicReservationApprovalHistory.deleteMany({})
  ).count;

  const fleetPublicReservationRequest = (await client.fleetPublicReservationRequest.deleteMany({}))
    .count;

  const fleetUsage = (await client.fleetUsage.deleteMany({})).count;

  const fleetReservation = (await client.fleetReservation.deleteMany({})).count;

  return {
    fleetPublicReservationApprovalHistory,
    fleetPublicReservationRequest,
    fleetChecklistItem,
    fleetChecklist,
    fleetAttachment,
    fleetAuditLog,
    fleetUsage,
    fleetReservation,
  };
}

export async function executeFleetReservationsCleanup(input: {
  userId: string | null;
  userEmail?: string | null;
  confirmation: string;
}): Promise<FleetReservationsCleanupCounts> {
  assertFleetReservationsCleanupConfirmation(input.confirmation);

  const preview = await previewFleetReservationsCleanup();
  const affectedVehicleIds = await collectAffectedVehicleIds(prisma);
  const cleanupRunId = crypto.randomUUID();

  logFleetCriticalAction({
    action: "RESERVATIONS_CLEANUP_START",
    entityType: FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE,
    entityId: cleanupRunId,
    userId: input.userId,
  });

  const deleted = await prisma.$transaction(async (tx) => {
    logFleetCriticalAction({
      action: "RESERVATIONS_CLEANUP_PREVIEW",
      entityType: FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE,
      entityId: cleanupRunId,
      userId: input.userId,
    });
    await tx.fleetAuditLog.create({
      data: {
        entityType: FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE,
        entityId: cleanupRunId,
        action: "PREVIEW",
        newValue: JSON.stringify(preview),
        reason: `Limpeza de reservas iniciada por ${input.userEmail ?? input.userId ?? "desconhecido"}`,
        userId: input.userId,
      },
    });

    const counts = await deleteReservationDomain(tx);

    await tx.fleetAuditLog.create({
      data: {
        entityType: FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE,
        entityId: cleanupRunId,
        action: "DELETED",
        newValue: JSON.stringify(counts),
        userId: input.userId,
      },
    });

    return counts;
  });

  let vehiclesRecalculated = 0;
  for (const vehicleId of affectedVehicleIds) {
    await recalculateVehicleOperationalStatus(vehicleId, {
      userId: input.userId,
      trigger: "RESERVATIONS_CLEANUP",
      reason: "Recálculo após limpeza administrativa de reservas de teste",
    });
    vehiclesRecalculated += 1;
  }

  const preserved = {
    fleetVehicle: preview.preserved.fleetVehicle,
    fleetDriver: preview.preserved.fleetDriver,
  };

  const result: FleetReservationsCleanupCounts = {
    ...deleted,
    vehiclesRecalculated,
    preserved,
  };

  logFleetCriticalAction({
    action: "RESERVATIONS_CLEANUP_DONE",
    entityType: FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE,
    entityId: cleanupRunId,
    userId: input.userId,
  });

  console.info(
    "[fleet:reservations-cleanup]",
    JSON.stringify({
      runId: cleanupRunId,
      userId: input.userId,
      userEmail: input.userEmail ?? null,
      preview,
      deleted,
      vehiclesRecalculated,
      preserved,
    })
  );

  return result;
}
