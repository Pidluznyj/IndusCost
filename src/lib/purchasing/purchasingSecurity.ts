/**
 * OP-27 — Hardening de autorização e evidências da Cadeia de Suprimentos.
 * Helpers puros + asserts de entidade (anti-IDOR) — sem writes em motores oficiais.
 */

import type { PrismaClient } from "@prisma/client";
import {
  isPurchaseEvidenceEntityType,
  PurchaseEvidenceError,
  type PurchaseEvidenceEntityTypeName,
} from "./purchaseEvidenceRules.js";

/** Chaves legadas/contrato que autorizam approve em Compras. */
export const PURCHASES_APPROVE_PERMISSION_KEYS = [
  "purchases.approve",
  "operations.purchases.approve",
] as const;

/** Permissões reais necessárias para movimento de estoque no recebimento. */
export const RECEIVING_INVENTORY_MOVEMENT_PERMISSION_KEYS = [
  "inventory.movement.create",
  "inventory.movements.create",
  "operations.inventory.movements.create",
] as const;

export type PurchasingPersonaId =
  | "viewer_compras"
  | "analista_compras"
  | "aprovador_compras"
  | "recebedor_estoque"
  | "sem_compras";

export type PurchasingPersonaMatrixRow = {
  id: PurchasingPersonaId;
  label: string;
  /** Permissões efetivas simuladas (legado + contrato). */
  effectivePermissions: string[];
  can: {
    viewPurchases: boolean;
    createUpdatePurchases: boolean;
    approvePurchases: boolean;
    useEvidenceException: boolean;
    confirmReceiptWithInventory: boolean;
    reverseReceipt: boolean;
  };
};

/**
 * Matriz de personas SC/Compras — fonte para testes de autorização.
 * Mega-key purchases.view NÃO concede approve nem exceção de evidência.
 */
export const PURCHASING_PERSONA_MATRIX: PurchasingPersonaMatrixRow[] = [
  {
    id: "viewer_compras",
    label: "Visualizador Compras",
    effectivePermissions: ["purchases.view", "operations.purchases.view"],
    can: {
      viewPurchases: true,
      createUpdatePurchases: false,
      approvePurchases: false,
      useEvidenceException: false,
      confirmReceiptWithInventory: false,
      reverseReceipt: false,
    },
  },
  {
    id: "analista_compras",
    label: "Analista de Compras",
    effectivePermissions: [
      "purchases.view",
      "purchases.create",
      "purchases.edit",
      "operations.purchases.view",
      "operations.purchases.create",
      "operations.purchases.update",
    ],
    can: {
      viewPurchases: true,
      createUpdatePurchases: true,
      approvePurchases: false,
      useEvidenceException: false,
      confirmReceiptWithInventory: false,
      reverseReceipt: false,
    },
  },
  {
    id: "aprovador_compras",
    label: "Aprovador Compras",
    effectivePermissions: [
      "purchases.view",
      "purchases.edit",
      "purchases.approve",
      "operations.purchases.view",
      "operations.purchases.update",
      "operations.purchases.approve",
    ],
    can: {
      viewPurchases: true,
      createUpdatePurchases: true,
      approvePurchases: true,
      useEvidenceException: true,
      confirmReceiptWithInventory: false, // falta inventory.movement.create
      reverseReceipt: false,
    },
  },
  {
    id: "recebedor_estoque",
    label: "Recebedor (compras approve + movimento estoque)",
    effectivePermissions: [
      "purchases.view",
      "purchases.approve",
      "operations.purchases.view",
      "operations.purchases.approve",
      "inventory.movement.create",
      "operations.inventory.movements.create",
    ],
    can: {
      viewPurchases: true,
      createUpdatePurchases: false,
      approvePurchases: true,
      useEvidenceException: true,
      confirmReceiptWithInventory: true,
      reverseReceipt: true,
    },
  },
  {
    id: "sem_compras",
    label: "Sem acesso a compras",
    effectivePermissions: ["dashboard.view"],
    can: {
      viewPurchases: false,
      createUpdatePurchases: false,
      approvePurchases: false,
      useEvidenceException: false,
      confirmReceiptWithInventory: false,
      reverseReceipt: false,
    },
  },
];

export function hasAnyPermissionKey(
  effectivePermissions: readonly string[] | null | undefined,
  keys: readonly string[]
): boolean {
  if (!effectivePermissions?.length) return false;
  const set = new Set(effectivePermissions);
  return keys.some((k) => set.has(k));
}

