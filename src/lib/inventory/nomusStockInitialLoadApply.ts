/**
 * APPLY da carga inicial Nomus.
 *
 * O saldo nasce só em createInitialInventoryBalance(), que abre a própria
 * transação e grava InventoryMovement INITIAL_BALANCE. Este módulo não escreve
 * InventoryBalance, Product nem Material.
 *
 * O InventoryItem novo e o movimento não cabem na mesma transação: o motor
 * canônico usa o client raiz, não o tx do chamador. Se o item for criado e o
 * movimento falhar, a próxima execução reencontra o item e completa o saldo
 * se o escopo continuar vazio. Um SKU com erro não altera o SKU seguinte.
 */
import { canCreateInventoryAdjustment, INVENTORY_PERMISSION_KEYS } from "./inventoryPermissionChecks.js";
import {
  classifyNomusStockPreview,
  findNomusStockPositionDate,
  NomusStockPreviewError,
  NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE,
  parseUnambiguousCalendarDate,
  type NomusStockBalanceSnapshot,
  type NomusStockItemSnapshot,
  type NomusStockMovementSnapshot,
  type NomusStockPreviewRow,
  type NomusStockProductSnapshot,
  type NomusStockSourceRow,
  type NomusStockWarehouseSnapshot,
} from "./nomusStockInitialLoadPreview.js";

export const NOMUS_INITIAL_STOCK_APPLY_CONFIRM = "NOMUS_INITIAL_STOCK_LOAD";
export const NOMUS_INITIAL_STOCK_REASON = "Carga inicial de estoque - posição Nomus";

const ELIGIBLE = new Set([
  "READY_CREATE_ITEM_AND_INITIAL_BALANCE",
  "READY_INITIAL_BALANCE",
]);

const SKIPPED = new Set(["ZERO_BALANCE_NO_ACTION"]);

export class NomusStockItemCodeTakenError extends Error {
  constructor() {
    super("Já existe InventoryItem com este código.");
    this.name = "NomusStockItemCodeTakenError";
  }
}

export type NomusStockApplyActor = {
  id: string;
  role: string;
  isActive: boolean;
  permissions: readonly string[];
};

export type NomusStockNewItemData = {
  code: string;
  description: string;
  itemType: "FINISHED_PRODUCT" | "COMPONENT";
  unit: string;
  status: "ACTIVE";
  controlsStock: true;
  controlsLocation: false;
  productId: string;
  nomusProductCode: string;
  nomusProductId: string | null;
  defaultWarehouseId: string;
  createdByUserId: string;
  notes: string;
};

export type NomusStockApplyTx = {
  reloadSku(sku: string): Promise<{
    products: NomusStockProductSnapshot[];
    items: NomusStockItemSnapshot[];
    warehouses: NomusStockWarehouseSnapshot[];
    balances: NomusStockBalanceSnapshot[];
    movements: NomusStockMovementSnapshot[];
  }>;
  createItem(data: NomusStockNewItemData): Promise<{ id: string }>;
};

export type NomusStockPostInitialBalance = {
  itemId: string;
  warehouseId: string;
  locationId: null;
  quantity: number;
  countDate: Date;
  responsibleUserId: string;
  justification: string;
  evidenceRef: string;
  documentNumber: string;
  notes: string;
  unitCost: null;
  unit: string;
  permissions: readonly string[];
};

export type NomusStockApplyPorts = {
  transaction<T>(work: (tx: NomusStockApplyTx) => Promise<T>): Promise<T>;
  postInitialBalance(
    input: NomusStockPostInitialBalance
  ): Promise<{ movementId: string; idempotent: boolean; quantity: number }>;
};

export type NomusStockApplyFinalAction =
  | "APPLIED_ITEM_AND_BALANCE"
  | "APPLIED_BALANCE"
  | "IDEMPOTENT"
  | "SKIPPED"
  | "BLOCKED"
  | "FAILED";

export type NomusStockApplyLine = {
  sku: string;
  classificationBeforeApply: string;
  finalAction: NomusStockApplyFinalAction;
  inventoryItemId: string;
  movementId: string;
  warehouseCode: string;
  quantity: number | null;
  reason: string;
};

