/**
 * Setores de estoque (Estoque → Setores / Collector) — frontend puro.
 *
 * Estado do formulário, sugestões (código / slug / prefixo a partir do nome),
 * validação de tela e montagem do payload. A autoridade é sempre o servidor
 * (POST/PATCH /api/inventory/stock-sectors); aqui só se evita viagem inútil e
 * se explica o erro ao lado do campo.
 */
import { COLLECTOR_SECTORS } from "@/src/lib/inventory/collector/collectorSectorContract";
import { formatInventoryItemType } from "@/src/components/inventory/inventoryItemLabels";

export type StockSectorRow = {
  id: string;
  code: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE";
  warehouseId: string;
  strategy: string;
  itemType: string | null;
  sessionCodePrefix: string;
  allowsCounting: boolean;
  allowsWithdrawal: boolean;
  defaultCostCenterId: string | null;
  warehouse: { id: string; code: string; name: string; status: string };
  defaultCostCenter: { id: string; code: string; name: string; isActive: boolean } | null;
};

export type StockSectorFormOptions = {
  strategies: string[];
  itemTypes: { itemType: string; requiresCostCenter: boolean }[];
  warehouses: { id: string; code: string; name: string }[];
  costCenters: { id: string; code: string; name: string }[];
};

export const EMPTY_STOCK_SECTOR_FORM_OPTIONS: StockSectorFormOptions = {
  strategies: ["STANDARD"],
  itemTypes: [],
  warehouses: [],
  costCenters: [],
};

export type StockSectorWarehouseMode = "existing" | "new";

export type StockSectorFormState = {
  name: string;
  code: string;
  slug: string;
  sessionCodePrefix: string;
  strategy: "STANDARD";
  itemType: string;
  warehouseMode: StockSectorWarehouseMode;
  warehouseId: string;
  newWarehouseCode: string;
  newWarehouseName: string;
  newWarehouseDescription: string;
  defaultCostCenterId: string;
  allowsCounting: boolean;
  allowsWithdrawal: boolean;
  status: "ACTIVE" | "INACTIVE";
  /** Campos que o usuário já editou à mão — sugestões param de sobrescrevê-los. */
  touched: { code: boolean; slug: boolean; sessionCodePrefix: boolean };
};

export function createEmptyStockSectorForm(): StockSectorFormState {
  return {
    name: "",
    code: "",
    slug: "",
    sessionCodePrefix: "",
    strategy: "STANDARD",
    itemType: "",
    warehouseMode: "existing",
    warehouseId: "",
    newWarehouseCode: "",
    newWarehouseName: "",
    newWarehouseDescription: "",
    defaultCostCenterId: "",
    allowsCounting: true,
    allowsWithdrawal: true,
    status: "ACTIVE",
    touched: { code: false, slug: false, sessionCodePrefix: false },
  };
}

