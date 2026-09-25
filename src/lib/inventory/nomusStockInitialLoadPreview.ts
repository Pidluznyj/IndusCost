/**
 * Preview puro da carga inicial de estoque Nomus (RelatorioPosicaoEstoqueEmpresa).
 * Não grava Product, Material, InventoryItem, movimento nem saldo.
 * A quantidade física é somente "Materiais nossos em nosso poder".
 */
import { parseNomusPtBrNumber } from "../../../scripts/nomusNumberParser.js";
import { unitsCompatible } from "./materialInventoryBalanceDiagnostic.js";

export const NOMUS_STOCK_PHYSICAL_HEADER = "Materiais nossos em nosso poder";

export const NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE = {
  PRODUCT: "PA",
  COMPONENT: "COMPONENTES",
} as const;

export const NOMUS_STOCK_PREVIEW_CLASSIFICATIONS = [
  "READY_CREATE_ITEM_AND_INITIAL_BALANCE",
  "READY_INITIAL_BALANCE",
  "ZERO_BALANCE_NO_ACTION",
  "NEGATIVE_STOCK_REVIEW",
  "PRODUCT_NOT_FOUND",
  "OUT_OF_SCOPE_PRODUCT_TYPE",
  "AMBIGUOUS_REPORT_IDENTITY",
  "INACTIVE_PRODUCT_REVIEW",
  "WAREHOUSE_UNAVAILABLE",
  "INVENTORY_ITEM_IDENTITY_CONFLICT",
  "INVENTORY_ITEM_TYPE_MISMATCH",
  "UNIT_MISSING",
  "UNIT_MISMATCH",
  "EXISTING_STOCK_REVIEW",
  "EXISTING_LEDGER_REVIEW",
  "QUANTITY_UNPARSEABLE",
  "SKU_MISSING",
] as const;

export type NomusStockPreviewClassification = (typeof NOMUS_STOCK_PREVIEW_CLASSIFICATIONS)[number];

const READY = new Set<NomusStockPreviewClassification>([
  "READY_CREATE_ITEM_AND_INITIAL_BALANCE",
  "READY_INITIAL_BALANCE",
]);

type ColumnRole =
  | "sku"
  | "description"
  | "unit"
  | "oursInOurPower"
  | "oursInThirdPower"
  | "thirdInOurPower"
  | "total";

/** Cabeçalhos nomeados pela carga. Igualdade após espaço, caixa e acento. Sem contains. */
const COLUMN_ALIASES: Record<ColumnRole, readonly string[]> = {
  sku: ["codigo do produto", "codigo"],
  description: ["descricao do produto", "descricao"],
  unit: ["u.m.", "um", "unidade"],
  oursInOurPower: ["materiais nossos em nosso poder"],
  oursInThirdPower: ["materiais nossos em poder de terceiros"],
  thirdInOurPower: ["materiais de terceiros em nosso poder"],
  total: ["total"],
};

const COLUMN_PREFERENCE: ColumnRole[] = [
  "oursInOurPower",
  "sku",
  "description",
  "unit",
  "oursInThirdPower",
  "thirdInOurPower",
  "total",
];

export type NomusStockHeaderColumn = {
  role: ColumnRole;
  header: string;
  index: number;
};

export type NomusStockHeaderMatch = {
  sheetName: string;
  headerRowNumber: number;
  physicalQuantityHeader: string;
  columns: NomusStockHeaderColumn[];
};

export class NomusStockPreviewError extends Error {
  readonly headersFound: string[];

  constructor(message: string, headersFound: string[] = []) {
    super(message);
    this.name = "NomusStockPreviewError";
    this.headersFound = headersFound;
  }
}

export function normalizeNomusHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeNomusSku(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeNomusDescription(value: unknown): string {
  return normalizeNomusHeader(value);
}

/** Vazio, fórmula, erro do Excel ou texto sem dígito não vira zero. Zero explícito continua zero. */
export function parseNomusStockQuantity(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.startsWith("=") || text.includes("#")) return null;
  const withoutUnit = text.replace(/\s+por\s+[A-Za-zÀ-ÿ.]+$/i, "").trim();
  if (!/^-?\d[\d.,]*$/.test(withoutUnit)) return null;
  const parsed = parseNomusPtBrNumber(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const POSITION_DATE_LABELS = new Set([
  "data da posicao",
  "data de posicao",
  "posicao em",
  "data de referencia",
  "data referencia",
]);

function calendarFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  return `${year}-${monthText}-${dayText}`;
}

/** Só aceita data calendário explícita. Número solto não vira data. Meia-noite UTC preserva o dia do Excel. */
export function parseUnambiguousCalendarDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const utcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    const year = utcMidnight ? value.getUTCFullYear() : value.getFullYear();
    const month = (utcMidnight ? value.getUTCMonth() : value.getMonth()) + 1;
    const day = utcMidnight ? value.getUTCDate() : value.getDate();
    return calendarFromParts(year, month, day);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return calendarFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (brazilian) return calendarFromParts(Number(brazilian[3]), Number(brazilian[2]), Number(brazilian[1]));
  return null;
}