export type NomusStockApplyResult = {
  appliedItemsCreated: number;
  appliedInitialBalances: number;
  idempotent: number;
  skipped: number;
  blocked: number;
  failed: number;
  lines: NomusStockApplyLine[];
};

type PreparedPost = {
  action: "post";
  createdItem: boolean;
  itemId: string;
  warehouseId: string;
  warehouseCode: string;
  quantity: number;
  unit: string;
  reason: string;
};

function isPreparedPost(value: PreparedPost | PreparedStop): value is PreparedPost {
  return value.action === "post";
}

type PreparedStop = {
  action: "idempotent" | "blocked";
  itemId: string;
  movementId: string;
  warehouseCode: string;
  quantity: number | null;
  reason: string;
};

export function evidenceRefForNomusStock(sha256: string): string {
  return `sha256:${sha256}`;
}

export function documentNumberForNomusStock(asOf: string): string {
  return `RelatorioPosicaoEstoqueEmpresa:${asOf}`;
}

export function notesForNomusStock(sourceFileName: string): string {
  const baseName = sourceFileName.trim().replace(/^[\\/]+/, "").split(/[\\/]/).pop() ?? "";
  return baseName
    ? `Implantação inicial Nomus. Arquivo: ${baseName}`
    : "Implantação inicial Nomus.";
}

export function assertNomusStockApplyRequest(input: {
  confirm: string | null;
  actorUserId: string | null;
  filePath: string | null;
}): void {
  if (input.confirm !== NOMUS_INITIAL_STOCK_APPLY_CONFIRM) {
    throw new NomusStockPreviewError(
      `APPLY exige --confirm=${NOMUS_INITIAL_STOCK_APPLY_CONFIRM}. Nada foi gravado.`
    );
  }
  if (!input.actorUserId?.trim()) {
    throw new NomusStockPreviewError("APPLY exige --actorUserId. Nada foi gravado.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actorUserId.trim())) {
    throw new NomusStockPreviewError("actorUserId não é um UUID válido. Nada foi gravado.");
  }
  if (!input.filePath?.trim()) {
    throw new NomusStockPreviewError("APPLY exige --file. Nada foi gravado.");
  }
}

export function resolveNomusStockAsOf(input: {
  matrix: readonly (readonly unknown[])[];
  headerRowNumber: number;
  asOfArg: string | null;
}): string {
  const fromFile = findNomusStockPositionDate(input.matrix, input.headerRowNumber);
  const fromArg = input.asOfArg?.trim() ? parseUnambiguousCalendarDate(input.asOfArg.trim()) : null;
  if (input.asOfArg?.trim() && !fromArg) {
    throw new NomusStockPreviewError("--asOf deve ser YYYY-MM-DD. Nada foi gravado.");
  }
  if (fromFile && fromArg && fromFile !== fromArg) {
    throw new NomusStockPreviewError(
      `A data do arquivo (${fromFile}) diverge de --asOf (${fromArg}). Nada foi gravado.`
    );
  }
  const asOf = fromFile ?? fromArg;
  if (!asOf) {
    throw new NomusStockPreviewError(
      "Não há data de posição no arquivo. Informe --asOf=YYYY-MM-DD. Nada foi gravado."
    );
  }
  return asOf;
}

export function assertNomusStockFileStable(beforeHash: string, afterHash: string): void {
  if (beforeHash !== afterHash) {
    throw new NomusStockPreviewError("O arquivo mudou durante a leitura. APPLY foi interrompido.");
  }
}

function warehouseReady(warehouse: NomusStockWarehouseSnapshot | undefined): boolean {
  return Boolean(warehouse && warehouse.status === "ACTIVE" && warehouse.allowsMovements);
}

export function assertNomusDestinationWarehouses(warehouses: readonly NomusStockWarehouseSnapshot[]): void {
  for (const code of [NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.PRODUCT, NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.COMPONENT]) {
    const matches = warehouses.filter((warehouse) => warehouse.code.trim().toLocaleUpperCase("pt-BR") === code);
    if (matches.length !== 1 || !warehouseReady(matches[0])) {
      throw new NomusStockPreviewError(
        `Almoxarifado ${code} ausente, inativo ou sem movimentação. APPLY foi interrompido.`
      );
    }
  }
}

function reliableExternalId(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text || /\s/.test(text) || text.length > 64) return null;
  return text;
}