export function stockSectorFormFromRow(row: StockSectorRow): StockSectorFormState {
  return {
    ...createEmptyStockSectorForm(),
    name: row.name,
    code: row.code,
    slug: row.slug,
    sessionCodePrefix: row.sessionCodePrefix,
    itemType: row.itemType ?? "",
    warehouseMode: "existing",
    warehouseId: row.warehouseId,
    defaultCostCenterId: row.defaultCostCenterId ?? "",
    allowsCounting: row.allowsCounting,
    allowsWithdrawal: row.allowsWithdrawal,
    status: row.status,
    touched: { code: true, slug: true, sessionCodePrefix: true },
  };
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "Estoque Administrativo" → "ESTOQUE_ADMINISTRATIVO". */
export function suggestStockSectorCode(name: string): string {
  return stripAccents(name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "S$1")
    .slice(0, 64);
}

/** "Estoque Administrativo" → "estoque-administrativo". */
export function suggestStockSectorSlug(name: string): string {
  return stripAccents(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const LEGACY_PREFIXES = new Set<string>(
  Object.values(COLLECTOR_SECTORS).map((sector) => sector.sessionCodePrefix)
);
const LEGACY_SLUGS = new Set<string>(Object.values(COLLECTOR_SECTORS).map((sector) => sector.slug));
const LEGACY_CODES = new Set<string>(Object.keys(COLLECTOR_SECTORS));

/** Três primeiras letras do nome; evita os prefixos reservados (MP/CP/PA). */
export function suggestStockSectorPrefix(name: string): string {
  const letters = stripAccents(name).toUpperCase().replace(/[^A-Z]/g, "");
  const candidate = letters.slice(0, 3);
  if (candidate.length < 2) return "";
  if (!LEGACY_PREFIXES.has(candidate)) return candidate;
  // Reservado: tenta uma letra a mais; sem alternativa, não sugere nada.
  const longer = letters.slice(0, 4);
  return longer.length > candidate.length ? longer : "";
}

/** Aplica o nome e atualiza as sugestões dos campos ainda não editados à mão. */
export function applyStockSectorName(
  form: StockSectorFormState,
  name: string
): StockSectorFormState {
  return {
    ...form,
    name,
    code: form.touched.code ? form.code : suggestStockSectorCode(name),
    slug: form.touched.slug ? form.slug : suggestStockSectorSlug(name),
    sessionCodePrefix: form.touched.sessionCodePrefix
      ? form.sessionCodePrefix
      : suggestStockSectorPrefix(name),
  };
}

export function stockSectorItemTypeRequiresCostCenter(
  options: StockSectorFormOptions,
  itemType: string
): boolean {
  return options.itemTypes.find((t) => t.itemType === itemType)?.requiresCostCenter === true;
}

export type StockSectorFormErrors = Partial<
  Record<
    | "name"
    | "code"
    | "slug"
    | "sessionCodePrefix"
    | "itemType"
    | "warehouseId"
    | "newWarehouseCode"
    | "newWarehouseName"
    | "defaultCostCenterId"
    | "operations",
    string
  >
>;

export function validateStockSectorForm(
  form: StockSectorFormState,
  options: StockSectorFormOptions,
  mode: "create" | "edit"
): StockSectorFormErrors {
  const errors: StockSectorFormErrors = {};
  if (!form.name.trim()) errors.name = "Informe o nome do setor.";

  if (mode === "create") {
    const code = form.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) {
      errors.code = "Use letras, números e _ (começando por letra).";
    } else if (LEGACY_CODES.has(code)) {
      errors.code = "Código reservado aos setores fixos do Collector.";
    }
  }

  const slug = form.slug.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    errors.slug = "Use minúsculas, números e hífen (ex.: administrativo).";
  } else if (LEGACY_SLUGS.has(slug)) {
    errors.slug = "Endereço reservado aos setores fixos do Collector.";
  }

  const prefix = form.sessionCodePrefix.trim().toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(prefix)) {
    errors.sessionCodePrefix = "De 2 a 4 letras (ex.: ADM).";
  } else if (LEGACY_PREFIXES.has(prefix)) {
    errors.sessionCodePrefix = "Prefixo reservado (MP, CP e PA).";
  }

  if (!form.itemType) errors.itemType = "Escolha o tipo de item.";

  if (form.warehouseMode === "existing") {
    if (!form.warehouseId) errors.warehouseId = "Escolha o almoxarifado.";
  } else {
    if (!form.newWarehouseCode.trim()) errors.newWarehouseCode = "Informe o código do almoxarifado.";
    if (!form.newWarehouseName.trim()) errors.newWarehouseName = "Informe o nome do almoxarifado.";
  }

  if (
    stockSectorItemTypeRequiresCostCenter(options, form.itemType) &&
    !form.defaultCostCenterId
  ) {
    errors.defaultCostCenterId =
      "Este tipo de item exige centro de custo nas saídas. Escolha o centro de custo do setor.";
  }

  if (!form.allowsCounting && !form.allowsWithdrawal) {
    errors.operations = "Habilite ao menos uma operação (contagem ou retirada).";
  }
  return errors;
}

