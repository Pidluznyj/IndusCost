/**
 * FASE 2C — administração do Device Registry do Stock Collector (server-only).
 *
 * Toda mutação passa pelo fluxo HUMANO autenticado: quem cadastra, ativa e
 * desativa dispositivo é um supervisor de inventário (mesma permissão que
 * aprova conferências — dispositivo autorizado é decisão do mesmo nível).
 *
 * Revogação é soft (active=false, disabledAt/disabledByUserId): o dispositivo
 * perde acesso imediatamente e o histórico permanece. Não existe delete físico
 * no fluxo normal. Auditoria na MESMA transação da mutação — evento de algo
 * que sofreu rollback não pode existir.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeInventoryAuditLogInTx } from "../inventoryAudit.server.js";
import { canApproveInventoryCount } from "../inventoryPermissionChecks.js";
import { InventoryValidationError } from "../inventoryTypes.js";
import { isPlausibleStableNodeId } from "./tailscaleIdentity.js";

export const COLLECTOR_DEVICE_DUPLICATE = "COLLECTOR_DEVICE_DUPLICATE";
export const COLLECTOR_DEVICE_NOT_FOUND = "COLLECTOR_DEVICE_NOT_FOUND";

export type CollectorAdminContext = {
  userId: string;
  permissions?: readonly string[];
};

function assertCanAdministerDevices(context: CollectorAdminContext): void {
  if (canApproveInventoryCount(context.permissions ?? [])) return;
  throw new InventoryValidationError(
    "Sem permissão para administrar dispositivos do Collector.",
    "NOT_AUTHORIZED"
  );
}

export type RegisterCollectorDeviceInput = {
  name: string;
  tailscaleStableNodeId: string;
  tailscaleNodeName?: string | null;
  tailscaleLoginName?: string | null;
};

export function parseRegisterCollectorDeviceBody(body: unknown): RegisterCollectorDeviceInput {
  const data = (body ?? {}) as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) {
    throw new InventoryValidationError("Nome do dispositivo é obrigatório.", "FIELD_REQUIRED");
  }
  const stableRaw = data.tailscaleStableNodeId;
  if (!isPlausibleStableNodeId(stableRaw)) {
    throw new InventoryValidationError(
      "tailscaleStableNodeId inválido.",
      "COLLECTOR_STABLE_NODE_ID_INVALID"
    );
  }
  const optional = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    name,
    tailscaleStableNodeId: (stableRaw as string).trim(),
    tailscaleNodeName: optional(data.tailscaleNodeName),
    tailscaleLoginName: optional(data.tailscaleLoginName),
  };
}

export async function registerCollectorDevice(
  prisma: PrismaClient,
  input: RegisterCollectorDeviceInput,
  context: CollectorAdminContext
) {
  assertCanAdministerDevices(context);

  try {
    return await prisma.$transaction(async (tx) => {
      const device = await tx.inventoryCollectorDevice.create({
        data: {
          name: input.name,
          tailscaleStableNodeId: input.tailscaleStableNodeId,
          tailscaleNodeName: input.tailscaleNodeName ?? null,
          tailscaleLoginName: input.tailscaleLoginName ?? null,
          createdByUserId: context.userId,
        },
      });
      await writeInventoryAuditLogInTx(tx, {
        entityType: "InventoryCollectorDevice",
        entityId: device.id,
        action: "DEVICE_REGISTERED",
        afterJson: {
          name: device.name,
          tailscaleStableNodeId: device.tailscaleStableNodeId,
          active: device.active,
        },
        userId: context.userId,
      });
      return device;
    });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      throw new InventoryValidationError(
        "Já existe dispositivo cadastrado para este node Tailscale.",
        COLLECTOR_DEVICE_DUPLICATE
      );
    }
    throw e;
  }
}

export async function setCollectorDeviceStatus(
  prisma: PrismaClient,
  deviceId: string,
  active: boolean,
  context: CollectorAdminContext
) {
  assertCanAdministerDevices(context);

  return prisma.$transaction(async (tx) => {
    const device = await tx.inventoryCollectorDevice.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new InventoryValidationError(
        "Dispositivo não encontrado.",
        COLLECTOR_DEVICE_NOT_FOUND
      );
    }
    if (device.active === active) return device;

    const updated = await tx.inventoryCollectorDevice.update({
      where: { id: deviceId },
      data: active
        ? { active: true, disabledAt: null, disabledByUserId: null }
        : { active: false, disabledAt: new Date(), disabledByUserId: context.userId },
    });
    await writeInventoryAuditLogInTx(tx, {
      entityType: "InventoryCollectorDevice",
      entityId: deviceId,
      action: active ? "DEVICE_ENABLED" : "DEVICE_DISABLED",
      beforeJson: { active: device.active },
      afterJson: {
        active: updated.active,
        tailscaleStableNodeId: updated.tailscaleStableNodeId,
      },
      userId: context.userId,
    });
    return updated;
  });
}

export async function listCollectorDevices(
  prisma: PrismaClient,
  context: CollectorAdminContext
) {
  assertCanAdministerDevices(context);
  return prisma.inventoryCollectorDevice.findMany({ orderBy: { createdAt: "desc" } });
}

export function serializeCollectorDevice(row: {
  id: string;
  name: string;
  tailscaleStableNodeId: string;
  active: boolean;
  tailscaleNodeName: string | null;
  tailscaleLoginName: string | null;
  lastSeenIp: string | null;
  lastSeenAt: Date | null;
  createdByUserId: string | null;
  disabledAt: Date | null;
  disabledByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    tailscaleStableNodeId: row.tailscaleStableNodeId,
    active: row.active,
    tailscaleNodeName: row.tailscaleNodeName,
    tailscaleLoginName: row.tailscaleLoginName,
    lastSeenIp: row.lastSeenIp,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    disabledByUserId: row.disabledByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}

/** Alias local para não depender do namespace em testes com mock. */
export type CollectorDeviceRow = Prisma.InventoryCollectorDeviceGetPayload<object>;