export function buildNomusInventoryItemCreateData(input: {
  product: NomusStockProductSnapshot;
  unit: string;
  descriptionNomus: string;
  warehouseId: string;
  actorUserId: string;
  sourceFileName: string;
}): NomusStockNewItemData {
  const description = input.product.name.trim() || input.descriptionNomus.trim();
  if (!description) {
    throw new NomusStockPreviewError(`Product ${input.product.sku} está sem nome. A linha foi bloqueada.`);
  }
  const itemType = input.product.type === "PRODUCT" ? "FINISHED_PRODUCT" : input.product.type === "COMPONENT" ? "COMPONENT" : null;
  if (!itemType) {
    throw new NomusStockPreviewError(`Product.type ${input.product.type} está fora da carga.`);
  }
  return {
    code: input.product.sku.trim(),
    description,
    itemType,
    unit: input.unit.trim(),
    status: "ACTIVE",
    controlsStock: true,
    controlsLocation: false,
    productId: input.product.id,
    nomusProductCode: input.product.sku.trim(),
    nomusProductId: reliableExternalId(input.product.sourceExternalId),
    defaultWarehouseId: input.warehouseId,
    createdByUserId: input.actorUserId,
    notes: notesForNomusStock(input.sourceFileName),
  };
}

function sameQuantity(left: number, right: number): boolean {
  return Math.abs(left - right) < 5e-7;
}

function skuKey(sku: string): string {
  return sku.trim().toLocaleUpperCase("pt-BR");
}

export function findIdempotentNomusInitialBalance(input: {
  row: NomusStockPreviewRow;
  movements: readonly NomusStockMovementSnapshot[];
  warehouses: readonly NomusStockWarehouseSnapshot[];
  sha256: string;
}): { movementId: string } | null {
  if (!input.row.inventoryItemId || input.row.nomusQuantity == null || input.row.physicalQuantity == null) return null;
  if (!sameQuantity(input.row.physicalQuantity, input.row.nomusQuantity)) return null;
  const warehouse = input.warehouses.find(
    (candidate) => candidate.code.trim().toLocaleUpperCase("pt-BR") === input.row.warehouseCode.trim().toLocaleUpperCase("pt-BR")
  );
  if (!warehouse) return null;
  const evidence = evidenceRefForNomusStock(input.sha256);
  const reversed = new Set(
    input.movements
      .filter((movement) => movement.movementType === "REVERSAL" && movement.reversedMovementId)
      .map((movement) => movement.reversedMovementId as string)
  );
  const matches = input.movements.filter(
    (movement) =>
      movement.itemId === input.row.inventoryItemId &&
      movement.destinationWarehouseId === warehouse.id &&
      movement.movementType === "INITIAL_BALANCE" &&
      !reversed.has(movement.id) &&
      movement.evidenceRef === evidence &&
      movement.quantity != null &&
      sameQuantity(movement.quantity, input.row.nomusQuantity as number)
  );
  if (matches.length !== 1) return null;
  return { movementId: matches[0]!.id };
}

function enginePermissions(actor: NomusStockApplyActor): readonly string[] {
  if (actor.role.trim().toUpperCase() === "SUPER_ADMIN") {
    return [...new Set([...actor.permissions, INVENTORY_PERMISSION_KEYS.adjustmentCreate, INVENTORY_PERMISSION_KEYS.manageLegacy])];
  }
  return actor.permissions;
}

function lineFrom(
  row: NomusStockPreviewRow,
  finalAction: NomusStockApplyFinalAction,
  reason: string,
  extra?: Partial<NomusStockApplyLine>
): NomusStockApplyLine {
  return {
    sku: row.sku,
    classificationBeforeApply: row.classification,
    finalAction,
    inventoryItemId: extra?.inventoryItemId ?? row.inventoryItemId,
    movementId: extra?.movementId ?? "",
    warehouseCode: extra?.warehouseCode ?? row.warehouseCode,
    quantity: extra?.quantity ?? row.nomusQuantity,
    reason,
  };
}

function sourceRowsForSku(rows: readonly NomusStockSourceRow[], sku: string): NomusStockSourceRow[] {
  const key = skuKey(sku);
  return rows.filter((row) => skuKey(row.sku) === key);
}

