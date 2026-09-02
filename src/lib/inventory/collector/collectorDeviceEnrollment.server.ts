/**
 * Solicitação de autorização de dispositivo do Stock Collector (server-only).
 *
 * REGRA CENTRAL: solicitar NÃO é estar autorizado. Este módulo só cria/lê uma
 * FILA de pedidos. A autorização continua sendo exclusivamente
 * `InventoryCollectorDevice` ativo, alcançável apenas por decisão humana —
 * `requireInventoryCollectorDevice` não consulta esta tabela em momento algum.
 *
 * A identidade (stable id / node / login / ip) chega SEMPRE de
 * `resolveInventoryCollectorPeerIdentity`, ou seja, do WhoIs server-side.
 * Nenhuma função aqui aceita identidade vinda do corpo da requisição — nem do
 * tablet, nem do administrador.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeInventoryAuditLogInTx } from "../inventoryAudit.server.js";
import { canApproveInventoryCount } from "../inventoryPermissionChecks.js";
import { InventoryValidationError } from "../inventoryTypes.js";
import {
  COLLECTOR_SECTORS,
  normalizeCollectorSectorInput,
  type CollectorSectorCode,
} from "./collectorSectorContract.js";
import type { CollectorPeerIdentity } from "./collectorPeerIdentity.server.js";

export const COLLECTOR_ENROLLMENT_NOT_FOUND = "COLLECTOR_ENROLLMENT_NOT_FOUND";
export const COLLECTOR_ENROLLMENT_ALREADY_DECIDED = "COLLECTOR_ENROLLMENT_ALREADY_DECIDED";
export const COLLECTOR_ENROLLMENT_DEVICE_INACTIVE = "COLLECTOR_ENROLLMENT_DEVICE_INACTIVE";

/** Validade de um pedido pendente. Sem cron: expiração é avaliada na leitura. */
export const COLLECTOR_ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000;

export const COLLECTOR_ENROLLMENT_STATUS = {
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
} as const;

/** Status devolvido ao TABLET — deliberadamente pobre em informação. */
export type CollectorEnrollmentDeviceStatus =
  | "AUTHORIZED"
  | "PENDING"
  | "REJECTED"
  | "NONE";

export type CollectorEnrollmentDeviceResult = {
  status: CollectorEnrollmentDeviceStatus;
  message: string;
};

/** Mensagens fixas: nunca revelam etapa de falha nem dado interno. */
const DEVICE_MESSAGES: Record<CollectorEnrollmentDeviceStatus, string> = {
  AUTHORIZED: "Dispositivo autorizado.",
  PENDING:
    "Este dispositivo ainda não foi autorizado. Solicitação enviada ao administrador.",
  REJECTED: "A autorização deste dispositivo não foi aprovada.",
  NONE: "Este dispositivo ainda não solicitou autorização.",
};

type EnrollmentPrisma = Pick<
  PrismaClient,
  "inventoryCollectorDevice" | "inventoryCollectorDeviceEnrollment" | "$transaction"
>;

/**
 * Setor do QR aberto — puro contexto operacional para o administrador saber de
 * onde veio o pedido. Não participa de autorização nem vira capacidade.
 * Slug inválido é descartado silenciosamente (não é motivo para negar acesso).
 */
export function normalizeRequestedSectorSlug(raw: unknown): string | null {
  const normalized = normalizeCollectorSectorInput(raw);
  if (!normalized) return null;
  const codes = Object.keys(COLLECTOR_SECTORS) as CollectorSectorCode[];
  const match = codes.find(
    (code) =>
      COLLECTOR_SECTORS[code].slug === normalized ||
      code.toLowerCase() === normalized.toLowerCase()
  );
  return match ? COLLECTOR_SECTORS[match].slug : null;
}

/**
 * Campos de identidade que o cliente NÃO pode enviar. Aceitá-los, mesmo que
 * ignorando, deixaria o contrato ambíguo — então rejeitamos explicitamente.
 */
