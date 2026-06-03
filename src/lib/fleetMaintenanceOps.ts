import type { FleetMaintenance, FleetMaintenanceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { FleetSettingsMap } from "@/src/lib/fleetService.js";
import { loadFleetSettings, writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  FleetValidationError,
  assertMaintenanceCompletionDate,
  assertMaintenanceEditable,
  assertMaintenanceTransition,
  assertNonNegativeAmount,
  assertReasonRequired,
  maintenanceNeedsApproval,
  parseDecimalKm,
  resolveMaintenanceVehicleStatus,
} from "@/src/lib/fleetValidation.js";

const MAINTENANCE_INCLUDE = {
  vehicle: {
    select: {
      id: true,
      plate: true,
      brand: true,
      model: true,
      status: true,
      currentKm: true,
      costCenter: true,
    },
  },
  reservation: { select: { id: true, status: true } },
  costs: { select: { id: true, amount: true, status: true, costType: true } },
} as const;

export function serializeMaintenance(
  m: Prisma.FleetMaintenanceGetPayload<{ include: typeof MAINTENANCE_INCLUDE }>
) {
  const preventive = parsePreventiveMeta(m.notes);
  return {
    ...m,
    estimatedValue: m.estimatedValue != null ? Number(m.estimatedValue) : null,
    finalValue: m.finalValue != null ? Number(m.finalValue) : null,
    currentKm: m.currentKm != null ? Number(m.currentKm) : null,
    openedAt: m.openedAt.toISOString(),
    scheduledAt: m.scheduledAt?.toISOString() ?? null,
    startedAt: m.startedAt?.toISOString() ?? null,
    completedAt: m.completedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    costs: m.costs.map((c) => ({ ...c, amount: Number(c.amount) })),
    vehicle: m.vehicle
      ? { ...m.vehicle, currentKm: Number(m.vehicle.currentKm) }
      : m.vehicle,
    preventiveMeta: preventive,
  };
}

/** Metadados de preventiva embutidos em notes (preparado para campos dedicados). */
export function parsePreventiveMeta(notes: string | null) {
  if (!notes) return null;
  const match = notes.match(/\[preventiva\]\s*próxima:\s*([^/|]+)(?:\s*\/\s*km:\s*(\d+))?/i);
  if (!match) return null;
  return {
    nextScheduledAt: match[1]?.trim() || null,
    nextMaintenanceKm: match[2] ? Number(match[2]) : null,
  };
}

export function buildPreventiveNotes(
  baseNotes: string | null,
  nextScheduledAt?: string | null,
  nextMaintenanceKm?: number | null
): string | null {
  const parts: string[] = [];
  if (baseNotes?.trim()) parts.push(baseNotes.trim());
  if (nextScheduledAt || nextMaintenanceKm != null) {
    parts.push(
      `[preventiva] próxima: ${nextScheduledAt ?? "—"} / km: ${nextMaintenanceKm ?? "—"}`
    );
  }
  return parts.length ? parts.join("\n") : null;
}

export function buildMaintenanceWhere(query: {
  vehicleId?: string;
  status?: string;
  priority?: string;
  maintenanceType?: string;
  start?: string;
  end?: string;
}): Prisma.FleetMaintenanceWhereInput {
  const where: Prisma.FleetMaintenanceWhereInput = {};
  if (query.vehicleId) where.vehicleId = query.vehicleId;
  if (query.status) where.status = query.status as FleetMaintenanceStatus;
  if (query.priority) where.priority = { equals: query.priority, mode: "insensitive" };
  if (query.maintenanceType) {
    where.maintenanceType = { equals: query.maintenanceType, mode: "insensitive" };
  }
  if (query.start || query.end) {
    const start = query.start ? new Date(query.start) : new Date(0);
    const end = query.end ? new Date(query.end) : new Date("2099-12-31");
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      where.openedAt = { gte: start, lte: end };
    }
  }
  return where;
}

