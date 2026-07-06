import type { FleetChecklistResult, FleetChecklistType, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { FleetSettingsMap } from "@/src/lib/fleetService.js";
import { writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  FleetValidationError,
  assertChecklistItemsComplete,
  hasCriticalNotOk,
} from "@/src/lib/fleetValidation.js";

export const DEFAULT_CHECKOUT_ITEMS: { itemName: string; isCritical: boolean }[] = [
  { itemName: "Documentação do veículo (CRLV, seguro)", isCritical: false },
  { itemName: "Nível de combustível", isCritical: false },
  { itemName: "Pneus e estepe", isCritical: true },
  { itemName: "Luzes e sinalização", isCritical: true },
  { itemName: "Lataria e vidros", isCritical: false },
  { itemName: "Kit emergência", isCritical: false },
];

export const DEFAULT_CHECKIN_ITEMS: { itemName: string; isCritical: boolean }[] = [
  { itemName: "Veículo limpo / conservação", isCritical: false },
  { itemName: "Combustível na devolução", isCritical: false },
  { itemName: "Avarias ou danos visíveis", isCritical: true },
  { itemName: "Funcionamento geral", isCritical: true },
  { itemName: "Documentos e acessórios devolvidos", isCritical: false },
];

const CHECKLIST_INCLUDE = {
  items: { orderBy: { createdAt: "asc" as const } },
  vehicle: { select: { id: true, plate: true, brand: true, model: true } },
  reservation: { select: { id: true, status: true } },
} as const;

export function isChecklistRequired(
  settings: FleetSettingsMap,
  type: FleetChecklistType
): boolean {
  if (type === "CHECKOUT") return settings.checklistRetiradaObrigatorio === "true";
  if (type === "CHECKIN") return settings.checklistDevolucaoObrigatorio === "true";
  return false;
}

export async function getChecklistOrThrow(id: string) {
  const checklist = await prisma.fleetChecklist.findUnique({
    where: { id },
    include: CHECKLIST_INCLUDE,
  });
  if (!checklist) throw new FleetValidationError("Checklist não encontrado.");
  return checklist;
}

export function serializeChecklist(
  checklist: Prisma.FleetChecklistGetPayload<{ include: typeof CHECKLIST_INCLUDE }>
) {
  return {
    ...checklist,
    items: checklist.items.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    })),
    performedAt: checklist.performedAt?.toISOString() ?? null,
    createdAt: checklist.createdAt.toISOString(),
    updatedAt: checklist.updatedAt.toISOString(),
  };
}

export function parseChecklistItemBody(body: Record<string, unknown>) {
  const itemName = typeof body.itemName === "string" ? body.itemName.trim() : "";
  if (!itemName) throw new FleetValidationError("Nome do item é obrigatório.");
  const result = body.result as FleetChecklistResult | null | undefined;
  if (
    result != null &&
    result !== "OK" &&
    result !== "NOT_OK" &&
    result !== "NOT_APPLICABLE"
  ) {
    throw new FleetValidationError("Resultado do item inválido.");
  }
  return {
    itemName,
    isCritical: Boolean(body.isCritical),
    result: result ?? null,
    notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    attachmentUrl:
      typeof body.attachmentUrl === "string" ? body.attachmentUrl.trim() || null : null,
  };
}