function classifySku(
  sku: string,
  sourceRows: readonly NomusStockSourceRow[],
  snapshot: {
    products: NomusStockProductSnapshot[];
    items: NomusStockItemSnapshot[];
    warehouses: NomusStockWarehouseSnapshot[];
    balances: NomusStockBalanceSnapshot[];
    movements: NomusStockMovementSnapshot[];
  }
): NomusStockPreviewRow | null {
  const preview = classifyNomusStockPreview({
    sourceRows: sourceRowsForSku(sourceRows, sku),
    ...snapshot,
  });
  return preview.rows.find((row) => skuKey(row.sku) === skuKey(sku)) ?? preview.rows[0] ?? null;
}

function productChanged(before: NomusStockPreviewRow, after: NomusStockPreviewRow): boolean {
  return before.productId !== after.productId || before.productType !== after.productType || before.productStatus !== after.productStatus;
}

async function prepareSku(input: {
  row: NomusStockPreviewRow;
  sourceRows: readonly NomusStockSourceRow[];
  sha256: string;
  sourceFileName: string;
  actor: NomusStockApplyActor;
  tx: NomusStockApplyTx;
}): Promise<PreparedPost | PreparedStop> {
  const first = await input.tx.reloadSku(input.row.sku);
  const fresh = classifySku(input.row.sku, input.sourceRows, first);
  if (!fresh) {
    return { action: "blocked", itemId: "", movementId: "", warehouseCode: "", quantity: input.row.nomusQuantity, reason: "SKU sumiu na revalidação." };
  }
  const already = findIdempotentNomusInitialBalance({
    row: fresh,
    movements: first.movements,
    warehouses: first.warehouses,
    sha256: input.sha256,
  });
  if (already) {
    return {
      action: "idempotent",
      itemId: fresh.inventoryItemId,
      movementId: already.movementId,
      warehouseCode: fresh.warehouseCode,
      quantity: fresh.nomusQuantity,
      reason: "Carga já implantada para este arquivo e esta quantidade.",
    };
  }
  if (productChanged(input.row, fresh) || fresh.warehouseCode !== input.row.warehouseCode) {
    return {
      action: "blocked",
      itemId: fresh.inventoryItemId,
      movementId: "",
      warehouseCode: fresh.warehouseCode,
      quantity: fresh.nomusQuantity,
      reason: `Estado mudou na revalidação: ${fresh.classification}. ${fresh.reason}`,
    };
  }
  if (!ELIGIBLE.has(fresh.classification)) {
    return {
      action: "blocked",
      itemId: fresh.inventoryItemId,
      movementId: "",
      warehouseCode: fresh.warehouseCode,
      quantity: fresh.nomusQuantity,
      reason: fresh.reason,
    };
  }

  const product = first.products.find((candidate) => candidate.id === fresh.productId);
  const warehouse = first.warehouses.find(
    (candidate) => candidate.code.trim().toLocaleUpperCase("pt-BR") === fresh.warehouseCode.trim().toLocaleUpperCase("pt-BR")
  );
  if (!product || !warehouse || !warehouseReady(warehouse) || fresh.nomusQuantity == null) {
    return {
      action: "blocked",
      itemId: fresh.inventoryItemId,
      movementId: "",
      warehouseCode: fresh.warehouseCode,
      quantity: fresh.nomusQuantity,
      reason: "Product ou almoxarifado deixou de estar apto na revalidação.",
    };
  }

  let itemId = fresh.inventoryItemId;
  let createdItem = false;
  if (!itemId) {
    const data = buildNomusInventoryItemCreateData({
      product,
      unit: fresh.unitNomus,
      descriptionNomus: fresh.descriptionNomus,
      warehouseId: warehouse.id,
      actorUserId: input.actor.id,
      sourceFileName: input.sourceFileName,
    });
    if ("materialId" in data) {
      return { action: "blocked", itemId: "", movementId: "", warehouseCode: fresh.warehouseCode, quantity: fresh.nomusQuantity, reason: "Criação híbrida com matéria-prima foi recusada." };
    }
    try {
      const created = await input.tx.createItem(data);
      itemId = created.id;
      createdItem = true;
    } catch (error) {
      if (!(error instanceof NomusStockItemCodeTakenError)) throw error;
      const raced = await input.tx.reloadSku(input.row.sku);
      const again = classifySku(input.row.sku, input.sourceRows, raced);
      if (!again || again.classification === "INVENTORY_ITEM_IDENTITY_CONFLICT" || !again.inventoryItemId) {
        return {
          action: "blocked",
          itemId: "",
          movementId: "",
          warehouseCode: fresh.warehouseCode,
          quantity: fresh.nomusQuantity,
          reason: again?.reason ?? "Código de InventoryItem conflitante na revalidação.",
        };
      }
      itemId = again.inventoryItemId;
    }
  }

  const second = await input.tx.reloadSku(input.row.sku);
  const confirmed = classifySku(input.row.sku, input.sourceRows, second);
  if (!confirmed || productChanged(input.row, confirmed)) {
    return {
      action: "blocked",
      itemId,
      movementId: "",
      warehouseCode: fresh.warehouseCode,
      quantity: fresh.nomusQuantity,
      reason: "Product mudou depois da resolução do item.",
    };
  }
  const confirmedIdempotent = findIdempotentNomusInitialBalance({
    row: { ...confirmed, inventoryItemId: confirmed.inventoryItemId || itemId },
    movements: second.movements,
    warehouses: second.warehouses,
    sha256: input.sha256,
  });
  if (confirmedIdempotent) {
    return {
      action: "idempotent",
      itemId,
      movementId: confirmedIdempotent.movementId,
      warehouseCode: confirmed.warehouseCode,
      quantity: confirmed.nomusQuantity,
      reason: "Carga já implantada para este arquivo e esta quantidade.",
    };
  }
  if (confirmed.classification !== "READY_INITIAL_BALANCE" && !(createdItem && confirmed.classification === "READY_CREATE_ITEM_AND_INITIAL_BALANCE")) {
    return {
      action: "blocked",
      itemId,
      movementId: "",
      warehouseCode: confirmed.warehouseCode,
      quantity: confirmed.nomusQuantity,
      reason: confirmed.reason,
    };
  }
  if (createdItem && confirmed.classification === "READY_CREATE_ITEM_AND_INITIAL_BALANCE") {
    return {
      action: "blocked",
      itemId,
      movementId: "",
      warehouseCode: confirmed.warehouseCode,
      quantity: confirmed.nomusQuantity,
      reason: "O item criado não ficou visível para o saldo inicial.",
    };
  }
  return {
    action: "post",
    createdItem,
    itemId,
    warehouseId: warehouse.id,
    warehouseCode: confirmed.warehouseCode,
    quantity: confirmed.nomusQuantity ?? fresh.nomusQuantity,
    unit: confirmed.unitNomus || fresh.unitNomus,
    reason: NOMUS_INITIAL_STOCK_REASON,
  };
}