export async function getMaintenanceOrThrow(id: string) {
  const m = await prisma.fleetMaintenance.findUnique({
    where: { id },
    include: MAINTENANCE_INCLUDE,
  });
  if (!m) throw new FleetValidationError("Manutenção não encontrada.");
  return m;
}

export async function hasActiveBlockingMaintenance(
  vehicleId: string,
  excludeId?: string
): Promise<boolean> {
  const row = await prisma.fleetMaintenance.findFirst({
    where: {
      vehicleId,
      id: excludeId ? { not: excludeId } : undefined,
      blocksVehicle: true,
      status: { notIn: ["COMPLETED", "CANCELED"] },
    },
  });
  return Boolean(row);
}

export async function syncVehicleStatusAfterMaintenance(vehicleId: string) {
  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return;
  if (["IN_USE", "SOLD", "RETURNED", "INACTIVE"].includes(vehicle.status)) return;

  const blocking = await prisma.fleetMaintenance.findFirst({
    where: {
      vehicleId,
      blocksVehicle: true,
      status: { notIn: ["COMPLETED", "CANCELED"] },
    },
    orderBy: { openedAt: "desc" },
  });

  if (blocking) {
    const next = resolveMaintenanceVehicleStatus(blocking.priority, true) ?? "MAINTENANCE";
    if (vehicle.status !== next) {
      await prisma.fleetVehicle.update({ where: { id: vehicleId }, data: { status: next } });
    }
    return;
  }

  if (["MAINTENANCE", "BLOCKED"].includes(vehicle.status)) {
    const activeRes = await prisma.fleetReservation.findFirst({
      where: {
        vehicleId,
        status: { in: ["APPROVED", "IN_USE"] },
      },
    });
    if (activeRes?.status === "IN_USE") {
      await prisma.fleetVehicle.update({ where: { id: vehicleId }, data: { status: "IN_USE" } });
    } else if (activeRes) {
      await prisma.fleetVehicle.update({ where: { id: vehicleId }, data: { status: "RESERVED" } });
    } else {
      await prisma.fleetVehicle.update({ where: { id: vehicleId }, data: { status: "AVAILABLE" } });
    }
  }
}

export async function applyVehicleBlockForMaintenance(
  vehicleId: string,
  priority: string,
  blocksVehicle: boolean
) {
  if (!blocksVehicle) return;
  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw new FleetValidationError("Veículo não encontrado.");
  if (vehicle.status === "IN_USE") {
    throw new FleetValidationError("Veículo em uso não pode ser bloqueado para manutenção.");
  }
  const next = resolveMaintenanceVehicleStatus(priority, true);
  if (next) {
    await prisma.fleetVehicle.update({ where: { id: vehicleId }, data: { status: next } });
  }
}

export function parseMaintenanceInput(body: Record<string, unknown>, existing?: FleetMaintenance) {
  const description =
    body.description !== undefined
      ? typeof body.description === "string"
        ? body.description.trim()
        : ""
      : (existing?.description ?? "");
  if (!description) throw new FleetValidationError("Descrição é obrigatória.");

  const estimatedValue =
    body.estimatedValue !== undefined && body.estimatedValue !== ""
      ? Number(body.estimatedValue)
      : undefined;
  const finalValue =
    body.finalValue !== undefined && body.finalValue !== ""
      ? Number(body.finalValue)
      : undefined;
  if (estimatedValue !== undefined && !Number.isNaN(estimatedValue)) {
    assertNonNegativeAmount(estimatedValue, "Valor estimado");
  }
  if (finalValue !== undefined && !Number.isNaN(finalValue)) {
    assertNonNegativeAmount(finalValue, "Valor final");
  }

  const currentKm =
    body.currentKm !== undefined ? parseDecimalKm(body.currentKm) : undefined;

  return {
    description,
    maintenanceType:
      body.maintenanceType !== undefined
        ? String(body.maintenanceType).trim() || "CORRETIVA"
        : undefined,
    priority:
      body.priority !== undefined ? String(body.priority).trim() || "MEDIA" : undefined,
    scheduledAt:
      body.scheduledAt !== undefined
        ? body.scheduledAt
          ? new Date(String(body.scheduledAt))
          : null
        : undefined,
    supplierName:
      body.supplierName !== undefined
        ? typeof body.supplierName === "string"
          ? body.supplierName.trim() || null
          : null
        : undefined,
    estimatedValue: estimatedValue !== undefined && !Number.isNaN(estimatedValue) ? estimatedValue : undefined,
    finalValue: finalValue !== undefined && !Number.isNaN(finalValue) ? finalValue : undefined,
    currentKm: currentKm !== undefined ? currentKm : undefined,
    blocksVehicle: body.blocksVehicle !== undefined ? Boolean(body.blocksVehicle) : undefined,
    notes:
      body.notes !== undefined
        ? typeof body.notes === "string"
          ? body.notes.trim() || null
          : null
        : undefined,
    nextScheduledAt:
      body.nextScheduledAt !== undefined ? String(body.nextScheduledAt ?? "").trim() || null : undefined,
    nextMaintenanceKm:
      body.nextMaintenanceKm !== undefined && body.nextMaintenanceKm !== ""
        ? Number(body.nextMaintenanceKm)
        : undefined,
  };
}

