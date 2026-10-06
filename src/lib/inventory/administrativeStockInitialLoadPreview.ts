/**
 * Preview puro da carga inicial do Estoque Administrativo (CSV).
 * Não grava InventoryItem, Warehouse, saldo nem movimento.
 */
import { createHash } from "node:crypto";
import { unitsCompatible } from "./materialInventoryBalanceDiagnostic.js";
import { parseNomusPtBrNumber } from "../../../scripts/nomusNumberParser.js";

export const ADMINISTRATIVE_STOCK_WAREHOUSE_CODE = "ADMINISTRATIVO";
export const ADMINISTRATIVE_STOCK_WAREHOUSE_NAME = "Estoque Administrativo";
export const ADMINISTRATIVE_STOCK_ITEM_TYPE = "ADMINISTRATIVE_SUPPLY" as const;
export const ADMINISTRATIVE_STOCK_DEFAULT_FILE =
  "/tmp/cadastro_inicial_estoque_administrativo.csv";

export const ADMINISTRATIVE_STOCK_PREVIEW_CLASSIFICATIONS = [
  "CREATE",
  "ALREADY_EXISTS_MATCH",
  "CONFLICT",
  "INVALID",
] as const;

export type AdministrativeStockPreviewClassification =
  (typeof ADMINISTRATIVE_STOCK_PREVIEW_CLASSIFICATIONS)[number];

export class AdministrativeStockPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdministrativeStockPreviewError";
  }
}

export type AdministrativeStockCsvRow = {
  sourceRow: number;
  code: string;
  description: string;
  family: string | null;
  group: string | null;
  unit: string;
  minimumStock: number | null;
  maximumStock: number | null;
  reorderPoint: number | null;
  preferredSupplierName: string | null;
  lastKnownCost: number | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
  raw: Record<string, string>;
};

export type AdministrativeStockItemSnapshot = {
  id: string;
  code: string;
  description: string;
  itemType: string;
  unit: string;
  status: string;
  controlsStock: boolean;
  defaultWarehouseId: string | null;
  defaultLocationId: string | null;
};

export type AdministrativeStockWarehouseSnapshot = {
  id: string;
  code: string;
  name: string;
  status: string;
  allowsMovements: boolean;
};

export type AdministrativeStockPreviewRow = {
  sourceRow: number;
  code: string;
  description: string;
  unit: string;
  family: string | null;
  group: string | null;
  status: "ACTIVE" | "INACTIVE";
  classification: AdministrativeStockPreviewClassification;
  inventoryItemId: string | null;
  reason: string;
};

export type AdministrativeStockPreviewResult = {
  sha256: string;
  sourceFileName: string;
  rowsRead: number;
  validRows: number;
  invalidRows: number;
  createCount: number;
  alreadyExistsMatchCount: number;
  conflictCount: number;
  warehouse: "EXISTS" | "WILL_CREATE";
  warehouseSnapshot: AdministrativeStockWarehouseSnapshot | null;
  categories: string[];
  units: string[];
  blockingErrors: string[];
  rows: AdministrativeStockPreviewRow[];
  sourceRows: AdministrativeStockCsvRow[];
};

const REQUIRED_HEADERS = [
  "codigo",
  "descricao",
  "categoria",
  "subcategoria",
  "unidade_estoque",
  "estoque_minimo",
  "estoque_maximo",
  "ponto_reposicao",
  "fornecedor_preferencial",
  "custo_unitario_referencia",
  "observacao",
] as const;

