/**
 * APPLY da carga inicial do Estoque Administrativo.
 * Cria Warehouse ADMINISTRATIVO (se faltando) e InventoryItem ADMINISTRATIVE_SUPPLY.
 * Não cria InventoryBalance nem InventoryMovement.
 */
import {
  ADMINISTRATIVE_STOCK_ITEM_TYPE,
  ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
  ADMINISTRATIVE_STOCK_WAREHOUSE_NAME,
  AdministrativeStockPreviewError,
  classifyAdministrativeStockPreview,
  type AdministrativeStockCsvRow,
  type AdministrativeStockItemSnapshot,
  type AdministrativeStockPreviewResult,
  type AdministrativeStockPreviewRow,
  type AdministrativeStockWarehouseSnapshot,
} from "./administrativeStockInitialLoadPreview.js";

export const ADMINISTRATIVE_STOCK_APPLY_CONFIRM = "ADMINISTRATIVE_STOCK_INITIAL_LOAD";

export type AdministrativeStockApplyActor = {
  id: string;
  role: string;
  isActive: boolean;
};

export type AdministrativeStockNewItemData = {
  code: string;
  description: string;
  itemType: typeof ADMINISTRATIVE_STOCK_ITEM_TYPE;
  unit: string;
  family: string | null;
  group: string | null;
  status: "ACTIVE" | "INACTIVE";
  controlsStock: true;
  defaultWarehouseId: string;
  defaultLocationId: null;
  minimumStock: number | null;
  maximumStock: number | null;
  reorderPoint: number | null;
  preferredSupplierName: string | null;
  lastKnownCost: number | null;
  notes: string | null;
  createdByUserId: string;
};

export type AdministrativeStockWarehouseCreateData = {
  code: typeof ADMINISTRATIVE_STOCK_WAREHOUSE_CODE;
  name: typeof ADMINISTRATIVE_STOCK_WAREHOUSE_NAME;
  status: "ACTIVE";
  allowsMovements: true;
  createdByUserId: string;
};

export class AdministrativeStockItemCodeTakenError extends Error {
  constructor() {
    super("Já existe InventoryItem com este código.");
    this.name = "AdministrativeStockItemCodeTakenError";
  }
}

export type AdministrativeStockApplyTx = {
  ensureWarehouse(
    data: AdministrativeStockWarehouseCreateData
  ): Promise<{ warehouse: AdministrativeStockWarehouseSnapshot; created: boolean }>;
  findItemsByCodes(codes: readonly string[]): Promise<AdministrativeStockItemSnapshot[]>;
  createItem(data: AdministrativeStockNewItemData): Promise<{ id: string }>;
};

export type AdministrativeStockApplyFinalAction =
  | "CREATED"
  | "ALREADY_EXISTS_MATCH"
  | "CONFLICT"
  | "INVALID"
  | "FAILED";

export type AdministrativeStockApplyLine = {
  sourceRow: number;
  code: string;
  classificationBeforeApply: string;
  finalAction: AdministrativeStockApplyFinalAction;
  inventoryItemId: string;
  reason: string;
};

export type AdministrativeStockApplyResult = {
  warehouseAction: "CREATED" | "ALREADY_EXISTS";
  warehouseId: string;
  created: number;
  alreadyExistsMatch: number;
  conflict: number;
  invalid: number;
  failed: number;
  lines: AdministrativeStockApplyLine[];
};

export function assertAdministrativeStockApplyRequest(input: {
  confirm: string | null;
  actorUserId: string | null;
  filePath: string | null;
}): void {
  if (input.confirm !== ADMINISTRATIVE_STOCK_APPLY_CONFIRM) {
    throw new AdministrativeStockPreviewError(
      `APPLY exige --confirm=${ADMINISTRATIVE_STOCK_APPLY_CONFIRM}. Nada foi gravado.`
    );
  }
  if (!input.actorUserId?.trim()) {
    throw new AdministrativeStockPreviewError("APPLY exige --actorUserId. Nada foi gravado.");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.actorUserId.trim()
    )
  ) {
    throw new AdministrativeStockPreviewError("actorUserId não é um UUID válido. Nada foi gravado.");
  }
  if (!input.filePath?.trim()) {
    throw new AdministrativeStockPreviewError("APPLY exige --file. Nada foi gravado.");
  }
}