export const COLLECTOR_ENROLLMENT_FORBIDDEN_BODY_FIELDS = [
  "tailscaleStableNodeId",
  "tailscaleNodeName",
  "tailscaleLoginName",
  "lastSeenIp",
  "status",
  "deviceId",
  "approvedDeviceId",
] as const;

export function assertNoIdentityFieldsInBody(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const data = body as Record<string, unknown>;
  for (const field of COLLECTOR_ENROLLMENT_FORBIDDEN_BODY_FIELDS) {
    if (data[field] !== undefined) {
      throw new InventoryValidationError(
        "Identidade do dispositivo não pode ser enviada pelo cliente.",
        "COLLECTOR_ENROLLMENT_IDENTITY_NOT_ACCEPTED"
      );
    }
  }
}

function isExpired(row: { status: string; expiresAt: Date }, now: Date): boolean {
  return row.status === COLLECTOR_ENROLLMENT_STATUS.pending && row.expiresAt <= now;
}

/**
 * Registra/renova o pedido de autorização.
 *
 * Idempotente por stable id: recarregar a tela mil vezes atualiza UMA linha.
 * REJECTED nunca volta sozinho para PENDING — a decisão humana prevalece até
 * que um humano decida o contrário.
 */
export async function requestCollectorDeviceEnrollment(
  prisma: EnrollmentPrisma,
  identity: CollectorPeerIdentity,
  input: { requestedSectorSlug?: string | null } = {},
  options: { now?: () => Date } = {}
): Promise<CollectorEnrollmentDeviceResult> {
  const now = options.now?.() ?? new Date();

  // Dispositivo já autorizado não entra na fila — o caminho normal é direto.
  const device = await prisma.inventoryCollectorDevice.findUnique({
    where: { tailscaleStableNodeId: identity.stableNodeId },
    select: { id: true, active: true },
  });
  if (device?.active) {
    return { status: "AUTHORIZED", message: DEVICE_MESSAGES.AUTHORIZED };
  }

  const requestedSectorSlug = normalizeRequestedSectorSlug(input.requestedSectorSlug);
  const existing = await prisma.inventoryCollectorDeviceEnrollment.findUnique({
    where: { tailscaleStableNodeId: identity.stableNodeId },
  });

  if (existing) {
    if (existing.status === COLLECTOR_ENROLLMENT_STATUS.rejected) {
      // Insistir não reabre: só o administrador pode mudar de ideia.
      return { status: "REJECTED", message: DEVICE_MESSAGES.REJECTED };
    }
    if (existing.status === COLLECTOR_ENROLLMENT_STATUS.approved && !device?.active) {
      // Aprovado antes, device revogado depois: volta para a fila como pendente.
      await prisma.inventoryCollectorDeviceEnrollment.update({
        where: { id: existing.id },
        data: {
          status: COLLECTOR_ENROLLMENT_STATUS.pending,
          requestCount: { increment: 1 },
          lastRequestedAt: now,
          expiresAt: new Date(now.getTime() + COLLECTOR_ENROLLMENT_TTL_MS),
          decidedAt: null,
          decidedByUserId: null,
          approvedDeviceId: null,
          ...identitySnapshot(identity),
          ...(requestedSectorSlug ? { requestedSectorSlug } : {}),
        },
      });
      return { status: "PENDING", message: DEVICE_MESSAGES.PENDING };
    }

    // PENDING (vigente ou vencido): renova a MESMA linha, nunca duplica.
    await prisma.inventoryCollectorDeviceEnrollment.update({
      where: { id: existing.id },
      data: {
        status: COLLECTOR_ENROLLMENT_STATUS.pending,
        requestCount: { increment: 1 },
        lastRequestedAt: now,
        expiresAt: new Date(now.getTime() + COLLECTOR_ENROLLMENT_TTL_MS),
        ...identitySnapshot(identity),
        ...(requestedSectorSlug ? { requestedSectorSlug } : {}),
      },
    });
    return { status: "PENDING", message: DEVICE_MESSAGES.PENDING };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.inventoryCollectorDeviceEnrollment.create({
        data: {
          tailscaleStableNodeId: identity.stableNodeId,
          ...identitySnapshot(identity),
          requestedSectorSlug,
          status: COLLECTOR_ENROLLMENT_STATUS.pending,
          requestCount: 1,
          firstRequestedAt: now,
          lastRequestedAt: now,
          expiresAt: new Date(now.getTime() + COLLECTOR_ENROLLMENT_TTL_MS),
        },
      });
      // Auditoria só na CRIAÇÃO: o polling do tablet não pode inundar a trilha.
      // userId null é legítimo — ator DEVICE, jamais usuário fictício.
      await writeInventoryAuditLogInTx(tx, {
        entityType: "InventoryCollectorDeviceEnrollment",
        entityId: row.id,
        action: "DEVICE_ENROLLMENT_REQUESTED",
        afterJson: {
          tailscaleNodeName: row.tailscaleNodeName,
          tailscaleLoginName: row.tailscaleLoginName,
          requestedSectorSlug: row.requestedSectorSlug,
        },
        userId: null,
      });
      return row;
    });
    return { status: "PENDING", message: DEVICE_MESSAGES.PENDING };
  } catch (e: unknown) {
    // Corrida entre duas requisições do mesmo tablet: a outra já criou a linha.
    if (isUniqueViolation(e)) {
      return { status: "PENDING", message: DEVICE_MESSAGES.PENDING };
    }
    throw e;
  }
}