export async function createMaintenance(input: {
  vehicleId: string;
  reservationId?: string | null;
  body: Record<string, unknown>;
  userId: string | null;
}) {
  const data = parseMaintenanceInput(input.body);
  const settings = await loadFleetSettings();
  const approvalThreshold = Number(settings.manutencaoValorAprovacao ?? "5000") || 5000;

  const maintenanceType = data.maintenanceType ?? "CORRETIVA";
  const priority = data.priority ?? (maintenanceType === "PREVENTIVA" ? "BAIXA" : "MEDIA");
  const blocksVehicle = data.blocksVehicle ?? maintenanceType !== "PREVENTIVA";

  let initialStatus: FleetMaintenanceStatus = "OPEN";
  if (data.scheduledAt && maintenanceType === "PREVENTIVA") {
    initialStatus = "SCHEDULED";
  }
  if (maintenanceNeedsApproval(data.estimatedValue ?? null, approvalThreshold)) {
    initialStatus = "PENDING_APPROVAL";
  }

  const notes = buildPreventiveNotes(
    data.notes ?? null,
    data.nextScheduledAt,
    data.nextMaintenanceKm
  );

  const created = await prisma.$transaction(async (tx) => {
    const m = await tx.fleetMaintenance.create({
      data: {
        vehicleId: input.vehicleId,
        reservationId: input.reservationId ?? null,
        maintenanceType,
        status: initialStatus,
        priority,
        description: data.description,
        scheduledAt: data.scheduledAt,
        supplierName: data.supplierName,
        estimatedValue: data.estimatedValue,
        currentKm: data.currentKm,
        blocksVehicle,
        notes,
      },
      include: MAINTENANCE_INCLUDE,
    });
    if (blocksVehicle) {
      const vehicle = await tx.fleetVehicle.findUnique({ where: { id: input.vehicleId } });
      if (vehicle?.status === "IN_USE") {
        throw new FleetValidationError("Veículo em uso não pode ser bloqueado para manutenção.");
      }
      const st = resolveMaintenanceVehicleStatus(priority, true);
      if (st) await tx.fleetVehicle.update({ where: { id: input.vehicleId }, data: { status: st } });
    }
    return m;
  });

  await writeFleetAuditLog({
    entityType: "FleetMaintenance",
    entityId: created.id,
    action: "OPEN",
    newValue: initialStatus,
    userId: input.userId,
  });

  return serializeMaintenance(created);
}