/** Colunas do CSV que existem mas não entram no InventoryItem nesta etapa. */
export const ADMINISTRATIVE_STOCK_IGNORED_HEADERS = [
  "gtin_ean",
  "ncm",
  "marca_preferencial",
  "unidade_compra",
  "fator_conversao_compra",
  "permite_retirada",
] as const;

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** CSV UTF-8 (BOM), delimitador `;`, CRLF — parser simples com aspas. */
export function parseAdministrativeStockCsvText(text: string): {
  headers: string[];
  records: Array<Record<string, string>>;
} {
  const normalized = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]!;
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "\n" && !inQuotes) {
      lines.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || text.endsWith("\n") || text.endsWith("\r\n")) {
    lines.push(current);
  }
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (lines.length === 0) {
    throw new AdministrativeStockPreviewError("CSV vazio. Nada foi gravado.");
  }

  const splitLine = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
        continue;
      }
      if (ch === ";" && !quoted) {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
      cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  };

  const headerCells = splitLine(lines[0]!).map(normalizeHeader);
  if (headerCells.length === 0 || !headerCells[0]) {
    throw new AdministrativeStockPreviewError("Cabeçalho do CSV inválido. Nada foi gravado.");
  }
  const missing = REQUIRED_HEADERS.filter((header) => !headerCells.includes(header));
  if (missing.length > 0) {
    throw new AdministrativeStockPreviewError(
      `CSV sem colunas obrigatórias: ${missing.join(", ")}. Nada foi gravado.`
    );
  }

  const records: Array<Record<string, string>> = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const cells = splitLine(line);
    const record: Record<string, string> = {};
    for (let col = 0; col < headerCells.length; col += 1) {
      record[headerCells[col]!] = cells[col] ?? "";
    }
    records.push(record);
  }
  return { headers: headerCells, records };
}

