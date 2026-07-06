import type {
  FleetPublicReservationApprovalAction,
  FleetPublicReservationApprovalStage,
  FleetPublicReservationRequestStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { maskCpfForDisplay } from "@/src/lib/fleetCpfUtils.js";
import { dateOnlyToYmd } from "@/src/lib/fleetPublicReservationSlots.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import { publicCnhStatusLabel } from "@/src/lib/fleetPublicReservationDriverOps.js";

function formatVehicleLabelForHistory(vehicle: {
  brand: string;
  model: string;
  vehicleType: string | null;
}): string {
  const type = vehicle.vehicleType?.trim();
  const base = `${vehicle.brand} ${vehicle.model}`.trim();
  return type ? `${base} (${type})` : base;
}

export type ApprovalHistoryActor = {
  userId: string | null;
  name: string | null;
  email: string | null;
};

export type RecordApprovalHistoryInput = {
  publicReservationRequestId: string;
  action: FleetPublicReservationApprovalAction;
  stage: FleetPublicReservationApprovalStage;
  statusBefore: FleetPublicReservationRequestStatus;
  statusAfter: FleetPublicReservationRequestStatus;
  actor: ApprovalHistoryActor;
  driverId?: string | null;
  vehicleId?: string | null;
  fleetReservationId?: string | null;
  comment?: string | null;
  rejectionReason?: string | null;
  detailsJson?: Prisma.InputJsonValue;
};

const REJECT_ACTIONS: FleetPublicReservationApprovalAction[] = [
  "DRIVER_REJECTED",
  "RESERVATION_REJECTED",
];

export const APPROVAL_ACTION_LABELS: Record<FleetPublicReservationApprovalAction, string> = {
  DRIVER_APPROVED: "Motorista aprovado",
  DRIVER_REJECTED: "Motorista rejeitado",
  RESERVATION_APPROVED: "Reserva aprovada",
  RESERVATION_REJECTED: "Reserva rejeitada",
  RESERVATION_BLOCKED: "Reserva bloqueada",
  STATUS_CHANGED: "Status alterado",
};

export const APPROVAL_STAGE_LABELS: Record<FleetPublicReservationApprovalStage, string> = {
  DRIVER_REGISTRATION: "Cadastro do motorista",
  VEHICLE_RESERVATION: "Reserva do veículo",
  SYSTEM: "Sistema",
};

type RequestSnapshot = {
  publicCode: string;
  requesterCpf: string | null;
  requesterName: string;
  requesterEmail: string | null;
  requesterPhone: string | null;
  requesterDepartment: string | null;
  requestedDate: Date;
  startTime: string;
  endTime: string;
  reason: string;
  destination: string;
  notes: string | null;
  driver: {
    id: string;
    name: string;
    status: string;
    cnhNumber: string | null;
    cnhExpirationDate: Date | null;
  } | null;
  vehicle: {
    id: string;
    brand: string;
    model: string;
    vehicleType: string | null;
    status?: string | null;
  } | null;
};

export function buildPublicReservationHistoryDetails(
  request: RequestSnapshot
): Prisma.InputJsonValue {
  const vehicleLabel = request.vehicle
    ? formatVehicleLabelForHistory(request.vehicle)
    : null;

  return {
    publicCode: request.publicCode,
    requesterCpf: request.requesterCpf ? maskCpfForDisplay(request.requesterCpf) : null,
    requesterName: request.requesterName,
    requesterEmail: request.requesterEmail,
    requesterPhone: request.requesterPhone,
    requesterDepartment: request.requesterDepartment,
    driverName: request.driver?.name ?? null,
    driverStatus: request.driver?.status ?? null,
    cnhStatus: request.driver
      ? publicCnhStatusLabel({
          cnhNumber: request.driver.cnhNumber,
          cnhExpirationDate: request.driver.cnhExpirationDate,
        })
      : null,
    vehicleLabel,
    vehicleStatus: request.vehicle?.status ?? null,
    requestedDate: dateOnlyToYmd(request.requestedDate),
    startTime: request.startTime,
    endTime: request.endTime,
    period: `${request.startTime}–${request.endTime}`,
    reason: request.reason,
    destination: request.destination,
    notes: request.notes,
  };
}

function sanitizeSnapshotText(value: string | null | undefined): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s || null;
}