/**
 * Procura uma data de posição só nas linhas de título, acima do cabeçalho.
 * Retorna null quando não há rótulo. Lança se o rótulo existe e a data não é única.
 */
export function findNomusStockPositionDate(
  matrix: readonly (readonly unknown[])[],
  headerRowNumber: number
): string | null {
  const dates = new Set<string>();
  let sawLabel = false;
  const titleLimit = Math.max(0, headerRowNumber - 1);
  for (let rowIndex = 0; rowIndex < titleLimit; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    for (let index = 0; index < row.length; index += 1) {
      const raw = String(row[index] ?? "").trim();
      if (!raw) continue;
      const normalized = normalizeNomusHeader(raw);
      const embedded = /^posicao em (\d{2}\/\d{2}\/\d{4})$/.exec(normalized);
      if (embedded) {
        sawLabel = true;
        const parsed = parseUnambiguousCalendarDate(embedded[1]);
        if (!parsed) {
          throw new NomusStockPreviewError("Data de posição ilegível. APPLY foi interrompido.");
        }
        dates.add(parsed);
        continue;
      }
      if (!POSITION_DATE_LABELS.has(normalized)) continue;
      sawLabel = true;
      const parsed = parseUnambiguousCalendarDate(row[index + 1]);
      if (!parsed) {
        throw new NomusStockPreviewError(
          "Há rótulo de data de posição sem uma data inequívoca ao lado. APPLY foi interrompido."
        );
      }
      dates.add(parsed);
    }
  }
  if (!sawLabel) return null;
  if (dates.size !== 1) {
    throw new NomusStockPreviewError("A planilha tem mais de uma data de posição. APPLY foi interrompido.");
  }
  return [...dates][0] ?? null;
}

export function assertNomusStockPreviewCommand(argv: readonly string[]): void {
  const tokens = argv.map((token) => token.trim().toLowerCase());
  const blocked = tokens.some(
    (token) => token === "apply" || token === "--apply" || token.startsWith("--apply=")
  );
  if (blocked) {
    throw new NomusStockPreviewError(
      "O comando preview não grava. APPLY só roda no comando apply, com --actorUserId e --confirm=NOMUS_INITIAL_STOCK_LOAD."
    );
  }
}

export function locateNomusStockHeaders(
  matrix: readonly (readonly unknown[])[],
  sheetName: string
): NomusStockHeaderMatch {
  let headerRowIndex = -1;
  let headersFound: string[] = [];
  const scanLimit = Math.min(matrix.length, 40);
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const labels = row.map((cell) => String(cell ?? "").trim()).filter((cell) => cell.length > 0);
    const normalized = row.map((cell) => normalizeNomusHeader(cell));
    if (normalized.includes(COLUMN_ALIASES.oursInOurPower[0]!)) {
      headerRowIndex = rowIndex;
      headersFound = labels;
      break;
    }
    if (labels.length > headersFound.length) headersFound = labels;
  }

  if (headerRowIndex < 0) {
    throw new NomusStockPreviewError(
      `Coluna física "${NOMUS_STOCK_PHYSICAL_HEADER}" não encontrada. A leitura foi interrompida sem escolher outra coluna.`,
      headersFound
    );
  }
  const physicalLabel = COLUMN_ALIASES.oursInOurPower[0]!;
  const physicalHits = (matrix[headerRowIndex] ?? []).filter(
    (cell) => normalizeNomusHeader(cell) === physicalLabel
  );
  if (physicalHits.length !== 1) {
    throw new NomusStockPreviewError(
      `A coluna física "${NOMUS_STOCK_PHYSICAL_HEADER}" aparece ${physicalHits.length} vezes. A leitura foi interrompida.`,
      headersFound
    );
  }

  const headerRow = matrix[headerRowIndex] ?? [];
  const used = new Set<number>();
  const columns: NomusStockHeaderColumn[] = [];
  for (const role of COLUMN_PREFERENCE) {
    const aliases = new Set(COLUMN_ALIASES[role]);
    let foundIndex = -1;
    let foundHeader = "";
    for (let index = 0; index < headerRow.length; index += 1) {
      if (used.has(index)) continue;
      const raw = String(headerRow[index] ?? "").trim();
      if (!raw) continue;
      if (!aliases.has(normalizeNomusHeader(raw))) continue;
      foundIndex = index;
      foundHeader = raw;
      break;
    }
    if (foundIndex >= 0) {
      used.add(foundIndex);
      columns.push({ role, header: foundHeader, index: foundIndex });
    }
  }

  const physical = columns.find((column) => column.role === "oursInOurPower");
  const sku = columns.find((column) => column.role === "sku");
  if (!physical) {
    throw new NomusStockPreviewError(
      `Coluna física "${NOMUS_STOCK_PHYSICAL_HEADER}" não encontrada. A leitura foi interrompida sem escolher outra coluna.`,
      headersFound
    );
  }
  if (!sku) {
    throw new NomusStockPreviewError(
      "Coluna de código do produto não encontrada. Cabeçalhos aceitos após normalização: codigo do produto, codigo.",
      headerRow.map((cell) => String(cell ?? "").trim()).filter(Boolean)
    );
  }

  return {
    sheetName,
    headerRowNumber: headerRowIndex + 1,
    physicalQuantityHeader: physical.header,
    columns,
  };
}

