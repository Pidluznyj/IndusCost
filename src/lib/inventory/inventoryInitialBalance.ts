/**
 * Regras puras de implantação de saldo inicial (OP-10).
 * Sem Prisma — testável e reutilizável no frontend.
 */
import {
  buildInventoryBalanceKey,
  InventoryValidationError,
  safeInventoryNumber,
} from "./inventoryTypes.js";
import { safeTrim } from "@/src/lib/safeTrim.js";

export const INITIAL_BALANCE_MIN_JUSTIFICATION_LENGTH = 5;

export type InitialBalancePayload = {
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  quantity: number;
  countDate: Date;
  responsibleUserId: string;
  justification: string;
  evidenceRef: string | null;
  documentNumber: string | null;
  notes: string | null;
  unitCost: number | null;
  /** Quando true e sem store de anexos, exige evidenceRef ou documentNumber. */
  requireEvidence?: boolean;
};

export type InitialBalanceScopeCheck = {
  physicalQuantity: number;
  hasActiveInitialBalance: boolean;
};

/** Chave estável de origem/idempotência por escopo de implantação. */
export function buildInitialBalanceOriginId(
  itemId: string,
  warehouseId: string,
  locationId?: string | null
): string {
  const balanceKey = buildInventoryBalanceKey(warehouseId, locationId);
  return `initial:${itemId.trim()}:${balanceKey}`;
}

export function buildInitialBalanceIdempotencyKey(
  itemId: string,
  warehouseId: string,
  locationId?: string | null
): string {
  return buildInitialBalanceOriginId(itemId, warehouseId, locationId);
}

export function assertInitialBalanceScopeEligible(check: InitialBalanceScopeCheck): void {
  if (check.hasActiveInitialBalance) {
    throw new InventoryValidationError(
      "Já existe saldo inicial ativo neste item/local. Estorne o movimento anterior para reimplantar.",
      "INITIAL_BALANCE_DUPLICATE"
    );
  }
  if (check.physicalQuantity !== 0) {
    throw new InventoryValidationError(
      "Implantação inicial exige escopo sem saldo físico. Use movimentação ou estorno.",
      "INITIAL_BALANCE_SCOPE_NOT_EMPTY"
    );
  }
}

export function validateInitialBalancePayload(input: InitialBalancePayload): InitialBalancePayload {
  const itemId = safeTrim(input.itemId);
  const warehouseId = safeTrim(input.warehouseId);
  const locationId = safeTrim(input.locationId) || null;
  const responsibleUserId = safeTrim(input.responsibleUserId);
  const justification = safeTrim(input.justification);
  const evidenceRef = safeTrim(input.evidenceRef) || null;
  const documentNumber = safeTrim(input.documentNumber) || null;
  const notes = safeTrim(input.notes) || null;

  if (!itemId) {
    throw new InventoryValidationError("Item é obrigatório.", "FIELD_REQUIRED");
  }
  if (!warehouseId) {
    throw new InventoryValidationError("Almoxarifado é obrigatório.", "FIELD_REQUIRED");
  }
  if (!responsibleUserId) {
    throw new InventoryValidationError("Responsável é obrigatório.", "FIELD_REQUIRED");
  }
  if (!justification || justification.length < INITIAL_BALANCE_MIN_JUSTIFICATION_LENGTH) {
    throw new InventoryValidationError(
      `Justificativa deve ter pelo menos ${INITIAL_BALANCE_MIN_JUSTIFICATION_LENGTH} caracteres.`,
      "JUSTIFICATION_REQUIRED"
    );
  }

  const quantity = safeInventoryNumber(input.quantity);
  if (quantity == null || quantity <= 0) {
    throw new InventoryValidationError(
      "Quantidade contada deve ser maior que zero.",
      "INVALID_QUANTITY"
    );
  }

  if (!(input.countDate instanceof Date) || Number.isNaN(input.countDate.getTime())) {
    throw new InventoryValidationError("Data da contagem inválida.", "INVALID_DATE");
  }

  if (input.requireEvidence && !evidenceRef && !documentNumber) {
    throw new InventoryValidationError(
      "Evidência ou documento de referência é obrigatório.",
      "EVIDENCE_REQUIRED"
    );
  }

  // Valida chave de saldo (warehouse/location).
  buildInventoryBalanceKey(warehouseId, locationId);

  return {
    itemId,
    warehouseId,
    locationId,
    quantity,
    countDate: input.countDate,
    responsibleUserId,
    justification,
    evidenceRef,
    documentNumber,
    notes,
    unitCost: input.unitCost,
    requireEvidence: input.requireEvidence,
  };
}

/** Relatório CSV simples de implantação (puro). */
export function buildInitialBalanceReportCsv(
  rows: ReadonlyArray<{
    movementDate: string;
    itemCode: string;
    itemDescription: string;
    warehouseCode: string;
    warehouseName: string;
    locationCode: string | null;
    quantity: number;
    unit: string;
    responsibleUserId: string | null;
    reason: string;
    evidenceRef: string | null;
    documentNumber: string | null;
    movementId: string;
  }>
): string {
  const header = [
    "movementId",
    "movementDate",
    "itemCode",
    "itemDescription",
    "warehouseCode",
    "warehouseName",
    "locationCode",
    "quantity",
    "unit",
    "responsibleUserId",
    "justification",
    "evidenceRef",
    "documentNumber",
  ];
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.movementId,
        row.movementDate,
        row.itemCode,
        row.itemDescription,
        row.warehouseCode,
        row.warehouseName,
        row.locationCode,
        row.quantity,
        row.unit,
        row.responsibleUserId,
        row.reason,
        row.evidenceRef,
        row.documentNumber,
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}

/** Relatório CSV de saldos (físico/reservado/bloqueado/disponível). */
export function buildBalancesReportCsv(
  rows: ReadonlyArray<{
    itemCode: string;
    itemDescription: string;
    warehouseCode: string;
    warehouseName: string;
    locationCode: string | null;
    physicalQuantity: number;
    reservedQuantity: number;
    blockedQuantity: number;
    quarantineQuantity: number;
    availableQuantity: number;
    unit: string;
  }>
): string {
  const header = [
    "itemCode",
    "itemDescription",
    "warehouseCode",
    "warehouseName",
    "locationCode",
    "physicalQuantity",
    "reservedQuantity",
    "blockedQuantity",
    "quarantineQuantity",
    "availableQuantity",
    "unit",
  ];
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.itemCode,
        row.itemDescription,
        row.warehouseCode,
        row.warehouseName,
        row.locationCode,
        row.physicalQuantity,
        row.reservedQuantity,
        row.blockedQuantity,
        row.quarantineQuantity,
        row.availableQuantity,
        row.unit,
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}