export async function updateMaintenance(
  id: string,
  body: Record<string, unknown>,
  userId: string | null
) {
  const existing = await getMaintenanceOrThrow(id);
  assertMaintenanceEditable(existing.status);
  const data = parseMaintenanceInput(body, existing);

  const notes =
    data.nextScheduledAt !== undefined || data.nextMaintenanceKm !== undefined
      ? buildPreventiveNotes(
          data.notes ?? existing.notes,
          data.nextScheduledAt,
          data.nextMaintenanceKm
        )
      : data.notes;

  const updated = await prisma.fleetMaintenance.update({
    where: { id },
    data: {
      description: data.description,
      maintenanceType: data.maintenanceType,
      priority: data.priority,
      scheduledAt: data.scheduledAt,
      supplierName: data.supplierName,
      estimatedValue: data.estimatedValue,
      finalValue: data.finalValue,
      currentKm: data.currentKm,
      blocksVehicle: data.blocksVehicle,
      notes,
    },
    include: MAINTENANCE_INCLUDE,
  });

  if (data.blocksVehicle === true && !existing.blocksVehicle) {
    await applyVehicleBlockForMaintenance(
      existing.vehicleId,
      updated.priority,
      true
    );
  } else if (data.blocksVehicle === false && existing.blocksVehicle) {
    await syncVehicleStatusAfterMaintenance(existing.vehicleId);
  }

  await writeFleetAuditLog({
    entityType: "FleetMaintenance",
    entityId: id,
    action: "UPDATE",
    userId,
  });

  return serializeMaintenance(updated);
}

export async function changeMaintenanceStatus(
  id: string,
  status: FleetMaintenanceStatus,
  userId: string | null,
  reason?: string | null
) {
  const existing = await getMaintenanceOrThrow(id);
  assertMaintenanceEditable(existing.status);
  assertMaintenanceTransition(existing.status, status);

  const updated = await prisma.fleetMaintenance.update({
    where: { id },
    data: { status },
    include: MAINTENANCE_INCLUDE,
  });

  await writeFleetAuditLog({
    entityType: "FleetMaintenance",
    entityId: id,
    action: "STATUS",
    oldValue: existing.status,
    newValue: status,
    reason: reason ?? null,
    userId,
  });

  return serializeMaintenance(updated);
}

export async function approveMaintenance(
  id: string,
  userLabel: string | null,
  userId: string | null
) {
  const existing = await getMaintenanceOrThrow(id);
  if (existing.status !== "PENDING_APPROVAL") {
    throw new FleetValidationError("Manutenção não está aguardando aprovação.");
  }

  const updated = await prisma.fleetMaintenance.update({
    where: { id },
    data: { status: "APPROVED" },
    include: MAINTENANCE_INCLUDE,
  });

  await writeFleetAuditLog({
    entityType: "FleetMaintenance",
    entityId: id,
    action: "APPROVE",
    newValue: JSON.stringify({
      approvedBy: userLabel,
      approvedAt: new Date().toISOString(),
    }),
    userId,
  });

  return serializeMaintenance(updated);
}

export async function startMaintenance(id: string, userId: string | null) {
  const existing = await getMaintenanceOrThrow(id);
  if (!["APPROVED", "SCHEDULED", "OPEN"].includes(existing.status)) {
    throw new FleetValidationError("Somente manutenção aprovada ou agendada pode ser iniciada.");
  }
  const settings = await loadFleetSettings();
  const threshold = Number(settings.manutencaoValorAprovacao ?? "5000") || 5000;
  if (
    existing.status === "OPEN" &&
    maintenanceNeedsApproval(
      existing.estimatedValue != null ? Number(existing.estimatedValue) : null,
      threshold
    )
  ) {
    throw new FleetValidationError("Manutenção requer aprovação antes de iniciar execução.");
  }
  if (existing.status === "OPEN") {
    assertMaintenanceTransition("OPEN", "IN_PROGRESS");
  } else {
    assertMaintenanceTransition(existing.status, "IN_PROGRESS");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const m = await tx.fleetMaintenance.update({
      where: { id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
      include: MAINTENANCE_INCLUDE,
    });
    if (existing.blocksVehicle) {
      const st = resolveMaintenanceVehicleStatus(existing.priority, true);
      if (st) {
        await tx.fleetVehicle.update({
          where: { id: existing.vehicleId },
          data: { status: st },
        });
      }
    }
    return m;
  });

  await writeFleetAuditLog({
    entityType: "FleetMaintenance",
    entityId: id,
    action: "START",
    userId,
  });

  return serializeMaintenance(updated);
}