export async function recordFleetPublicReservationApprovalHistory(
  input: RecordApprovalHistoryInput,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (REJECT_ACTIONS.includes(input.action)) {
    const reason = sanitizeSnapshotText(input.rejectionReason);
    if (!reason) {
      throw new FleetValidationError("Motivo da rejeição é obrigatório para registrar histórico.");
    }
  }

  const client = tx ?? prisma;
  await client.fleetPublicReservationApprovalHistory.create({
    data: {
      publicReservationRequestId: input.publicReservationRequestId,
      action: input.action,
      stage: input.stage,
      statusBefore: input.statusBefore,
      statusAfter: input.statusAfter,
      actorUserId: input.actor.userId,
      actorNameSnapshot: sanitizeSnapshotText(input.actor.name),
      actorEmailSnapshot: sanitizeSnapshotText(input.actor.email),
      driverId: input.driverId ?? null,
      vehicleId: input.vehicleId ?? null,
      fleetReservationId: input.fleetReservationId ?? null,
      comment: sanitizeSnapshotText(input.comment),
      rejectionReason: sanitizeSnapshotText(input.rejectionReason),
      detailsJson: input.detailsJson ?? undefined,
    },
  });
}

export type SerializedApprovalHistoryEntry = {
  id: string;
  action: FleetPublicReservationApprovalAction;
  actionLabel: string;
  stage: FleetPublicReservationApprovalStage;
  stageLabel: string;
  statusBefore: FleetPublicReservationRequestStatus;
  statusAfter: FleetPublicReservationRequestStatus;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  driverId: string | null;
  vehicleId: string | null;
  fleetReservationId: string | null;
  comment: string | null;
  rejectionReason: string | null;
  details: Record<string, unknown> | null;
  summary: string;
  createdAt: string;
  createdAtLabel: string;
};

function formatHistoryDateTime(value: Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actorDisplayName(name: string | null, email: string | null): string {
  if (name?.trim()) return name.trim();
  if (email?.trim()) return email.trim();
  return "Usuário interno";
}

export function buildApprovalHistorySummary(entry: {
  action: FleetPublicReservationApprovalAction;
  actorName: string | null;
  actorEmail: string | null;
  createdAtLabel: string;
  rejectionReason: string | null;
}): string {
  const actor = actorDisplayName(entry.actorName, entry.actorEmail);
  const action = APPROVAL_ACTION_LABELS[entry.action] ?? entry.action;
  const when = entry.createdAtLabel || "";
  const base = `${action} por ${actor}${when ? ` em ${when}` : ""}`;
  if (entry.rejectionReason?.trim()) {
    return `${base} — Motivo: ${entry.rejectionReason.trim()}`;
  }
  return base;
}

function sanitizeDetailsJson(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || Number.isNaN(v as number)) continue;
    out[k] = v === null ? null : v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function serializeApprovalHistoryEntry(row: {
  id: string;
  action: FleetPublicReservationApprovalAction;
  stage: FleetPublicReservationApprovalStage;
  statusBefore: FleetPublicReservationRequestStatus;
  statusAfter: FleetPublicReservationRequestStatus;
  actorUserId: string | null;
  actorNameSnapshot: string | null;
  actorEmailSnapshot: string | null;
  driverId: string | null;
  vehicleId: string | null;
  fleetReservationId: string | null;
  comment: string | null;
  rejectionReason: string | null;
  detailsJson: Prisma.JsonValue | null;
  createdAt: Date;
}): SerializedApprovalHistoryEntry {
  const createdAtLabel = formatHistoryDateTime(row.createdAt);
  const actorName = row.actorNameSnapshot?.trim() || null;
  const actorEmail = row.actorEmailSnapshot?.trim() || null;

  return {
    id: row.id,
    action: row.action,
    actionLabel: APPROVAL_ACTION_LABELS[row.action] ?? row.action,
    stage: row.stage,
    stageLabel: APPROVAL_STAGE_LABELS[row.stage] ?? row.stage,
    statusBefore: row.statusBefore,
    statusAfter: row.statusAfter,
    actorUserId: row.actorUserId,
    actorName,
    actorEmail,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    fleetReservationId: row.fleetReservationId,
    comment: row.comment?.trim() || null,
    rejectionReason: row.rejectionReason?.trim() || null,
    details: sanitizeDetailsJson(row.detailsJson),
    createdAt: row.createdAt.toISOString(),
    createdAtLabel,
    summary: buildApprovalHistorySummary({
      action: row.action,
      actorName,
      actorEmail,
      createdAtLabel,
      rejectionReason: row.rejectionReason,
    }),
  };
}

export async function listPublicReservationApprovalHistory(requestId: string) {
  const rows = await prisma.fleetPublicReservationApprovalHistory.findMany({
    where: { publicReservationRequestId: requestId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(serializeApprovalHistoryEntry);
}