export function isStockSectorFormValid(errors: StockSectorFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/** Corpo do POST: almoxarifado existente OU novo — nunca os dois. */
export function stockSectorFormToCreatePayload(form: StockSectorFormState) {
  const base = {
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    slug: form.slug.trim(),
    strategy: "STANDARD" as const,
    itemType: form.itemType,
    sessionCodePrefix: form.sessionCodePrefix.trim().toUpperCase(),
    allowsCounting: form.allowsCounting,
    allowsWithdrawal: form.allowsWithdrawal,
    status: form.status,
    defaultCostCenterId: form.defaultCostCenterId || null,
  };
  if (form.warehouseMode === "new") {
    return {
      ...base,
      newWarehouse: {
        code: form.newWarehouseCode.trim().toUpperCase(),
        name: form.newWarehouseName.trim(),
        description: form.newWarehouseDescription.trim() || null,
      },
    };
  }
  return { ...base, warehouseId: form.warehouseId };
}

/** Corpo do PATCH: só o que mudou. Código é imutável e nunca é enviado. */
export function stockSectorFormToUpdatePayload(
  form: StockSectorFormState,
  original: StockSectorRow
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (form.name.trim() !== original.name) patch.name = form.name.trim();
  if (form.slug.trim() !== original.slug) patch.slug = form.slug.trim();
  const prefix = form.sessionCodePrefix.trim().toUpperCase();
  if (prefix !== original.sessionCodePrefix) patch.sessionCodePrefix = prefix;
  if (form.itemType !== (original.itemType ?? "")) patch.itemType = form.itemType;
  if (form.warehouseId !== original.warehouseId) patch.warehouseId = form.warehouseId;
  if (form.allowsCounting !== original.allowsCounting) patch.allowsCounting = form.allowsCounting;
  if (form.allowsWithdrawal !== original.allowsWithdrawal) {
    patch.allowsWithdrawal = form.allowsWithdrawal;
  }
  if ((form.defaultCostCenterId || null) !== (original.defaultCostCenterId ?? null)) {
    patch.defaultCostCenterId = form.defaultCostCenterId || null;
  }
  if (form.status !== original.status) patch.status = form.status;
  return patch;
}

/** Caminho do deep-link do setor (o QR completo vem do servidor). */
export function stockSectorCollectorPath(slug: string): string {
  return `/collector/sector/${slug}`;
}

export function formatStockSectorStrategy(strategy: string): string {
  return strategy === "STANDARD" ? "Padrão" : strategy;
}

export function formatStockSectorItemType(itemType: string | null): string {
  return itemType ? formatInventoryItemType(itemType) : "—";
}

/**
 * Setores fixos do Collector, mostrados na lista só para consulta: têm fluxo
 * próprio no código e não são criados, editados nem inativados por esta tela.
 */
export type LegacyStockSectorRow = {
  code: string;
  name: string;
  slug: string;
  itemType: string;
  sessionCodePrefix: string;
  allowsCounting: true;
  allowsWithdrawal: boolean;
};

export const LEGACY_STOCK_SECTOR_ROWS: readonly LegacyStockSectorRow[] = (
  Object.keys(COLLECTOR_SECTORS) as (keyof typeof COLLECTOR_SECTORS)[]
).map((code) => ({
  code,
  name: COLLECTOR_SECTORS[code].label,
  slug: COLLECTOR_SECTORS[code].slug,
  itemType: code,
  sessionCodePrefix: COLLECTOR_SECTORS[code].sessionCodePrefix,
  allowsCounting: true,
  allowsWithdrawal: code === "RAW_MATERIAL",
}));

export function normalizeStockSectorListResponse(raw: unknown): {
  rows: StockSectorRow[];
  total: number;
} {
  const data = (raw ?? {}) as { rows?: unknown; total?: unknown };
  const rows = Array.isArray(data.rows) ? (data.rows as StockSectorRow[]) : [];
  return { rows, total: typeof data.total === "number" ? data.total : rows.length };
}

export function normalizeStockSectorFormOptions(raw: unknown): StockSectorFormOptions {
  const data = (raw ?? {}) as Partial<StockSectorFormOptions>;
  return {
    strategies: Array.isArray(data.strategies) ? data.strategies : ["STANDARD"],
    itemTypes: Array.isArray(data.itemTypes) ? data.itemTypes : [],
    warehouses: Array.isArray(data.warehouses) ? data.warehouses : [],
    costCenters: Array.isArray(data.costCenters) ? data.costCenters : [],
  };
}