export type NomusStockSourceRow = {
  sourceRow: number;
  sku: string;
  description: string;
  unit: string;
  oursInOurPower: number | null;
  oursInThirdPower: number | null;
  thirdInOurPower: number | null;
  total: number | null;
};

function cell(row: readonly unknown[], columns: NomusStockHeaderColumn[], role: ColumnRole): unknown {
  const column = columns.find((item) => item.role === role);
  if (!column) return null;
  return row[column.index] ?? null;
}

export function readNomusStockRows(
  matrix: readonly (readonly unknown[])[],
  header: NomusStockHeaderMatch
): NomusStockSourceRow[] {
  const rows: NomusStockSourceRow[] = [];
  for (let index = header.headerRowNumber; index < matrix.length; index += 1) {
    const raw = matrix[index] ?? [];
    const hasContent = raw.some((value) => String(value ?? "").trim() !== "");
    if (!hasContent) continue;
    rows.push({
      sourceRow: index + 1,
      sku: normalizeNomusSku(cell(raw, header.columns, "sku")),
      description: String(cell(raw, header.columns, "description") ?? "").trim(),
      unit: String(cell(raw, header.columns, "unit") ?? "").trim(),
      oursInOurPower: parseNomusStockQuantity(cell(raw, header.columns, "oursInOurPower")),
      oursInThirdPower: parseNomusStockQuantity(cell(raw, header.columns, "oursInThirdPower")),
      thirdInOurPower: parseNomusStockQuantity(cell(raw, header.columns, "thirdInOurPower")),
      total: parseNomusStockQuantity(cell(raw, header.columns, "total")),
    });
  }
  return rows;
}

export type NomusStockGroupedSku = {
  sku: string;
  skuKey: string;
  ambiguous: boolean;
  rows: NomusStockSourceRow[];
  description: string;
  unit: string;
  oursInOurPower: number | null;
};

function skuKey(sku: string): string {
  return sku.trim().toLocaleUpperCase("pt-BR");
}