export function sha256Hex(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseOptionalNumber(value: string): { ok: true; value: number | null } | { ok: false } {
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  if (typeof text === "string" && (text.startsWith("=") || text.includes("#"))) return { ok: false };
  const parsed = parseNomusPtBrNumber(text);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}

function parseStatus(raw: Record<string, string>): "ACTIVE" | "INACTIVE" {
  const candidates = [
    raw.status,
    raw.situacao,
    raw.ativo,
    raw.ativa,
    raw.item_status,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  for (const value of candidates) {
    if (["inactive", "inativo", "inativa", "0", "false", "n", "nao", "não"].includes(value)) {
      return "INACTIVE";
    }
    if (["active", "ativo", "ativa", "1", "true", "s", "sim"].includes(value)) {
      return "ACTIVE";
    }
  }
  return "ACTIVE";
}

export function mapAdministrativeStockCsvRecords(
  records: readonly Record<string, string>[],
  headerRowNumber = 1
): { rows: AdministrativeStockCsvRow[]; invalid: AdministrativeStockPreviewRow[] } {
  const rows: AdministrativeStockCsvRow[] = [];
  const invalid: AdministrativeStockPreviewRow[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const raw = records[index]!;
    const sourceRow = headerRowNumber + 1 + index;
    const code = String(raw.codigo ?? "").trim();
    const description = String(raw.descricao ?? "").trim();
    const unit = String(raw.unidade_estoque ?? "").trim();
    const family = String(raw.categoria ?? "").trim() || null;
    const group = String(raw.subcategoria ?? "").trim() || null;
    const preferredSupplierName = String(raw.fornecedor_preferencial ?? "").trim() || null;
    const notes = String(raw.observacao ?? "").trim() || null;
    const status = parseStatus(raw);

    const minimumStock = parseOptionalNumber(String(raw.estoque_minimo ?? ""));
    const maximumStock = parseOptionalNumber(String(raw.estoque_maximo ?? ""));
    const reorderPoint = parseOptionalNumber(String(raw.ponto_reposicao ?? ""));
    const lastKnownCost = parseOptionalNumber(String(raw.custo_unitario_referencia ?? ""));

    const reasons: string[] = [];
    if (!code) reasons.push("codigo ausente");
    if (!description) reasons.push("descricao ausente");
    if (!unit) reasons.push("unidade_estoque ausente");
    if (!minimumStock.ok) reasons.push("estoque_minimo inválido");
    if (!maximumStock.ok) reasons.push("estoque_maximo inválido");
    if (!reorderPoint.ok) reasons.push("ponto_reposicao inválido");
    if (!lastKnownCost.ok) reasons.push("custo_unitario_referencia inválido");

    if (reasons.length > 0) {
      invalid.push({
        sourceRow,
        code: code || `(linha ${sourceRow})`,
        description,
        unit,
        family,
        group,
        status,
        classification: "INVALID",
        inventoryItemId: null,
        reason: reasons.join("; "),
      });
      continue;
    }

    rows.push({
      sourceRow,
      code,
      description,
      family,
      group,
      unit,
      minimumStock: minimumStock.value,
      maximumStock: maximumStock.value,
      reorderPoint: reorderPoint.value,
      preferredSupplierName,
      lastKnownCost: lastKnownCost.value,
      notes,
      status,
      raw,
    });
  }

  return { rows, invalid };
}

function findItemByCode(
  items: readonly AdministrativeStockItemSnapshot[],
  code: string
): AdministrativeStockItemSnapshot[] {
  const needle = code.trim().toUpperCase();
  return items.filter((item) => item.code.trim().toUpperCase() === needle);
}

export function classifyAdministrativeStockPreview(input: {
  sourceRows: readonly AdministrativeStockCsvRow[];
  invalidRows?: readonly AdministrativeStockPreviewRow[];
  items: readonly AdministrativeStockItemSnapshot[];
  warehouse: AdministrativeStockWarehouseSnapshot | null;
  sha256: string;
  sourceFileName: string;
}): AdministrativeStockPreviewResult {
  const rows: AdministrativeStockPreviewRow[] = [...(input.invalidRows ?? [])];
  const blockingErrors: string[] = [];

  const codes = new Map<string, number>();
  for (const source of input.sourceRows) {
    const key = source.code.trim().toUpperCase();
    codes.set(key, (codes.get(key) ?? 0) + 1);
  }
  for (const [code, count] of codes) {
    if (count > 1) {
      blockingErrors.push(`Código duplicado no CSV: ${code} (${count} linhas).`);
    }
  }

  for (const source of input.sourceRows) {
    const matches = findItemByCode(input.items, source.code);
    if (matches.length === 0) {
      rows.push({
        sourceRow: source.sourceRow,
        code: source.code,
        description: source.description,
        unit: source.unit,
        family: source.family,
        group: source.group,
        status: source.status,
        classification: "CREATE",
        inventoryItemId: null,
        reason: "InventoryItem inexistente — será criado como ADMINISTRATIVE_SUPPLY.",
      });
      continue;
    }
    if (matches.length > 1) {
      rows.push({
        sourceRow: source.sourceRow,
        code: source.code,
        description: source.description,
        unit: source.unit,
        family: source.family,
        group: source.group,
        status: source.status,
        classification: "CONFLICT",
        inventoryItemId: null,
        reason: `Há ${matches.length} InventoryItem com o mesmo código.`,
      });
      continue;
    }
    const existing = matches[0]!;
    if (existing.itemType !== ADMINISTRATIVE_STOCK_ITEM_TYPE) {
      rows.push({
        sourceRow: source.sourceRow,
        code: source.code,
        description: source.description,
        unit: source.unit,
        family: source.family,
        group: source.group,
        status: source.status,
        classification: "CONFLICT",
        inventoryItemId: existing.id,
        reason: `itemType existente=${existing.itemType}; esperado=${ADMINISTRATIVE_STOCK_ITEM_TYPE}.`,
      });
      continue;
    }
    if (!unitsCompatible(existing.unit, source.unit)) {
      rows.push({
        sourceRow: source.sourceRow,
        code: source.code,
        description: source.description,
        unit: source.unit,
        family: source.family,
        group: source.group,
        status: source.status,
        classification: "CONFLICT",
        inventoryItemId: existing.id,
        reason: `unidade existente=${existing.unit}; CSV=${source.unit}.`,
      });
      continue;
    }
    rows.push({
      sourceRow: source.sourceRow,
      code: source.code,
      description: source.description,
      unit: source.unit,
      family: source.family,
      group: source.group,
      status: source.status,
      classification: "ALREADY_EXISTS_MATCH",
      inventoryItemId: existing.id,
      reason: "InventoryItem ADMINISTRATIVE_SUPPLY compatível — sem sobrescrita.",
    });
  }

  const createCount = rows.filter((row) => row.classification === "CREATE").length;
  const alreadyExistsMatchCount = rows.filter((row) => row.classification === "ALREADY_EXISTS_MATCH").length;
  const conflictCount = rows.filter((row) => row.classification === "CONFLICT").length;
  const invalidRows = rows.filter((row) => row.classification === "INVALID").length;
  const validRows = rows.length - invalidRows;

  if (conflictCount > 0) {
    blockingErrors.push(`${conflictCount} linha(s) em CONFLICT.`);
  }
  if (invalidRows > 0) {
    blockingErrors.push(`${invalidRows} linha(s) inválida(s).`);
  }

  const categories = [
    ...new Set(
      input.sourceRows
        .map((row) => row.family)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
    ),
  ];
  const units = [
    ...new Set(input.sourceRows.map((row) => row.unit.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"))),
  ];

  return {
    sha256: input.sha256,
    sourceFileName: input.sourceFileName,
    rowsRead: input.sourceRows.length + (input.invalidRows?.length ?? 0),
    validRows,
    invalidRows,
    createCount,
    alreadyExistsMatchCount,
    conflictCount,
    warehouse: input.warehouse ? "EXISTS" : "WILL_CREATE",
    warehouseSnapshot: input.warehouse,
    categories,
    units,
    blockingErrors,
    rows: rows.sort((a, b) => a.sourceRow - b.sourceRow),
    sourceRows: [...input.sourceRows],
  };
}

export function formatAdministrativeStockPreviewReport(result: AdministrativeStockPreviewResult): string {
  const lines = [
    "=== ADMINISTRATIVE STOCK INITIAL LOAD PREVIEW ===",
    `arquivo: ${result.sourceFileName}`,
    `sha256: ${result.sha256}`,
    `linhas lidas: ${result.rowsRead}`,
    `válidas: ${result.validRows}`,
    `inválidas: ${result.invalidRows}`,
    `CREATE: ${result.createCount}`,
    `ALREADY_EXISTS_MATCH: ${result.alreadyExistsMatchCount}`,
    `CONFLICT: ${result.conflictCount}`,
    `warehouse: ${result.warehouse}${
      result.warehouseSnapshot ? ` (${result.warehouseSnapshot.code} / ${result.warehouseSnapshot.name})` : ""
    }`,
    `categorias: ${result.categories.length ? result.categories.join(", ") : "(nenhuma)"}`,
    `unidades: ${result.units.length ? result.units.join(", ") : "(nenhuma)"}`,
    `erros impeditivos: ${result.blockingErrors.length ? result.blockingErrors.join(" | ") : "(nenhum)"}`,
    "",
    "Observação: PREVIEW não cria saldo, movimento nem altera MP/COMPONENTES/PA.",
  ];
  return lines.join("\n");
}

export function renderAdministrativeStockPreviewCsv(rows: readonly AdministrativeStockPreviewRow[]): string {
  const header = [
    "sourceRow",
    "code",
    "description",
    "unit",
    "family",
    "group",
    "status",
    "classification",
    "inventoryItemId",
    "reason",
  ];
  const escape = (value: string | null | undefined) => {
    const text = String(value ?? "");
    return /["\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    header.join(";"),
    ...rows.map((row) =>
      [
        row.sourceRow,
        row.code,
        row.description,
        row.unit,
        row.family,
        row.group,
        row.status,
        row.classification,
        row.inventoryItemId,
        row.reason,
      ]
        .map((cell) => escape(cell == null ? "" : String(cell)))
        .join(";")
    ),
  ].join("\r\n");
}

export function assertAdministrativeStockPreviewCommand(argv: readonly string[]): void {
  if (argv.some((token) => token === "apply" || token === "--apply" || token.startsWith("--apply="))) {
    throw new AdministrativeStockPreviewError("PREVIEW não grava e não aceita apply. Nada foi gravado.");
  }
}