function identitySnapshot(identity: CollectorPeerIdentity) {
  return {
    tailscaleNodeName: identity.nodeName,
    tailscaleLoginName: identity.loginName,
    lastSeenIp: identity.peerAddress,
  };
}

/**
 * Status para o TABLET. Nunca devolve stable id, ids internos ou dados do
 * Device Registry — só o suficiente para a tela decidir o que mostrar.
 */
export async function getCollectorDeviceEnrollmentStatus(
  prisma: EnrollmentPrisma,
  identity: CollectorPeerIdentity,
  options: { now?: () => Date } = {}
): Promise<CollectorEnrollmentDeviceResult> {
  const now = options.now?.() ?? new Date();

  const device = await prisma.inventoryCollectorDevice.findUnique({
    where: { tailscaleStableNodeId: identity.stableNodeId },
    select: { active: true },
  });
  if (device?.active) {
    return { status: "AUTHORIZED", message: DEVICE_MESSAGES.AUTHORIZED };
  }

  const row = await prisma.inventoryCollectorDeviceEnrollment.findUnique({
    where: { tailscaleStableNodeId: identity.stableNodeId },
  });
  if (!row) return { status: "NONE", message: DEVICE_MESSAGES.NONE };
  if (row.status === COLLECTOR_ENROLLMENT_STATUS.rejected) {
    return { status: "REJECTED", message: DEVICE_MESSAGES.REJECTED };
  }
  if (isExpired(row, now)) {
    // Vencido não é autorizado nem rejeitado: o tablet deve pedir de novo.
    return { status: "NONE", message: DEVICE_MESSAGES.NONE };
  }
  // APPROVED sem device ativo = revogado depois: para o tablet, continua fora.
  if (row.status === COLLECTOR_ENROLLMENT_STATUS.approved) {
    return { status: "PENDING", message: DEVICE_MESSAGES.PENDING };
  }
  return { status: "PENDING", message: DEVICE_MESSAGES.PENDING };
}

/* ------------------------------------------------------------------ *
 * Administração HUMANA
 * ------------------------------------------------------------------ */

export type CollectorEnrollmentAdminContext = {
  userId: string;
  permissions?: readonly string[];
};