export async function assertCompletedChecklistForPhase(input: {
  settings: FleetSettingsMap;
  checklistType: FleetChecklistType;
  reservationId: string;
  checklistId?: string | null;
  blockCriticalOnCheckout?: boolean;
}) {
  if (!isChecklistRequired(input.settings, input.checklistType)) {
    if (input.checklistId) {
      const cl = await getChecklistOrThrow(input.checklistId);
      assertChecklistItemsComplete(cl.items);
      if (input.blockCriticalOnCheckout && hasCriticalNotOk(cl.items)) {
        throw new FleetValidationError("Item crítico não conforme no checklist de retirada.");
      }
    }
    return null;
  }

  let checklist;
  if (input.checklistId) {
    checklist = await getChecklistOrThrow(input.checklistId);
    if (checklist.reservationId && checklist.reservationId !== input.reservationId) {
      throw new FleetValidationError("Checklist não pertence a esta reserva.");
    }
    if (checklist.checklistType !== input.checklistType) {
      throw new FleetValidationError("Tipo de checklist incompatível com a operação.");
    }
  } else {
    checklist = await prisma.fleetChecklist.findFirst({
      where: {
        reservationId: input.reservationId,
        checklistType: input.checklistType,
        status: "COMPLETED",
      },
      include: CHECKLIST_INCLUDE,
      orderBy: { performedAt: "desc" },
    });
    if (!checklist) {
      const label = input.checklistType === "CHECKOUT" ? "retirada" : "devolução";
      throw new FleetValidationError(`Checklist de ${label} obrigatório não encontrado ou incompleto.`);
    }
  }

  if (checklist.status !== "COMPLETED") {
    throw new FleetValidationError("Checklist deve estar concluído antes da operação.");
  }
  assertChecklistItemsComplete(checklist.items);

  if (input.blockCriticalOnCheckout && hasCriticalNotOk(checklist.items)) {
    throw new FleetValidationError("Item crítico não conforme no checklist de retirada.");
  }

  return checklist;
}

export async function completeChecklist(
  checklistId: string,
  performedBy: string | null,
  userId: string | null
) {
  const existing = await getChecklistOrThrow(checklistId);
  assertChecklistItemsComplete(existing.items);
  if (existing.checklistType === "CHECKOUT" && hasCriticalNotOk(existing.items)) {
    throw new FleetValidationError(
      "Item crítico não conforme: corrija ou registre manutenção antes da retirada."
    );
  }

  const updated = await prisma.fleetChecklist.update({
    where: { id: checklistId },
    data: {
      status: "COMPLETED",
      performedAt: new Date(),
      performedBy,
    },
    include: CHECKLIST_INCLUDE,
  });

  await writeFleetAuditLog({
    entityType: "FleetChecklist",
    entityId: checklistId,
    action: "COMPLETE",
    newValue: updated.checklistType,
    userId,
  });

  if (hasCriticalNotOk(existing.items)) {
    await writeFleetAuditLog({
      entityType: "FleetChecklist",
      entityId: checklistId,
      action: "CRITICAL_CHECKLIST",
      reason: "Item crítico marcado como não conforme",
      userId,
    });
  }

  return serializeChecklist(updated);
}

export async function applyCriticalChecklistOnCheckin(input: {
  vehicleId: string;
  reservationId: string;
  checklistId: string | null | undefined;
  userId: string | null;
  currentKm: number;
}): Promise<{ blocked: boolean; maintenanceId?: string }> {
  if (!input.checklistId) return { blocked: false };

  const checklist = await getChecklistOrThrow(input.checklistId);
  if (!hasCriticalNotOk(checklist.items)) return { blocked: false };

  const maintenance = await prisma.fleetMaintenance.create({
    data: {
      vehicleId: input.vehicleId,
      reservationId: input.reservationId,
      maintenanceType: "CORRETIVA",
      description: "Manutenção aberta automaticamente por item crítico não conforme no checklist de devolução.",
      status: "OPEN",
      priority: "ALTA",
      blocksVehicle: true,
      currentKm: input.currentKm,
    },
  });

  await writeFleetAuditLog({
    entityType: "FleetVehicle",
    entityId: input.vehicleId,
    action: "AUTO_BLOCK_CHECKLIST",
    reason: "Item crítico NOT_OK no checklist de devolução",
    newValue: maintenance.id,
    userId: input.userId,
  });

  return { blocked: true, maintenanceId: maintenance.id };
}

export { CHECKLIST_INCLUDE };