export async function executeNomusStockApply(input: {
  rows: readonly NomusStockPreviewRow[];
  sourceRows: readonly NomusStockSourceRow[];
  movements: readonly NomusStockMovementSnapshot[];
  warehouses: readonly NomusStockWarehouseSnapshot[];
  sha256: string;
  sourceFileName: string;
  asOf: string;
  actor: NomusStockApplyActor;
  ports: NomusStockApplyPorts;
}): Promise<NomusStockApplyResult> {
  if (!input.actor.isActive) {
    throw new NomusStockPreviewError("Responsável inexistente ou inativo. APPLY foi interrompido.");
  }
  if (input.actor.role.trim().toUpperCase() !== "SUPER_ADMIN" && !canCreateInventoryAdjustment(input.actor.permissions)) {
    throw new NomusStockPreviewError("Responsável sem permissão de ajuste de estoque. APPLY foi interrompido.");
  }
  assertNomusDestinationWarehouses(input.warehouses);
  const asOfDate = parseUnambiguousCalendarDate(input.asOf);
  if (!asOfDate) {
    throw new NomusStockPreviewError("Data de referência ausente. APPLY foi interrompido.");
  }

  const lines: NomusStockApplyLine[] = [];
  for (const row of input.rows) {
    if (SKIPPED.has(row.classification)) {
      lines.push(lineFrom(row, "SKIPPED", row.reason));
      continue;
    }
    const batchIdempotent = findIdempotentNomusInitialBalance({
      row,
      movements: input.movements,
      warehouses: input.warehouses,
      sha256: input.sha256,
    });
    if (!ELIGIBLE.has(row.classification) && !batchIdempotent) {
      lines.push(lineFrom(row, "BLOCKED", row.reason));
      continue;
    }
    try {
      const prepared = await input.ports.transaction((tx) =>
        prepareSku({
          row,
          sourceRows: input.sourceRows,
          sha256: input.sha256,
          sourceFileName: input.sourceFileName,
          actor: input.actor,
          tx,
        })
      );
      if (prepared.action === "idempotent") {
        lines.push(lineFrom(row, "IDEMPOTENT", prepared.reason, prepared));
        continue;
      }
      if (prepared.action === "blocked") {
        lines.push(lineFrom(row, "BLOCKED", prepared.reason, prepared));
        continue;
      }
      if (!isPreparedPost(prepared)) {
        lines.push(lineFrom(row, "FAILED", "A revalidação não produziu uma ação conhecida."));
        continue;
      }
      const posting = prepared;
      try {
        const posted = await input.ports.postInitialBalance({
          itemId: posting.itemId,
          warehouseId: posting.warehouseId,
          locationId: null,
          quantity: posting.quantity,
          countDate: new Date(`${asOfDate}T12:00:00.000Z`),
          responsibleUserId: input.actor.id,
          justification: NOMUS_INITIAL_STOCK_REASON,
          evidenceRef: evidenceRefForNomusStock(input.sha256),
          documentNumber: documentNumberForNomusStock(asOfDate),
          notes: notesForNomusStock(input.sourceFileName),
          unitCost: null,
          unit: posting.unit,
          permissions: enginePermissions(input.actor),
        });
        const quantityAgrees = sameQuantity(posted.quantity, posting.quantity);
        const finalAction: NomusStockApplyFinalAction = posted.idempotent && !quantityAgrees
          ? "BLOCKED"
          : posted.idempotent
            ? "IDEMPOTENT"
            : posting.createdItem
              ? "APPLIED_ITEM_AND_BALANCE"
              : "APPLIED_BALANCE";
        const reason = posted.idempotent && !quantityAgrees
          ? `O motor devolveu INITIAL_BALANCE existente com quantidade ${posted.quantity}, diferente da quantidade Nomus ${posting.quantity}.`
          : posted.idempotent
            ? "O motor canônico devolveu o INITIAL_BALANCE já existente."
            : NOMUS_INITIAL_STOCK_REASON;
        lines.push(
          lineFrom(row, finalAction, reason, {
            inventoryItemId: posting.itemId,
            movementId: posted.movementId,
            warehouseCode: posting.warehouseCode,
            quantity: posting.quantity,
          })
        );
      } catch (error) {
        lines.push(
          lineFrom(row, "FAILED", error instanceof Error ? error.message : String(error), {
            inventoryItemId: posting.itemId,
            warehouseCode: posting.warehouseCode,
            quantity: posting.quantity,
          })
        );
      }
    } catch (error) {
      lines.push(
        lineFrom(row, "FAILED", error instanceof Error ? error.message : String(error), {
          inventoryItemId: row.inventoryItemId,
        })
      );
    }
  }

  const count = (action: NomusStockApplyFinalAction) => lines.filter((line) => line.finalAction === action).length;
  return {
    appliedItemsCreated: lines.filter((line) => line.finalAction === "APPLIED_ITEM_AND_BALANCE").length,
    appliedInitialBalances:
      count("APPLIED_ITEM_AND_BALANCE") + count("APPLIED_BALANCE"),
    idempotent: count("IDEMPOTENT"),
    skipped: count("SKIPPED"),
    blocked: count("BLOCKED"),
    failed: count("FAILED"),
    lines,
  };
}

export function renderNomusStockApplyCsv(lines: readonly NomusStockApplyLine[]): string {
  const columns: (keyof NomusStockApplyLine)[] = [
    "sku",
    "classificationBeforeApply",
    "finalAction",
    "inventoryItemId",
    "movementId",
    "warehouseCode",
    "quantity",
    "reason",
  ];
  const escape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [columns.join(","), ...lines.map((line) => columns.map((column) => escape(line[column])).join(","))].join("\n") + "\n";
}