function assertCanAdministerEnrollments(context: CollectorEnrollmentAdminContext): void {
  // Mesma permissão que já governa o Device Registry — autorizar dispositivo
  // continua sendo decisão do nível de quem aprova conferência.
  if (canApproveInventoryCount(context.permissions ?? [])) return;
  throw new InventoryValidationError(
    "Sem permissão para administrar dispositivos do Collector.",
    "NOT_AUTHORIZED"
  );
}

export async function listCollectorDeviceEnrollments(
  prisma: EnrollmentPrisma,
  context: CollectorEnrollmentAdminContext,
  options: { now?: () => Date } = {}
) {
  assertCanAdministerEnrollments(context);
  const now = options.now?.() ?? new Date();
  const rows = await prisma.inventoryCollectorDeviceEnrollment.findMany({
    orderBy: [{ status: "asc" }, { lastRequestedAt: "desc" }],
  });
  return rows.map((row) => ({ row, expired: isExpired(row, now) }));
}

export type ApproveCollectorEnrollmentInput = {
  name: string;
  canManageCountSessions?: boolean;
  canApplyCountAdjustments?: boolean;
};

export function parseApproveCollectorEnrollmentBody(
  body: unknown
): ApproveCollectorEnrollmentInput {
  // Identidade nunca vem do admin: só nome amigável e capacidades.
  assertNoIdentityFieldsInBody(body);
  const data = (body ?? {}) as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) {
    throw new InventoryValidationError(
      "Nome do dispositivo é obrigatório.",
      "FIELD_REQUIRED"
    );
  }
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;
  return {
    name,
    canManageCountSessions: bool(data.canManageCountSessions, true),
    canApplyCountAdjustments: bool(data.canApplyCountAdjustments, true),
  };
}

/**
 * Aprova a solicitação e materializa o dispositivo no Device Registry.
 *
 * Tudo numa transação: se a auditoria ou o device falharem, não sobra
 * enrollment APPROVED órfão nem device sem decisão registrada.
 *
 * O stable id usado é SEMPRE o gravado no enrollment (origem WhoIs) — nunca
 * algo vindo do corpo da requisição do administrador.
 */
export async function approveCollectorDeviceEnrollment(
  prisma: EnrollmentPrisma,
  enrollmentId: string,
  input: ApproveCollectorEnrollmentInput,
  context: CollectorEnrollmentAdminContext,
  options: { now?: () => Date } = {}
) {
  assertCanAdministerEnrollments(context);
  const now = options.now?.() ?? new Date();

  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.inventoryCollectorDeviceEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) {
      throw new InventoryValidationError(
        "Solicitação não encontrada.",
        COLLECTOR_ENROLLMENT_NOT_FOUND
      );
    }
    if (enrollment.status === COLLECTOR_ENROLLMENT_STATUS.rejected) {
      throw new InventoryValidationError(
        "Solicitação já foi recusada. Recuse ou reative pelo dispositivo.",
        COLLECTOR_ENROLLMENT_ALREADY_DECIDED
      );
    }

    const existing = await tx.inventoryCollectorDevice.findUnique({
      where: { tailscaleStableNodeId: enrollment.tailscaleStableNodeId },
    });

    let device = existing;
    if (existing) {
      if (!existing.active) {
        // Revogação manual tem autoridade: reativar é decisão explícita e
        // separada, pelo endpoint de status do Device Registry.
        throw new InventoryValidationError(
          "Este dispositivo foi desativado. Reative-o na lista de dispositivos autorizados.",
          COLLECTOR_ENROLLMENT_DEVICE_INACTIVE
        );
      }
      // Idempotente: já existe e está ativo — só vincula, não duplica.
    } else {
      device = await tx.inventoryCollectorDevice.create({
        data: {
          name: input.name,
          tailscaleStableNodeId: enrollment.tailscaleStableNodeId,
          tailscaleNodeName: enrollment.tailscaleNodeName,
          tailscaleLoginName: enrollment.tailscaleLoginName,
          lastSeenIp: enrollment.lastSeenIp,
          canManageCountSessions: input.canManageCountSessions ?? true,
          canApplyCountAdjustments: input.canApplyCountAdjustments ?? true,
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
          canManageCountSessions: device.canManageCountSessions,
          canApplyCountAdjustments: device.canApplyCountAdjustments,
          origin: "ENROLLMENT",
        },
        userId: context.userId,
      });
    }

    const updated = await tx.inventoryCollectorDeviceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: COLLECTOR_ENROLLMENT_STATUS.approved,
        decidedAt: now,
        decidedByUserId: context.userId,
        approvedDeviceId: device!.id,
      },
    });
    await writeInventoryAuditLogInTx(tx, {
      entityType: "InventoryCollectorDeviceEnrollment",
      entityId: enrollment.id,
      action: "DEVICE_ENROLLMENT_APPROVED",
      beforeJson: { status: enrollment.status },
      afterJson: { status: updated.status, approvedDeviceId: device!.id },
      userId: context.userId,
    });

    return { enrollment: updated, device: device! };
  });
}