export async function completeMaintenance(
  id: string,
  body: Record<string, unknown>,
  userId: string | null
) {
  const existing = await getMaintenanceOrThrow(id);
  if (existing.status !== "IN_PROGRESS" && existing.status !== "APPROVED") {
    throw new FleetValidationError("Manutenção precisa estar em execução para concluir.");
  }

  const completedAtRaw = body.completedAt;
  const completedAt = completedAtRaw ? new Date(String(completedAtRaw)) : new Date();
  if (Number.isNaN(completedAt.getTime())) {
    throw new FleetValidationError("Data de conclusão inválida.");
  }
  assertMaintenanceCompletionDate(existing.openedAt, completedAt);

  const finalValue =
    body.finalValue != null && body.finalValue !== ""
      ? Number(body.finalValue)
      : existing.finalValue != null
        ? Number(existing.finalValue)
        : null;
  if (finalValue != null) assertNonNegativeAmount(finalValue, "Valor final");

  const currentKm =
    body.currentKm != null ? parseDecimalKm(body.currentKm) : existing.currentKm;
  const serviceDone =
    typeof body.servicePerformed === "string"
      ? body.servicePerformed.trim()
      : typeof body.description === "string"
        ? body.description.trim()
        : existing.description;
  const notes =
    typeof body.notes === "string"
      ? body.notes.trim() || existing.notes
      : existing.notes;
  const releaseVehicle = body.releaseVehicle !== false;
  const generateCost = body.generateCost !== false && (finalValue ?? 0) > 0;

  const updated = await prisma.$transaction(async (tx) => {
    const m = await tx.fleetMaintenance.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt,
        description: serviceDone,
        finalValue,
        currentKm: currentKm ?? undefined,
        notes,
      },
      include: MAINTENANCE_INCLUDE,
    });

    if (currentKm != null) {
      await tx.fleetVehicle.update({
        where: { id: existing.vehicleId },
        data: { currentKm },
      });
    }

    let costId: string | null = null;
    if (generateCost && finalValue != null && finalValue > 0) {
      const existingCost = await tx.fleetCost.findFirst({
        where: { maintenanceId: id, status: "ACTIVE" },
      });
      if (!existingCost) {
        const comp = `${completedAt.getFullYear()}-${String(completedAt.getMonth() + 1).padStart(2, "0")}`;
        const cost = await tx.fleetCost.create({
          data: {
            vehicleId: existing.vehicleId,
            maintenanceId: id,
            costType: "MANUTENCAO",
            costDate: completedAt,
            competence: comp,
            amount: finalValue,
            supplierName: m.supplierName,
            costCenter: m.vehicle.costCenter,
            notes: `Custo gerado da manutenção ${id}`,
          },
        });
        costId = cost.id;
      }
    }

    if (releaseVehicle) {
      await syncVehicleStatusAfterMaintenance(existing.vehicleId);
    }

    return { maintenance: m, costId };
  });

  await writeFleetAuditLog({
    entityType: "FleetMaintenance",
    entityId: id,
    action: "COMPLETE",
    newValue: completedAt.toISOString(),
    userId,
  });
  if (updated.costId) {
    await writeFleetAuditLog({
      entityType: "FleetCost",
      entityId: updated.costId,
      action: "CREATE_FROM_MAINTENANCE",
      newValue: String(finalValue),
      userId,
    });
  }

  return { maintenance: serializeMaintenance(updated.maintenance), costId: updated.costId };
}