/** Exceção de evidência / conclusão sem evidência — só com approve (nunca do body). */
export function hasPurchasesApprovePermission(
  effectivePermissions: readonly string[] | null | undefined
): boolean {
  return hasAnyPermissionKey(effectivePermissions, PURCHASES_APPROVE_PERMISSION_KEYS);
}

export function hasInventoryMovementCreatePermission(
  effectivePermissions: readonly string[] | null | undefined
): boolean {
  return hasAnyPermissionKey(effectivePermissions, RECEIVING_INVENTORY_MOVEMENT_PERMISSION_KEYS);
}

/**
 * Body `useException` NÃO concede permissão.
 * Só effectivePermissions reais + justificativa (validada no motor de evidência).
 */
export function resolveEvidenceExceptionPermission(input: {
  effectivePermissions: readonly string[] | null | undefined;
  /** Ignorado se true — cliente não pode auto-autorizar. */
  clientClaimedUseException?: boolean;
}): boolean {
  void input.clientClaimedUseException;
  return hasPurchasesApprovePermission(input.effectivePermissions);
}

/** MIME deve casar com extensão conhecida — sem bypass só por extensão. */
export function mimeMatchesPurchaseEvidenceExtension(mimeType: string, fileName: string): boolean {
  const mime = mimeType.trim().toLowerCase();
  const i = fileName.lastIndexOf(".");
  const ext = i >= 0 ? fileName.slice(i).toLowerCase() : "";
  if (!ext) return false;
  if (ext === ".pdf") return mime === "application/pdf";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
    return (
      mime === "image/png" ||
      mime === "image/jpeg" ||
      mime === "image/jpg" ||
      mime === "image/webp" ||
      mime === "image/gif"
    );
  }
  if (ext === ".xlsx") {
    return mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (ext === ".xls") return mime === "application/vnd.ms-excel";
  if (ext === ".csv") return mime === "text/csv" || mime === "application/vnd.ms-excel";
  if (ext === ".eml") return mime === "message/rfc822";
  if (ext === ".msg") return mime === "application/vnd.ms-outlook";
  if (ext === ".doc") return mime === "application/msword";
  if (ext === ".docx") {
    return mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return false;
}

/**
 * Garante que a entidade pai da evidência existe (anti-IDOR / download órfão).
 */
export async function assertPurchaseEvidenceParentExists(
  prisma: PrismaClient,
  entityType: string,
  entityId: string
): Promise<void> {
  if (!isPurchaseEvidenceEntityType(entityType)) {
    throw new PurchaseEvidenceError("Tipo de entidade inválido.", "INVALID_ENTITY_TYPE");
  }
  const ok = await purchaseEvidenceParentExists(prisma, entityType, entityId);
  if (!ok) {
    throw new PurchaseEvidenceError(
      "Entidade da evidência não encontrada ou inacessível.",
      "ENTITY_NOT_FOUND"
    );
  }
}

async function purchaseEvidenceParentExists(
  prisma: PrismaClient,
  entityType: PurchaseEvidenceEntityTypeName,
  entityId: string
): Promise<boolean> {
  switch (entityType) {
    case "REQUEST":
      return Boolean(await prisma.purchaseRequest.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "QUOTATION":
    case "CONFIRMATION":
      return Boolean(await prisma.purchaseQuotation.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "QUOTATION_SUPPLIER":
      return Boolean(
        await prisma.purchaseQuotationSupplier.findUnique({ where: { id: entityId }, select: { id: true } })
      );
    case "OFFER":
      return Boolean(await prisma.purchaseQuotationOffer.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "NEGOTIATION_ROUND":
      return Boolean(
        await prisma.purchaseNegotiationRound.findUnique({ where: { id: entityId }, select: { id: true } })
      );
    case "APPROVAL":
      return Boolean(await prisma.purchaseApproval.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "PURCHASE_ORDER":
      return Boolean(await prisma.purchaseOrder.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "RECEIPT":
      return Boolean(await prisma.purchaseReceipt.findUnique({ where: { id: entityId }, select: { id: true } }));
    default:
      return false;
  }
}

/** Log seguro — sem payload comercial / stack Prisma completa. */
export function safePurchasingLogError(context: string, e: unknown): void {
  const code =
    e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code ?? "") : "";
  const message = e instanceof Error ? e.message.slice(0, 200) : "unknown";
  console.error(`[purchasing] ${context}`, { code: code || undefined, message });
}

export function clampPurchasingPageSize(pageSize: unknown, max = 100, fallback = 20): number {
  const n = Number(pageSize);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}