export async function rejectCollectorDeviceEnrollment(
  prisma: EnrollmentPrisma,
  enrollmentId: string,
  input: { decisionNote?: string | null },
  context: CollectorEnrollmentAdminContext,
  options: { now?: () => Date } = {}
) {
  assertCanAdministerEnrollments(context);
  const now = options.now?.() ?? new Date();

  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.inventoryCollectorDeviceEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) {
      throw new InventoryValidationError(
        "Solicitação não encontrada.",
        COLLECTOR_ENROLLMENT_NOT_FOUND
      );
    }

    const note =
      typeof input.decisionNote === "string" && input.decisionNote.trim()
        ? input.decisionNote.trim().slice(0, 500)
        : null;

    const updated = await tx.inventoryCollectorDeviceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: COLLECTOR_ENROLLMENT_STATUS.rejected,
        decidedAt: now,
        decidedByUserId: context.userId,
        decisionNote: note,
      },
    });
    await writeInventoryAuditLogInTx(tx, {
      entityType: "InventoryCollectorDeviceEnrollment",
      entityId: enrollment.id,
      action: "DEVICE_ENROLLMENT_REJECTED",
      beforeJson: { status: enrollment.status },
      afterJson: { status: updated.status },
      reason: note ?? undefined,
      userId: context.userId,
    });
    // Recusar NUNCA cria dispositivo: o tablet segue bloqueado.
    return updated;
  });
}

/** Serializer ADMIN — operacional, sem ids de usuário desnecessários. */
export function serializeCollectorDeviceEnrollment(input: {
  row: {
    id: string;
    tailscaleStableNodeId: string;
    tailscaleNodeName: string | null;
    tailscaleLoginName: string | null;
    lastSeenIp: string | null;
    requestedSectorSlug: string | null;
    status: string;
    requestCount: number;
    firstRequestedAt: Date;
    lastRequestedAt: Date;
    expiresAt: Date;
    decidedAt: Date | null;
    decisionNote: string | null;
    approvedDeviceId: string | null;
  };
  expired: boolean;
}) {
  const { row, expired } = input;
  return {
    id: row.id,
    tailscaleStableNodeId: row.tailscaleStableNodeId,
    tailscaleNodeName: row.tailscaleNodeName,
    tailscaleLoginName: row.tailscaleLoginName,
    lastSeenIp: row.lastSeenIp,
    requestedSectorSlug: row.requestedSectorSlug,
    status: row.status,
    expired,
    requestCount: row.requestCount,
    firstRequestedAt: row.firstRequestedAt.toISOString(),
    lastRequestedAt: row.lastRequestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    approvedDeviceId: row.approvedDeviceId,
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

export type CollectorDeviceEnrollmentRow =
  Prisma.InventoryCollectorDeviceEnrollmentGetPayload<object>;