export async function cancelMaintenance(
  id: string,
  reason: string,
  userId: string | null
) {
  const existing = await getMaintenanceOrThrow(id);
  assertMaintenanceEditable(existing.status);
  const r = assertReasonRequired(reason, "Motivo do cancelamento");

  const updated = await prisma.fleetMaintenance.update({
    where: { id },
    data: {
      status: "CANCELED",
      notes: existing.notes
        ? `${existing.notes}\n[cancelado] ${r}`
        : `[cancelado] ${r}`,
    },
    include: MAINTENANCE_INCLUDE,
  });

  await syncVehicleStatusAfterMaintenance(existing.vehicleId);

  await writeFleetAuditLog({
    entityType: "FleetMaintenance",
    entityId: id,
    action: "CANCEL",
    oldValue: existing.status,
    newValue: "CANCELED",
    reason: r,
    userId,
  });

  return serializeMaintenance(updated);
}

export async function generateMaintenanceCost(id: string, userId: string | null) {
  const m = await getMaintenanceOrThrow(id);
  if (m.status !== "COMPLETED") {
    throw new FleetValidationError("Somente manutenção concluída pode gerar custo.");
  }
  const amount = m.finalValue != null ? Number(m.finalValue) : 0;
  if (amount <= 0) throw new FleetValidationError("Valor final deve ser maior que zero.");

  const existing = await prisma.fleetCost.findFirst({
    where: { maintenanceId: id, status: "ACTIVE" },
  });
  if (existing) throw new FleetValidationError("Custo já vinculado a esta manutenção.");

  const completedAt = m.completedAt ?? new Date();
  const comp = `${completedAt.getFullYear()}-${String(completedAt.getMonth() + 1).padStart(2, "0")}`;
  const cost = await prisma.fleetCost.create({
    data: {
      vehicleId: m.vehicleId,
      maintenanceId: id,
      costType: "MANUTENCAO",
      costDate: completedAt,
      competence: comp,
      amount,
      supplierName: m.supplierName,
      costCenter: m.vehicle.costCenter,
    },
  });

  await writeFleetAuditLog({
    entityType: "FleetCost",
    entityId: cost.id,
    action: "CREATE_FROM_MAINTENANCE",
    newValue: String(amount),
    userId,
  });

  return { cost: { ...cost, amount: Number(cost.amount) } };
}

export async function buildMaintenanceDashboardAlerts() {
  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 7);

  const [overdue, upcoming, openList] = await Promise.all([
    prisma.fleetMaintenance.findMany({
      where: {
        maintenanceType: { equals: "PREVENTIVA", mode: "insensitive" },
        status: { in: ["SCHEDULED", "OPEN"] },
        scheduledAt: { lt: now },
      },
      include: { vehicle: { select: { plate: true, brand: true, model: true } } },
      take: 10,
    }),
    prisma.fleetMaintenance.findMany({
      where: {
        maintenanceType: { equals: "PREVENTIVA", mode: "insensitive" },
        status: { in: ["SCHEDULED", "OPEN"] },
        scheduledAt: { gte: now, lte: soon },
      },
      include: { vehicle: { select: { plate: true, brand: true, model: true } } },
      take: 10,
    }),
    prisma.fleetMaintenance.findMany({
      where: { status: { notIn: ["COMPLETED", "CANCELED"] } },
      include: { vehicle: { select: { plate: true, brand: true, model: true } } },
      orderBy: { openedAt: "desc" },
      take: 5,
    }),
  ]);

  const alerts: { level: "critical" | "warning"; message: string; entityType?: string; entityId?: string }[] =
    [];

  for (const m of overdue) {
    alerts.push({
      level: "critical",
      message: `Preventiva vencida: ${m.vehicle.plate ?? m.vehicle.brand} — ${m.description}`,
      entityType: "FleetMaintenance",
      entityId: m.id,
    });
  }
  for (const m of upcoming) {
    alerts.push({
      level: "warning",
      message: `Preventiva próxima: ${m.vehicle.plate ?? m.vehicle.brand} — ${m.description}`,
      entityType: "FleetMaintenance",
      entityId: m.id,
    });
  }

  return { overdue, upcoming, openList, alerts };
}

export { MAINTENANCE_INCLUDE };