export function groupNomusStockRows(rows: readonly NomusStockSourceRow[]): NomusStockGroupedSku[] {
  const groups = new Map<string, NomusStockSourceRow[]>();
  for (const row of rows) {
    const key = row.sku ? skuKey(row.sku) : `__EMPTY__:${row.sourceRow}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const grouped: NomusStockGroupedSku[] = [];
  for (const [key, bucket] of groups) {
    const descriptions = new Set(bucket.map((row) => normalizeNomusDescription(row.description)));
    const units = bucket.map((row) => row.unit.trim());
    const unitConflict = units.some((unit, index) =>
      units.slice(index + 1).some((other) => {
        if (!unit && !other) return false;
        if (!unit || !other) return true;
        return !unitsCompatible(unit, other);
      })
    );
    const ambiguous = Boolean(bucket[0]?.sku) && (descriptions.size > 1 || unitConflict);
    const quantities = bucket.map((row) => row.oursInOurPower);
    const quantity = ambiguous
      ? null
      : quantities.some((value) => value == null)
        ? null
        : quantities.reduce((sum, value) => (sum ?? 0) + (value ?? 0), 0);
    grouped.push({
      sku: bucket[0]?.sku ?? "",
      skuKey: key,
      ambiguous,
      rows: bucket,
      description: bucket[0]?.description ?? "",
      unit: bucket[0]?.unit ?? "",
      oursInOurPower: quantity,
    });
  }
  return grouped;
}

export type NomusStockProductSnapshot = {
  id: string;
  sku: string;
  name: string;
  type: string;
  status: string | null;
  sourceExternalId?: string | null;
};

export type NomusStockItemSnapshot = {
  id: string;
  code: string;
  productId: string | null;
  materialId: string | null;
  itemType: string;
  unit: string;
  nomusProductCode: string | null;
};

export type NomusStockWarehouseSnapshot = {
  id: string;
  code: string;
  status: string;
  allowsMovements: boolean;
};

export type NomusStockBalanceSnapshot = {
  itemId: string;
  warehouseId: string;
  physicalQuantity: number;
  availableQuantity: number;
  reservedQuantity?: number;
  blockedQuantity?: number;
  quarantineQuantity?: number;
  locationId?: string | null;
};

export type NomusStockMovementSnapshot = {
  id: string;
  itemId: string;
  movementType: string;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  reversedMovementId: string | null;
  quantity?: number | null;
  evidenceRef?: string | null;
  documentNumber?: string | null;
  reason?: string | null;
  unit?: string | null;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  movementDate?: string | null;
};

export type NomusStockPreviewRow = {
  sku: string;
  descriptionNomus: string;
  unitNomus: string;
  nomusQuantity: number | null;
  productId: string;
  productName: string;
  productType: string;
  productStatus: string;
  inventoryItemId: string;
  inventoryItemType: string;
  inventoryUnit: string;
  warehouseCode: string;
  physicalQuantity: number | null;
  availableQuantity: number | null;
  difference: number | null;
  movementCount: number;
  initialBalanceCount: number;
  activeInitialBalanceExists: boolean;
  classification: NomusStockPreviewClassification;
  reason: string;
  sourceRows: number[];
  projected: boolean;
};

export type NomusStockPreviewSummary = {
  xlsRows: number;
  uniqueSkus: number;
  zeroQuantity: number;
  positiveQuantity: number;
  negativeQuantity: number;
  productsFound: number;
  productsNotFound: number;
  productsProduct: number;
  productsComponent: number;
  existingInventoryItems: number;
  inventoryItemsToCreate: number;
  counts: Record<NomusStockPreviewClassification, number>;
  totalBlocked: number;
  totalReady: number;
};

function emptyCounts(): Record<NomusStockPreviewClassification, number> {
  return Object.fromEntries(NOMUS_STOCK_PREVIEW_CLASSIFICATIONS.map((status) => [status, 0])) as Record<
    NomusStockPreviewClassification,
    number
  >;
}

function sameSku(left: string | null | undefined, right: string): boolean {
  return (left ?? "").trim().toLocaleUpperCase("pt-BR") === right.trim().toLocaleUpperCase("pt-BR");
}

function isZeroQuantity(value: number): boolean {
  return Math.abs(value) < 5e-7;
}

function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function findProduct(
  products: readonly NomusStockProductSnapshot[],
  sku: string
): { product: NomusStockProductSnapshot | null; ambiguous: boolean } {
  const exact = products.filter((product) => product.sku.trim() === sku.trim());
  if (exact.length === 1) return { product: exact[0]!, ambiguous: false };
  if (exact.length > 1) return { product: null, ambiguous: true };
  const folded = products.filter((product) => sameSku(product.sku, sku));
  if (folded.length === 1) return { product: folded[0]!, ambiguous: false };
  if (folded.length > 1) return { product: null, ambiguous: true };
  return { product: null, ambiguous: false };
}

function resolveInventoryItem(
  product: NomusStockProductSnapshot,
  sku: string,
  items: readonly NomusStockItemSnapshot[]
): { item: NomusStockItemSnapshot | null; conflict: string | null } {
  const byProduct = items.filter((item) => item.productId === product.id);
  const byCode = items.filter((item) => sameSku(item.code, sku));
  const byNomusCode = items.filter((item) => item.nomusProductCode && sameSku(item.nomusProductCode, sku));

  if (byProduct.length > 1) {
    return { item: null, conflict: "Mais de um InventoryItem vinculado a este Product." };
  }
  if (byProduct.length === 1) {
    const item = byProduct[0]!;
    if (item.materialId) {
      return { item: null, conflict: "InventoryItem do Product também está ligado a uma matéria-prima." };
    }
    if (byCode.some((other) => other.id !== item.id)) {
      return { item: null, conflict: "Outro InventoryItem usa o mesmo código sem ser este Product." };
    }
    if (byNomusCode.some((other) => other.id !== item.id && (other.materialId || (other.productId && other.productId !== product.id)))) {
      return { item: null, conflict: "nomusProductCode aponta para outro item de identidade diferente." };
    }
    return { item, conflict: null };
  }

  if (byCode.some((item) => item.materialId)) {
    return { item: null, conflict: "InventoryItem com o mesmo código está ligado a matéria-prima." };
  }
  if (byCode.some((item) => item.productId && item.productId !== product.id)) {
    return { item: null, conflict: "InventoryItem com o mesmo código está ligado a outro Product." };
  }
  if (byCode.length > 0) {
    return {
      item: null,
      conflict: "InventoryItem com o mesmo código não está vinculado a este Product.",
    };
  }
  if (byNomusCode.length > 0) {
    return {
      item: null,
      conflict: "nomusProductCode encontra item que não está vinculado a este Product.",
    };
  }
  return { item: null, conflict: null };
}

function blankRow(partial: Partial<NomusStockPreviewRow> & Pick<NomusStockPreviewRow, "sku" | "classification" | "reason" | "sourceRows">): NomusStockPreviewRow {
  return {
    descriptionNomus: "",
    unitNomus: "",
    nomusQuantity: null,
    productId: "",
    productName: "",
    productType: "",
    productStatus: "",
    inventoryItemId: "",
    inventoryItemType: "",
    inventoryUnit: "",
    warehouseCode: "",
    physicalQuantity: null,
    availableQuantity: null,
    difference: null,
    movementCount: 0,
    initialBalanceCount: 0,
    activeInitialBalanceExists: false,
    projected: false,
    ...partial,
  };
}

function displayProduct(
  products: readonly NomusStockProductSnapshot[],
  sku: string
): Partial<NomusStockPreviewRow> {
  const match = findProduct(products, sku);
  if (!match.product || match.ambiguous) return {};
  return {
    productId: match.product.id,
    productName: match.product.name,
    productType: match.product.type,
    productStatus: match.product.status ?? "",
  };
}

function warehouseForProduct(
  productType: string,
  warehouses: readonly NomusStockWarehouseSnapshot[]
): { code: string; warehouse: NomusStockWarehouseSnapshot | null } {
  const code =
    productType === "PRODUCT"
      ? NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.PRODUCT
      : productType === "COMPONENT"
        ? NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.COMPONENT
        : "";
  if (!code) return { code: "", warehouse: null };
  const matches = warehouses.filter((warehouse) => sameSku(warehouse.code, code));
  return { code, warehouse: matches.length === 1 ? matches[0]! : null };
}

export function classifyNomusStockPreview(input: {
  sourceRows: readonly NomusStockSourceRow[];
  products: readonly NomusStockProductSnapshot[];
  items: readonly NomusStockItemSnapshot[];
  warehouses: readonly NomusStockWarehouseSnapshot[];
  balances: readonly NomusStockBalanceSnapshot[];
  movements: readonly NomusStockMovementSnapshot[];
}): { rows: NomusStockPreviewRow[]; summary: NomusStockPreviewSummary } {
  const groups = groupNomusStockRows(input.sourceRows);
  const reversedInitialIds = new Set(
    input.movements
      .filter((movement) => movement.movementType === "REVERSAL" && movement.reversedMovementId)
      .map((movement) => movement.reversedMovementId as string)
  );
  const rows: NomusStockPreviewRow[] = [];

  for (const group of groups) {
    if (!group.sku) {
      for (const source of group.rows) {
        rows.push(
          blankRow({
            sku: "",
            descriptionNomus: source.description,
            unitNomus: source.unit,
            nomusQuantity: source.oursInOurPower,
            classification: "SKU_MISSING",
            reason: `Linha ${source.sourceRow} sem código de produto.`,
            sourceRows: [source.sourceRow],
          })
        );
      }
      continue;
    }

    if (group.ambiguous) {
      const detail = group.rows
        .map((source) => `linha ${source.sourceRow}: "${source.description}" / ${source.unit || "sem U.M."}`)
        .join("; ");
      for (const source of group.rows) {
        rows.push(
          blankRow({
            sku: source.sku,
            descriptionNomus: source.description,
            unitNomus: source.unit,
            nomusQuantity: source.oursInOurPower,
            classification: "AMBIGUOUS_REPORT_IDENTITY",
            reason: `Mesmo SKU com descrição ou unidade divergente. Não agregar. ${detail}`,
            sourceRows: group.rows.map((row) => row.sourceRow),
          })
        );
      }
      continue;
    }

    const quantity = group.oursInOurPower;
    const sourceRows = group.rows.map((row) => row.sourceRow);
    const base = {
      sku: group.sku,
      descriptionNomus: group.description,
      unitNomus: group.unit,
      sourceRows,
    };

    if (quantity == null) {
      rows.push(
        blankRow({
          ...base,
          nomusQuantity: null,
          classification: "QUANTITY_UNPARSEABLE",
          reason: `Quantidade em "${NOMUS_STOCK_PHYSICAL_HEADER}" ausente ou ilegível nas linhas ${sourceRows.join(", ")}.`,
        })
      );
      continue;
    }

    const nomusQuantity = roundQuantity(quantity);
    const knownProduct = displayProduct(input.products, group.sku);
    if (nomusQuantity < 0) {
      rows.push(
        blankRow({
          ...base,
          ...knownProduct,
          nomusQuantity,
          classification: "NEGATIVE_STOCK_REVIEW",
          reason: "Quantidade física Nomus negativa. Não há proposta de INITIAL_BALANCE.",
        })
      );
      continue;
    }
    if (isZeroQuantity(nomusQuantity)) {
      rows.push(
        blankRow({
          ...base,
          ...knownProduct,
          nomusQuantity: 0,
          classification: "ZERO_BALANCE_NO_ACTION",
          reason: "Quantidade física Nomus igual a zero.",
        })
      );
      continue;
    }

    const productMatch = findProduct(input.products, group.sku);
    if (productMatch.ambiguous) {
      rows.push(
        blankRow({
          ...base,
          nomusQuantity,
          classification: "PRODUCT_NOT_FOUND",
          reason: "Mais de um Product corresponde ao SKU quando se ignora maiúsculas.",
        })
      );
      continue;
    }
    const product = productMatch.product;
    if (!product) {
      rows.push(
        blankRow({
          ...base,
          nomusQuantity,
          classification: "PRODUCT_NOT_FOUND",
          reason: "Nenhum Product com este SKU.",
        })
      );
      continue;
    }

    const productFields = {
      productId: product.id,
      productName: product.name,
      productType: product.type,
      productStatus: product.status ?? "",
    };
    if (product.type !== "PRODUCT" && product.type !== "COMPONENT") {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          nomusQuantity,
          classification: "OUT_OF_SCOPE_PRODUCT_TYPE",
          reason: `Product.type ${product.type} está fora desta carga. Matéria-prima não entra.`,
        })
      );
      continue;
    }
    if ((product.status ?? "").trim().toUpperCase() !== "ACTIVE") {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          nomusQuantity,
          classification: "INACTIVE_PRODUCT_REVIEW",
          reason: `Product.status "${product.status ?? ""}" não está ACTIVE.`,
        })
      );
      continue;
    }

    const warehousePick = warehouseForProduct(product.type, input.warehouses);
    const warehouse = warehousePick.warehouse;
    if (!warehouse || warehouse.status !== "ACTIVE" || !warehouse.allowsMovements) {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          nomusQuantity,
          warehouseCode: warehousePick.code,
          classification: "WAREHOUSE_UNAVAILABLE",
          reason: warehouse
            ? `Almoxarifado ${warehouse.code} não está ACTIVE ou não permite movimentação.`
            : `Almoxarifado ${warehousePick.code} não encontrado.`,
        })
      );
      continue;
    }

    const itemPick = resolveInventoryItem(product, group.sku, input.items);
    if (itemPick.conflict) {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          nomusQuantity,
          warehouseCode: warehouse.code,
          classification: "INVENTORY_ITEM_IDENTITY_CONFLICT",
          reason: itemPick.conflict,
        })
      );
      continue;
    }

    const expectedType = product.type === "PRODUCT" ? "FINISHED_PRODUCT" : "COMPONENT";
    const item = itemPick.item;
    if (item && item.itemType !== expectedType) {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          nomusQuantity,
          inventoryItemId: item.id,
          inventoryItemType: item.itemType,
          inventoryUnit: item.unit,
          warehouseCode: warehouse.code,
          classification: "INVENTORY_ITEM_TYPE_MISMATCH",
          reason: `InventoryItem ${item.itemType} não corresponde a Product.type ${product.type} (${expectedType}). O tipo não seria alterado.`,
        })
      );
      continue;
    }

    if (!group.unit.trim()) {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          nomusQuantity,
          inventoryItemId: item?.id ?? "",
          inventoryItemType: item?.itemType ?? expectedType,
          inventoryUnit: item?.unit ?? "",
          warehouseCode: warehouse.code,
          classification: "UNIT_MISSING",
          reason: "U.M. do relatório está vazia.",
        })
      );
      continue;
    }

    if (item && !unitsCompatible(item.unit, group.unit)) {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          nomusQuantity,
          inventoryItemId: item.id,
          inventoryItemType: item.itemType,
          inventoryUnit: item.unit,
          warehouseCode: warehouse.code,
          classification: "UNIT_MISMATCH",
          reason: `Unidade do item (${item.unit}) difere da U.M. Nomus (${group.unit}). Sem conversão.`,
        })
      );
      continue;
    }

    if (!item) {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          nomusQuantity,
          inventoryItemType: expectedType,
          warehouseCode: warehouse.code,
          physicalQuantity: 0,
          availableQuantity: 0,
          difference: nomusQuantity,
          classification: "READY_CREATE_ITEM_AND_INITIAL_BALANCE",
          reason: "Projeção: não existe InventoryItem. Saldo atual tratado como zero; nada foi criado.",
          projected: true,
        })
      );
      continue;
    }

    const itemBalances = input.balances.filter(
      (balance) => balance.itemId === item.id && balance.warehouseId === warehouse.id
    );
    const physicalQuantity = roundQuantity(
      itemBalances.reduce((sum, balance) => sum + balance.physicalQuantity, 0)
    );
    const availableQuantity = roundQuantity(
      itemBalances.reduce((sum, balance) => sum + balance.availableQuantity, 0)
    );
    const itemMovements = input.movements.filter(
      (movement) =>
        movement.itemId === item.id &&
        (movement.destinationWarehouseId === warehouse.id || movement.sourceWarehouseId === warehouse.id)
    );
    const initialBalances = itemMovements.filter((movement) => movement.movementType === "INITIAL_BALANCE");
    const stockFields = {
      inventoryItemId: item.id,
      inventoryItemType: item.itemType,
      inventoryUnit: item.unit,
      warehouseCode: warehouse.code,
      physicalQuantity,
      availableQuantity,
      difference: roundQuantity(nomusQuantity - physicalQuantity),
      movementCount: itemMovements.length,
      initialBalanceCount: initialBalances.length,
      activeInitialBalanceExists: initialBalances.some((movement) => !reversedInitialIds.has(movement.id)),
    };

    if (itemBalances.some((balance) => !isZeroQuantity(balance.physicalQuantity))) {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          ...stockFields,
          nomusQuantity,
          classification: "EXISTING_STOCK_REVIEW",
          reason: "Já existe saldo físico diferente de zero no almoxarifado de destino.",
        })
      );
      continue;
    }
    if (itemMovements.length > 0 || initialBalances.some((movement) => !reversedInitialIds.has(movement.id))) {
      rows.push(
        blankRow({
          ...base,
          ...productFields,
          ...stockFields,
          nomusQuantity,
          classification: "EXISTING_LEDGER_REVIEW",
          reason: "Item já possui histórico no almoxarifado. INITIAL_BALANCE automático não será proposto.",
        })
      );
      continue;
    }

    rows.push(
      blankRow({
        ...base,
        ...productFields,
        ...stockFields,
        nomusQuantity,
        classification: "READY_INITIAL_BALANCE",
        reason: "Item existente, saldo físico zero e sem movimento no almoxarifado de destino.",
      })
    );
  }

  return { rows, summary: summarizeNomusStockPreview(input.sourceRows.length, rows) };
}

export function summarizeNomusStockPreview(
  xlsRows: number,
  rows: readonly NomusStockPreviewRow[]
): NomusStockPreviewSummary {
  const counts = emptyCounts();
  for (const row of rows) counts[row.classification] += 1;
  const uniqueSkus = new Set(rows.map((row) => row.sku.trim().toLocaleUpperCase("pt-BR")).filter(Boolean));
  let zeroQuantity = 0;
  let positiveQuantity = 0;
  let negativeQuantity = 0;
  for (const row of rows) {
    if (row.nomusQuantity == null) continue;
    if (row.nomusQuantity < 0) negativeQuantity += 1;
    else if (isZeroQuantity(row.nomusQuantity)) zeroQuantity += 1;
    else positiveQuantity += 1;
  }
  const found = rows.filter((row) => row.productId);
  const distinctFound = new Set(found.map((row) => row.productId));
  const totalReady = counts.READY_CREATE_ITEM_AND_INITIAL_BALANCE + counts.READY_INITIAL_BALANCE;
  const totalBlocked = rows.length - totalReady - counts.ZERO_BALANCE_NO_ACTION;
  return {
    xlsRows,
    uniqueSkus: uniqueSkus.size,
    zeroQuantity,
    positiveQuantity,
    negativeQuantity,
    productsFound: distinctFound.size,
    productsNotFound: counts.PRODUCT_NOT_FOUND,
    productsProduct: found.filter((row) => row.productType === "PRODUCT").length,
    productsComponent: found.filter((row) => row.productType === "COMPONENT").length,
    existingInventoryItems: rows.filter((row) => row.inventoryItemId).length,
    inventoryItemsToCreate: counts.READY_CREATE_ITEM_AND_INITIAL_BALANCE,
    counts,
    totalBlocked,
    totalReady,
  };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const CSV_COLUMNS: (keyof NomusStockPreviewRow)[] = [
  "sku",
  "descriptionNomus",
  "unitNomus",
  "nomusQuantity",
  "productId",
  "productName",
  "productType",
  "productStatus",
  "inventoryItemId",
  "inventoryItemType",
  "inventoryUnit",
  "warehouseCode",
  "physicalQuantity",
  "availableQuantity",
  "difference",
  "movementCount",
  "initialBalanceCount",
  "classification",
  "reason",
];

export function renderNomusStockPreviewCsv(rows: readonly NomusStockPreviewRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function formatNomusStockPreviewReport(input: {
  filePath: string;
  sha256: string;
  generatedAt: string;
  header: NomusStockHeaderMatch;
  summary: NomusStockPreviewSummary;
}): string {
  const counts = input.summary.counts;
  const lines = [
    "=== NOMUS STOCK INITIAL LOAD PREVIEW ===",
    `arquivo: ${input.filePath}`,
    `sha256: ${input.sha256}`,
    `data/hora: ${input.generatedAt}`,
    `sheet: ${input.header.sheetName}`,
    `coluna física utilizada: ${input.header.physicalQuantityHeader}`,
    `linha do cabeçalho: ${input.header.headerRowNumber}`,
    "",
    `Linhas XLS: ${input.summary.xlsRows}`,
    `SKUs únicos: ${input.summary.uniqueSkus}`,
    `Quantidade zero: ${input.summary.zeroQuantity}`,
    `Quantidade positiva: ${input.summary.positiveQuantity}`,
    `Quantidade negativa: ${input.summary.negativeQuantity}`,
    "",
    `Products encontrados: ${input.summary.productsFound}`,
    `Products não encontrados: ${input.summary.productsNotFound}`,
    `Products PRODUCT: ${input.summary.productsProduct}`,
    `Products COMPONENT: ${input.summary.productsComponent}`,
    "",
    `InventoryItems existentes: ${input.summary.existingInventoryItems}`,
    `InventoryItems a criar: ${input.summary.inventoryItemsToCreate}`,
    "",
    `READY_CREATE_ITEM_AND_INITIAL_BALANCE: ${counts.READY_CREATE_ITEM_AND_INITIAL_BALANCE}`,
    `READY_INITIAL_BALANCE: ${counts.READY_INITIAL_BALANCE}`,
    `ZERO_BALANCE_NO_ACTION: ${counts.ZERO_BALANCE_NO_ACTION}`,
    `NEGATIVE_STOCK_REVIEW: ${counts.NEGATIVE_STOCK_REVIEW}`,
    `PRODUCT_NOT_FOUND: ${counts.PRODUCT_NOT_FOUND}`,
    `OUT_OF_SCOPE_PRODUCT_TYPE: ${counts.OUT_OF_SCOPE_PRODUCT_TYPE}`,
    `AMBIGUOUS_REPORT_IDENTITY: ${counts.AMBIGUOUS_REPORT_IDENTITY}`,
    `INACTIVE_PRODUCT_REVIEW: ${counts.INACTIVE_PRODUCT_REVIEW}`,
    `WAREHOUSE_UNAVAILABLE: ${counts.WAREHOUSE_UNAVAILABLE}`,
    `INVENTORY_ITEM_IDENTITY_CONFLICT: ${counts.INVENTORY_ITEM_IDENTITY_CONFLICT}`,
    `INVENTORY_ITEM_TYPE_MISMATCH: ${counts.INVENTORY_ITEM_TYPE_MISMATCH}`,
    `UNIT_MISSING: ${counts.UNIT_MISSING}`,
    `UNIT_MISMATCH: ${counts.UNIT_MISMATCH}`,
    `EXISTING_STOCK_REVIEW: ${counts.EXISTING_STOCK_REVIEW}`,
    `EXISTING_LEDGER_REVIEW: ${counts.EXISTING_LEDGER_REVIEW}`,
    `QUANTITY_UNPARSEABLE: ${counts.QUANTITY_UNPARSEABLE}`,
    `SKU_MISSING: ${counts.SKU_MISSING}`,
    "",
    `TOTAL BLOCKED / MANUAL REVIEW: ${input.summary.totalBlocked}`,
    `TOTAL READY: ${input.summary.totalReady}`,
    "",
    "Nenhum Product, Material, InventoryItem, movimento ou saldo foi gravado.",
  ];
  return lines.join("\n");
}