function sourceByCode(rows: readonly AdministrativeStockCsvRow[]): Map<string, AdministrativeStockCsvRow> {
  const map = new Map<string, AdministrativeStockCsvRow>();
  for (const row of rows) map.set(row.code.trim().toUpperCase(), row);
  return map;
}

export async function executeAdministrativeStockApply(input: {
  preview: AdministrativeStockPreviewResult;
  actor: AdministrativeStockApplyActor;
  tx: AdministrativeStockApplyTx;
}): Promise<AdministrativeStockApplyResult> {
  if (!input.actor.isActive) {
    throw new AdministrativeStockPreviewError(
      "Responsável inexistente ou inativo. APPLY foi interrompido. Nada foi gravado."
    );
  }
  if (input.preview.blockingErrors.length > 0) {
    throw new AdministrativeStockPreviewError(
      `PREVIEW com erros impeditivos: ${input.preview.blockingErrors.join(" | ")}. Nada foi gravado.`
    );
  }

  const ensured = await input.tx.ensureWarehouse({
    code: ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
    name: ADMINISTRATIVE_STOCK_WAREHOUSE_NAME,
    status: "ACTIVE",
    allowsMovements: true,
    createdByUserId: input.actor.id,
  });
  const warehouse = ensured.warehouse;
  const warehouseAction: "CREATED" | "ALREADY_EXISTS" = ensured.created ? "CREATED" : "ALREADY_EXISTS";

  const sources = sourceByCode(input.preview.sourceRows);
  const lines: AdministrativeStockApplyLine[] = [];
  let created = 0;
  let alreadyExistsMatch = 0;
  let conflict = 0;
  let invalid = 0;
  let failed = 0;

  for (const row of input.preview.rows) {
    if (row.classification === "INVALID") {
      invalid += 1;
      lines.push({
        sourceRow: row.sourceRow,
        code: row.code,
        classificationBeforeApply: row.classification,
        finalAction: "INVALID",
        inventoryItemId: "",
        reason: row.reason,
      });
      continue;
    }
    if (row.classification === "CONFLICT") {
      conflict += 1;
      lines.push({
        sourceRow: row.sourceRow,
        code: row.code,
        classificationBeforeApply: row.classification,
        finalAction: "CONFLICT",
        inventoryItemId: row.inventoryItemId ?? "",
        reason: row.reason,
      });
      continue;
    }
    if (row.classification === "ALREADY_EXISTS_MATCH") {
      alreadyExistsMatch += 1;
      lines.push({
        sourceRow: row.sourceRow,
        code: row.code,
        classificationBeforeApply: row.classification,
        finalAction: "ALREADY_EXISTS_MATCH",
        inventoryItemId: row.inventoryItemId ?? "",
        reason: row.reason,
      });
      continue;
    }

    const source = sources.get(row.code.trim().toUpperCase());
    if (!source) {
      failed += 1;
      lines.push({
        sourceRow: row.sourceRow,
        code: row.code,
        classificationBeforeApply: row.classification,
        finalAction: "FAILED",
        inventoryItemId: "",
        reason: "Linha CREATE sem sourceRow correspondente.",
      });
      continue;
    }

    try {
      const existing = await input.tx.findItemsByCodes([source.code]);
      const repreview = classifyAdministrativeStockPreview({
        sourceRows: [source],
        items: existing,
        warehouse,
        sha256: input.preview.sha256,
        sourceFileName: input.preview.sourceFileName,
      });
      const current = repreview.rows[0];
      if (!current) {
        failed += 1;
        lines.push({
          sourceRow: row.sourceRow,
          code: row.code,
          classificationBeforeApply: row.classification,
          finalAction: "FAILED",
          inventoryItemId: "",
          reason: "Reclassificação vazia no APPLY.",
        });
        continue;
      }
      if (current.classification === "ALREADY_EXISTS_MATCH") {
        alreadyExistsMatch += 1;
        lines.push({
          sourceRow: row.sourceRow,
          code: row.code,
          classificationBeforeApply: row.classification,
          finalAction: "ALREADY_EXISTS_MATCH",
          inventoryItemId: current.inventoryItemId ?? "",
          reason: "Item compatível reencontrado no APPLY (idempotente).",
        });
        continue;
      }
      if (current.classification !== "CREATE") {
        conflict += 1;
        lines.push({
          sourceRow: row.sourceRow,
          code: row.code,
          classificationBeforeApply: row.classification,
          finalAction: "CONFLICT",
          inventoryItemId: current.inventoryItemId ?? "",
          reason: current.reason,
        });
        continue;
      }

      const createdItem = await input.tx.createItem({
        code: source.code,
        description: source.description,
        itemType: ADMINISTRATIVE_STOCK_ITEM_TYPE,
        unit: source.unit,
        family: source.family,
        group: source.group,
        status: source.status,
        controlsStock: true,
        defaultWarehouseId: warehouse.id,
        defaultLocationId: null,
        minimumStock: source.minimumStock,
        maximumStock: source.maximumStock,
        reorderPoint: source.reorderPoint,
        preferredSupplierName: source.preferredSupplierName,
        lastKnownCost: source.lastKnownCost,
        notes: source.notes,
        createdByUserId: input.actor.id,
      });
      created += 1;
      lines.push({
        sourceRow: row.sourceRow,
        code: row.code,
        classificationBeforeApply: row.classification,
        finalAction: "CREATED",
        inventoryItemId: createdItem.id,
        reason: "InventoryItem ADMINISTRATIVE_SUPPLY criado.",
      });
    } catch (error) {
      if (error instanceof AdministrativeStockItemCodeTakenError) {
        const again = await input.tx.findItemsByCodes([row.code]);
        const repreview = classifyAdministrativeStockPreview({
          sourceRows: source ? [source] : [],
          items: again,
          warehouse,
          sha256: input.preview.sha256,
          sourceFileName: input.preview.sourceFileName,
        });
        const current = repreview.rows[0];
        if (current?.classification === "ALREADY_EXISTS_MATCH") {
          alreadyExistsMatch += 1;
          lines.push({
            sourceRow: row.sourceRow,
            code: row.code,
            classificationBeforeApply: row.classification,
            finalAction: "ALREADY_EXISTS_MATCH",
            inventoryItemId: current.inventoryItemId ?? "",
            reason: "Corrida P2002 — item compatível já existia (idempotente).",
          });
          continue;
        }
        conflict += 1;
        lines.push({
          sourceRow: row.sourceRow,
          code: row.code,
          classificationBeforeApply: row.classification,
          finalAction: "CONFLICT",
          inventoryItemId: current?.inventoryItemId ?? "",
          reason: current?.reason ?? "Código já existe com conflito.",
        });
        continue;
      }
      failed += 1;
      lines.push({
        sourceRow: row.sourceRow,
        code: row.code,
        classificationBeforeApply: row.classification,
        finalAction: "FAILED",
        inventoryItemId: "",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    warehouseAction,
    warehouseId: warehouse.id,
    created,
    alreadyExistsMatch,
    conflict,
    invalid,
    failed,
    lines,
  };
}

export function renderAdministrativeStockApplyCsv(lines: readonly AdministrativeStockApplyLine[]): string {
  const header = [
    "sourceRow",
    "code",
    "classificationBeforeApply",
    "finalAction",
    "inventoryItemId",
    "reason",
  ];
  const escape = (value: string) => (/["\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [
    header.join(";"),
    ...lines.map((line) =>
      [
        String(line.sourceRow),
        line.code,
        line.classificationBeforeApply,
        line.finalAction,
        line.inventoryItemId,
        line.reason,
      ]
        .map(escape)
        .join(";")
    ),
  ].join("\r\n");
}

/** Utilitário de teste: reexport tipado da linha de preview. */
export type { AdministrativeStockPreviewRow };
