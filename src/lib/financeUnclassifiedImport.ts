import * as XLSX from "xlsx";
import {
  isInternalGroupCounterparty,
  normalizeFinancePersonText,
} from "@/src/lib/financeInternalGroupExclusions.js";
import {
  applyBatchAccountsPayableAllocationDefault,
  listUnclassifiedAccountsPayableDefault,
  type UnclassifiedCause,
  type UnclassifiedItem,
} from "@/src/lib/financeAccountsPayableCostCenterAllocation.js";
import { createSupplierCostCenterRulesBatchDefault } from "@/src/lib/financeSupplierCostCenterRules.js";
import {
  createDefaultFinanceSupplierRebuildDeps,
  upsertFinancialSupplierAliases,
  upsertFinancialSupplierFromGroup,
} from "@/src/lib/financeSupplierRebuild.js";
import { groupAccountsPayableSuppliers } from "@/src/lib/financeSupplierIdentity.js";
import { FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT } from "@/src/lib/financeApAllocationShared.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceUnclassifiedImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceUnclassifiedImportError";
    this.code = code;
  }
}

/** Texto de confirmação obrigatório para aplicar a importação. */
export const FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT =
  "APLICAR IMPORTACAO CLASSIFICACAO AP";

export const FINANCE_UNCLASSIFIED_EXPORT_FILENAME = "titulos-sem-classificacao.xlsx";
export const FINANCE_UNCLASSIFIED_EXPORT_SHEET = "Titulos_Sem_Classificacao";

/** Ordem canônica das colunas da planilha (export e import compartilham a mesma estrutura). */
export const FINANCE_UNCLASSIFIED_IMPORT_COLUMNS = [
  "causa",
  "personIdNomus",
  "personNameNomus",
  "documentoNomus",
  "titulosQuantidade",
  "valorTotal",
  "financialSupplierId",
  "financialSupplierName",
  "financialSupplierDocument",
  "acaoFornecedor",
  "centroCustoCodigo",
  "centroCustoNome",
  "percentual",
  "autoApply",
  "observacao",
  "aplicar",
] as const;

export type FinanceUnclassifiedImportColumn =
  (typeof FINANCE_UNCLASSIFIED_IMPORT_COLUMNS)[number];

/** Colunas preenchidas pelo sistema na exportação. */
export const FINANCE_UNCLASSIFIED_SYSTEM_COLUMNS = [
  "causa",
  "personIdNomus",
  "personNameNomus",
  "documentoNomus",
  "titulosQuantidade",
  "valorTotal",
  "financialSupplierId",
  "financialSupplierName",
  "financialSupplierDocument",
] as const;

/** Colunas que o usuário deve preencher. */
export const FINANCE_UNCLASSIFIED_USER_COLUMNS = [
  "acaoFornecedor",
  "centroCustoCodigo",
  "percentual",
  "autoApply",
  "observacao",
  "aplicar",
] as const;

export const FINANCE_UNCLASSIFIED_SUPPLIER_ACTIONS = [
  "USAR_EXISTENTE",
  "CRIAR_NOVO",
  "IGNORAR",
] as const;
export type FinanceUnclassifiedSupplierAction =
  (typeof FINANCE_UNCLASSIFIED_SUPPLIER_ACTIONS)[number];

/** Palavras-chave de contrapartes sensíveis que exigem confirmação explícita. */
export const FINANCE_UNCLASSIFIED_SENSITIVE_KEYWORDS = [
  "CONTA ADMINISTRATIVA",
  "ADMINISTRATIVA",
  "RECEITA FEDERAL",
  "RECEITA FED",
  "SOCIO",
  "SOCIOS",
  "FINANCIAMENTO",
  "EMPRESTIMO",
  "MOVIMENTO INTERNO",
  "TRANSFERENCIA INTERNA",
] as const;

export type FinanceUnclassifiedExportGroup = {
  cause: UnclassifiedCause;
  personIdNomus: number | null;
  personNameNomus: string | null;
  documentoNomus: string | null;
  titulosQuantidade: number;
  valorTotal: number;
  financialSupplierId: string | null;
  financialSupplierName: string | null;
  financialSupplierDocument: string | null;
};

export type FinanceUnclassifiedExportRow = Record<FinanceUnclassifiedImportColumn, string>;

const CAUSE_LABEL_PT: Record<UnclassifiedCause, string> = {
  MANUAL_LOCKED: "Manual bloqueado",
  PARTIAL_ALLOCATION: "Rateio incompleto",
  NO_SUPPLIER: "Fornecedor não casado",
  SUPPLIER_NO_RULE: "Fornecedor sem regra ativa",
  RULE_NOT_APPLIED: "Regra ativa, alocação pendente",
};

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function normalizeText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function parseSimNao(value: unknown): "SIM" | "NAO" | null {
  const text = normalizeText(value);
  if (text === "") return null;
  if (["SIM", "S", "YES", "Y", "TRUE", "1", "X"].includes(text)) return "SIM";
  if (["NAO", "NÃO", "N", "NO", "FALSE", "0"].includes(text)) return "NAO";
  return null;
}

export function parsePercentual(value: unknown): number | null {
  if (value == null || value === "") return null;
  const text = String(value).replace(/%/g, "").replace(",", ".").trim();
  if (text === "") return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function parseSupplierAction(value: unknown): FinanceUnclassifiedSupplierAction | null {
  const text = normalizeText(value).replace(/\s+/g, "_");
  if ((FINANCE_UNCLASSIFIED_SUPPLIER_ACTIONS as readonly string[]).includes(text)) {
    return text as FinanceUnclassifiedSupplierAction;
  }
  return null;
}

/** Detecta contrapartes sensíveis (admin, receita federal, sócios, financiamentos, grupo interno). */
export function detectSensitiveCounterparty(input: {
  personName: string | null | undefined;
  personCnpj?: string | null;
}): { sensitive: boolean; reason: string | null } {
  const normalized = normalizeText(input.personName);
  for (const keyword of FINANCE_UNCLASSIFIED_SENSITIVE_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return { sensitive: true, reason: keyword };
    }
  }
  if (
    isInternalGroupCounterparty({
      personName: input.personName ?? null,
      personCnpj: input.personCnpj ?? null,
    })
  ) {
    return { sensitive: true, reason: "GRUPO_INTERNO" };
  }
  return { sensitive: false, reason: null };
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** Agrupa os itens sem classificação por fornecedor/pessoa para a planilha (pura/testável). */
export function buildUnclassifiedExportGroups(
  items: UnclassifiedItem[],
  personInfoByExternalId: Map<number, { personId: number | null; personCnpj: string | null }>,
  supplierDocumentById: Map<string, string | null>
): FinanceUnclassifiedExportGroup[] {
  const map = new Map<string, FinanceUnclassifiedExportGroup>();
  for (const item of items) {
    const info = personInfoByExternalId.get(item.externalId) ?? {
      personId: null,
      personCnpj: null,
    };
    const key =
      item.supplierId ??
      (info.personId != null ? `person:${info.personId}` : null) ??
      (item.personName ? `name:${normalizeText(item.personName)}` : `ap:${item.externalId}`);

    const existing = map.get(key);
    if (existing) {
      existing.titulosQuantidade += 1;
      existing.valorTotal = Math.round((existing.valorTotal + item.titleAmount) * 100) / 100;
      continue;
    }

    map.set(key, {
      cause: item.cause,
      personIdNomus: info.personId,
      personNameNomus: item.personName,
      documentoNomus: info.personCnpj,
      titulosQuantidade: 1,
      valorTotal: Math.round(item.titleAmount * 100) / 100,
      financialSupplierId: item.supplierId,
      financialSupplierName: item.supplierName,
      financialSupplierDocument: item.supplierId
        ? (supplierDocumentById.get(item.supplierId) ?? null)
        : null,
    });
  }
  return [...map.values()].sort((a, b) => b.valorTotal - a.valorTotal);
}

/** Converte os grupos em linhas (com colunas de usuário em branco). */
export function buildUnclassifiedExportRows(
  groups: FinanceUnclassifiedExportGroup[]
): FinanceUnclassifiedExportRow[] {
  return groups.map((group) => ({
    causa: CAUSE_LABEL_PT[group.cause],
    personIdNomus: group.personIdNomus != null ? String(group.personIdNomus) : "",
    personNameNomus: group.personNameNomus ?? "",
    documentoNomus: group.documentoNomus ?? "",
    titulosQuantidade: String(group.titulosQuantidade),
    valorTotal: group.valorTotal.toFixed(2),
    financialSupplierId: group.financialSupplierId ?? "",
    financialSupplierName: group.financialSupplierName ?? "",
    financialSupplierDocument: group.financialSupplierDocument ?? "",
    acaoFornecedor: group.financialSupplierId ? "USAR_EXISTENTE" : "",
    centroCustoCodigo: "",
    centroCustoNome: "",
    percentual: "100",
    autoApply: "SIM",
    observacao: "",
    aplicar: "NAO",
  }));
}

export function buildUnclassifiedExportWorkbook(
  rows: FinanceUnclassifiedExportRow[]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: [...FINANCE_UNCLASSIFIED_IMPORT_COLUMNS],
    skipHeader: false,
  });
  XLSX.utils.book_append_sheet(wb, sheet, FINANCE_UNCLASSIFIED_EXPORT_SHEET);
  return wb;
}

export function unclassifiedExportWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

// ---------------------------------------------------------------------------
// Parsing da planilha de importação
// ---------------------------------------------------------------------------

export type FinanceUnclassifiedRawRow = Partial<Record<FinanceUnclassifiedImportColumn, unknown>>;

export function parseUnclassifiedImportWorkbook(buffer: Buffer | ArrayBuffer | Uint8Array): {
  rows: FinanceUnclassifiedRawRow[];
} {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new FinanceUnclassifiedImportError(
      "INVALID_FILE",
      "Não foi possível ler a planilha. Envie um arquivo .xlsx válido."
    );
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new FinanceUnclassifiedImportError("EMPTY_FILE", "Planilha vazia.");
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<FinanceUnclassifiedRawRow>(sheet, { defval: "" });
  return { rows };
}

// ---------------------------------------------------------------------------
// Validação / preview
// ---------------------------------------------------------------------------

export type FinanceUnclassifiedImportLineStatus =
  | "VALID"
  | "INVALID"
  | "SKIPPED"
  | "NEEDS_CONFIRMATION";

export type FinanceUnclassifiedImportLineResult = {
  rowNumber: number;
  status: FinanceUnclassifiedImportLineStatus;
  cause: string;
  personIdNomus: number | null;
  personNameNomus: string | null;
  documentoNomus: string | null;
  supplierAction: FinanceUnclassifiedSupplierAction | null;
  financialSupplierId: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  percentual: number | null;
  autoApply: boolean;
  apply: boolean;
  sensitive: boolean;
  sensitiveReason: string | null;
  errors: string[];
};

export type FinanceUnclassifiedImportPreview = {
  totalRead: number;
  validLines: number;
  invalidLines: number;
  skippedLines: number;
  suppliersToCreate: number;
  suppliersToLink: number;
  rulesToCreate: number;
  titlesToAllocate: number;
  titlesIgnoredManualLocked: number;
  sensitiveRequiringConfirmation: number;
  requiredConfirmationText: string;
  lines: FinanceUnclassifiedImportLineResult[];
};

export type FinanceUnclassifiedValidationContext = {
  /** Mapa de centro de custo por código normalizado (uppercase/trim). */
  costCentersByCode: Map<string, { id: string; name: string; status: string }>;
  /** Mapa de fornecedores financeiros por id. */
  suppliersById: Map<string, { id: string; displayName: string; status: string }>;
};

const PERCENTAGE_TOLERANCE = 0.01;

function readString(row: FinanceUnclassifiedRawRow, column: FinanceUnclassifiedImportColumn): string {
  const value = row[column];
  if (value == null) return "";
  return String(value).trim();
}

/** Valida uma linha da planilha (função pura). */
export function validateUnclassifiedImportRow(
  row: FinanceUnclassifiedRawRow,
  rowNumber: number,
  ctx: FinanceUnclassifiedValidationContext
): FinanceUnclassifiedImportLineResult {
  const errors: string[] = [];
  const personIdRaw = readString(row, "personIdNomus");
  const personId = personIdRaw ? Number(personIdRaw) : null;
  const personName = readString(row, "personNameNomus") || null;
  const documento = readString(row, "documentoNomus") || null;
  const supplierAction = parseSupplierAction(row.acaoFornecedor);
  const financialSupplierId = readString(row, "financialSupplierId") || null;
  const centroCustoCodigo = readString(row, "centroCustoCodigo") || null;
  const percentual = parsePercentual(row.percentual);
  const autoApply = parseSimNao(row.autoApply) !== "NAO"; // default SIM
  const aplicar = parseSimNao(row.aplicar) === "SIM";

  const sensitive = detectSensitiveCounterparty({ personName, personCnpj: documento });

  const result: FinanceUnclassifiedImportLineResult = {
    rowNumber,
    status: "VALID",
    cause: readString(row, "causa"),
    personIdNomus: personId != null && Number.isFinite(personId) ? personId : null,
    personNameNomus: personName,
    documentoNomus: documento,
    supplierAction,
    financialSupplierId,
    costCenterId: null,
    costCenterCode: centroCustoCodigo,
    percentual,
    autoApply,
    apply: aplicar,
    sensitive: sensitive.sensitive,
    sensitiveReason: sensitive.reason,
    errors,
  };

  if (!supplierAction) {
    errors.push("acaoFornecedor inválida (use USAR_EXISTENTE, CRIAR_NOVO ou IGNORAR).");
    result.status = "INVALID";
    return result;
  }

  if (supplierAction === "IGNORAR" || !aplicar) {
    result.status = "SKIPPED";
    return result;
  }

  // Centro de custo
  if (!centroCustoCodigo) {
    errors.push("centroCustoCodigo é obrigatório para aplicar.");
  } else {
    const cc = ctx.costCentersByCode.get(normalizeText(centroCustoCodigo));
    if (!cc) {
      errors.push(`Centro de custo "${centroCustoCodigo}" não encontrado.`);
    } else if (cc.status !== "ACTIVE") {
      errors.push(`Centro de custo "${centroCustoCodigo}" está inativo.`);
    } else {
      result.costCenterId = cc.id;
    }
  }

  // Percentual: uma linha por grupo → deve ser 100 para classificação total.
  if (percentual == null) {
    errors.push("percentual é obrigatório (use 100).");
  } else if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) {
    errors.push("percentual deve ser um número entre 0 e 100.");
  } else if (Math.abs(percentual - 100) > PERCENTAGE_TOLERANCE) {
    errors.push("percentual deve ser 100 nesta planilha (rateio parcial: use a aba Regras).");
  }

  // Fornecedor
  if (supplierAction === "USAR_EXISTENTE") {
    if (!financialSupplierId) {
      errors.push("financialSupplierId é obrigatório para USAR_EXISTENTE.");
    } else {
      const supplier = ctx.suppliersById.get(financialSupplierId);
      if (!supplier) {
        errors.push("Fornecedor financeiro informado não existe.");
      } else if (supplier.status !== "ACTIVE") {
        errors.push("Fornecedor financeiro informado está inativo.");
      }
    }
  } else if (supplierAction === "CRIAR_NOVO") {
    if (!personName && !documento) {
      errors.push("Para CRIAR_NOVO informe ao menos personNameNomus ou documentoNomus.");
    }
  }

  if (errors.length > 0) {
    result.status = "INVALID";
    return result;
  }

  result.status = sensitive.sensitive ? "NEEDS_CONFIRMATION" : "VALID";
  return result;
}

export function buildUnclassifiedImportPreview(
  rows: FinanceUnclassifiedRawRow[],
  ctx: FinanceUnclassifiedValidationContext
): FinanceUnclassifiedImportPreview {
  const lines = rows.map((row, index) =>
    validateUnclassifiedImportRow(row, index + 2, ctx)
  );

  let validLines = 0;
  let invalidLines = 0;
  let skippedLines = 0;
  let suppliersToCreate = 0;
  let suppliersToLink = 0;
  let rulesToCreate = 0;
  let sensitiveRequiringConfirmation = 0;

  for (const line of lines) {
    if (line.status === "SKIPPED") {
      skippedLines += 1;
      continue;
    }
    if (line.status === "INVALID") {
      invalidLines += 1;
      continue;
    }
    if (line.status === "NEEDS_CONFIRMATION") sensitiveRequiringConfirmation += 1;
    else validLines += 1;

    rulesToCreate += 1;
    if (line.supplierAction === "CRIAR_NOVO") suppliersToCreate += 1;
    if (line.supplierAction === "USAR_EXISTENTE") suppliersToLink += 1;
  }

  return {
    totalRead: rows.length,
    validLines,
    invalidLines,
    skippedLines,
    suppliersToCreate,
    suppliersToLink,
    rulesToCreate,
    // Estimativa: a contagem real respeita manual locked no apply em lote.
    titlesToAllocate: rulesToCreate,
    titlesIgnoredManualLocked: 0,
    sensitiveRequiringConfirmation,
    requiredConfirmationText: FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

export type FinanceUnclassifiedImportApplyDeps = {
  resolveCostCenterByCode: (
    code: string
  ) => Promise<{ id: string; name: string; status: string } | null>;
  findSupplierById: (
    id: string
  ) => Promise<{ id: string; displayName: string; status: string } | null>;
  createSupplierForPerson: (person: {
    personId: number | null;
    personName: string | null;
    document: string | null;
  }) => Promise<{ id: string; displayName: string }>;
  createRule: (input: {
    supplierId: string;
    costCenterId: string;
    percentage: number;
    autoApply: boolean;
    notes: string | null;
  }) => Promise<void>;
  applyAllocationsForSupplier: (
    supplierId: string
  ) => Promise<{ created: number; replaced: number; skippedManualLocked: number }>;
};

export type FinanceUnclassifiedImportApplyOptions = {
  confirmationText: string;
  confirmSensitive?: boolean;
};

export type FinanceUnclassifiedImportApplyResult = {
  ok: true;
  appliedAt: string;
  suppliersCreated: number;
  suppliersLinked: number;
  rulesCreated: number;
  titlesAllocated: number;
  titlesIgnoredManualLocked: number;
  skippedSensitiveUnconfirmed: number;
  lineErrors: Array<{ rowNumber: number; errors: string[] }>;
};

export function assertUnclassifiedImportConfirmation(confirmation: unknown): void {
  const text = typeof confirmation === "string" ? confirmation.trim() : "";
  if (text !== FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT) {
    throw new FinanceUnclassifiedImportError(
      "INVALID_CONFIRMATION",
      `Confirmação inválida — envie confirmationText exatamente igual a: "${FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT}".`
    );
  }
}

export async function applyUnclassifiedImport(
  deps: FinanceUnclassifiedImportApplyDeps,
  rows: FinanceUnclassifiedRawRow[],
  ctx: FinanceUnclassifiedValidationContext,
  options: FinanceUnclassifiedImportApplyOptions,
  _user: { userId: string | null; userName: string | null }
): Promise<FinanceUnclassifiedImportApplyResult> {
  assertUnclassifiedImportConfirmation(options.confirmationText);

  const preview = buildUnclassifiedImportPreview(rows, ctx);

  let suppliersCreated = 0;
  let suppliersLinked = 0;
  let rulesCreated = 0;
  let titlesAllocated = 0;
  let titlesIgnoredManualLocked = 0;
  let skippedSensitiveUnconfirmed = 0;
  const lineErrors: Array<{ rowNumber: number; errors: string[] }> = [];

  for (const line of preview.lines) {
    if (line.status === "SKIPPED") continue;
    if (line.status === "INVALID") {
      lineErrors.push({ rowNumber: line.rowNumber, errors: line.errors });
      continue;
    }
    if (line.status === "NEEDS_CONFIRMATION" && !options.confirmSensitive) {
      skippedSensitiveUnconfirmed += 1;
      continue;
    }
    if (!line.costCenterId || line.percentual == null) {
      lineErrors.push({ rowNumber: line.rowNumber, errors: ["Linha sem dados aplicáveis."] });
      continue;
    }

    try {
      let supplierId: string | null = null;
      if (line.supplierAction === "USAR_EXISTENTE") {
        supplierId = line.financialSupplierId;
        suppliersLinked += 1;
      } else if (line.supplierAction === "CRIAR_NOVO") {
        const created = await deps.createSupplierForPerson({
          personId: line.personIdNomus,
          personName: line.personNameNomus,
          document: line.documentoNomus,
        });
        supplierId = created.id;
        suppliersCreated += 1;
      }

      if (!supplierId) {
        lineErrors.push({
          rowNumber: line.rowNumber,
          errors: ["Não foi possível resolver o fornecedor financeiro."],
        });
        continue;
      }

      await deps.createRule({
        supplierId,
        costCenterId: line.costCenterId,
        percentage: line.percentual,
        autoApply: line.autoApply,
        notes: `Importação títulos sem classificação (linha ${line.rowNumber}).`,
      });
      rulesCreated += 1;

      const applied = await deps.applyAllocationsForSupplier(supplierId);
      titlesAllocated += applied.created + applied.replaced;
      titlesIgnoredManualLocked += applied.skippedManualLocked;
    } catch (error) {
      lineErrors.push({
        rowNumber: line.rowNumber,
        errors: [error instanceof Error ? error.message : "Erro ao aplicar a linha."],
      });
    }
  }

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    suppliersCreated,
    suppliersLinked,
    rulesCreated,
    titlesAllocated,
    titlesIgnoredManualLocked,
    skippedSensitiveUnconfirmed,
    lineErrors,
  };
}

// ---------------------------------------------------------------------------
// Defaults (wiring com Prisma e libs existentes)
// ---------------------------------------------------------------------------

export async function loadUnclassifiedValidationContextDefault(): Promise<FinanceUnclassifiedValidationContext> {
  const [centers, suppliers] = await Promise.all([
    prisma.financialCostCenter.findMany({ select: { id: true, code: true, name: true, status: true } }),
    prisma.financialSupplier.findMany({ select: { id: true, displayName: true, status: true } }),
  ]);
  const costCentersByCode = new Map<string, { id: string; name: string; status: string }>();
  for (const cc of centers) {
    costCentersByCode.set(normalizeText(cc.code), {
      id: cc.id,
      name: cc.name,
      status: cc.status,
    });
  }
  const suppliersById = new Map<string, { id: string; displayName: string; status: string }>();
  for (const s of suppliers) {
    suppliersById.set(s.id, { id: s.id, displayName: s.displayName, status: s.status });
  }
  return { costCentersByCode, suppliersById };
}

export async function buildUnclassifiedExportGroupsDefault(): Promise<
  FinanceUnclassifiedExportGroup[]
> {
  const payload = await listUnclassifiedAccountsPayableDefault({});
  const externalIds = payload.items.map((item) => item.externalId);
  const supplierIds = [
    ...new Set(payload.items.map((item) => item.supplierId).filter((id): id is string => Boolean(id))),
  ];

  const [apRows, supplierRows] = await Promise.all([
    externalIds.length > 0
      ? prisma.nomusAccountsPayable.findMany({
          where: { externalId: { in: externalIds } },
          select: { externalId: true, personId: true, personCnpj: true },
        })
      : Promise.resolve([] as Array<{ externalId: number; personId: number | null; personCnpj: string | null }>),
    supplierIds.length > 0
      ? prisma.financialSupplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, document: true, normalizedDocument: true },
        })
      : Promise.resolve([] as Array<{ id: string; document: string | null; normalizedDocument: string | null }>),
  ]);

  const personInfo = new Map<number, { personId: number | null; personCnpj: string | null }>();
  for (const row of apRows) {
    personInfo.set(row.externalId, { personId: row.personId, personCnpj: row.personCnpj });
  }
  const supplierDocs = new Map<string, string | null>();
  for (const row of supplierRows) {
    supplierDocs.set(row.id, row.document ?? row.normalizedDocument ?? null);
  }

  return buildUnclassifiedExportGroups(payload.items, personInfo, supplierDocs);
}

export function createDefaultUnclassifiedImportApplyDeps(user: {
  userId: string | null;
  userName: string | null;
}): FinanceUnclassifiedImportApplyDeps {
  return {
    resolveCostCenterByCode: async (code) =>
      prisma.financialCostCenter.findFirst({
        where: { code },
        select: { id: true, name: true, status: true },
      }),
    findSupplierById: async (id) =>
      prisma.financialSupplier.findUnique({
        where: { id },
        select: { id: true, displayName: true, status: true },
      }),
    createSupplierForPerson: async (person) => {
      const rebuildDeps = createDefaultFinanceSupplierRebuildDeps();
      const record = {
        externalId: person.personId ?? 0,
        personId: person.personId,
        personName: person.personName,
        personCnpj: person.document,
        companyId: null,
        companyName: null,
        rawPayload: null,
      };
      const [group] = groupAccountsPayableSuppliers([record]);
      if (!group) {
        throw new FinanceUnclassifiedImportError(
          "SUPPLIER_CREATE_FAILED",
          "Não foi possível identificar o fornecedor a partir da pessoa do AP."
        );
      }
      const existing = await prisma.financialSupplier.findFirst({
        where: group.extracted.normalizedDocument
          ? { normalizedDocument: group.extracted.normalizedDocument }
          : group.extracted.normalizedName
            ? { normalizedName: group.extracted.normalizedName }
            : { id: "__never__" },
        include: { aliases: true },
      });
      const existingRow = existing
        ? { ...existing, aliases: existing.aliases.map((a) => ({ ...a })) }
        : null;
      const { supplier } = await upsertFinancialSupplierFromGroup(
        rebuildDeps,
        group,
        existingRow,
        user
      );
      await upsertFinancialSupplierAliases(rebuildDeps, supplier, group, user);
      return { id: supplier.id, displayName: supplier.displayName };
    },
    createRule: async (input) => {
      await createSupplierCostCenterRulesBatchDefault(
        {
          supplierId: input.supplierId,
          replaceExisting: true,
          autoApply: input.autoApply,
          rules: [
            {
              costCenterId: input.costCenterId,
              percentage: input.percentage,
              notes: input.notes,
            },
          ],
        },
        user
      );
    },
    applyAllocationsForSupplier: async (supplierId) => {
      const result = await applyBatchAccountsPayableAllocationDefault(
        { unclassifiedOnly: true, supplierId },
        FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT,
        user
      );
      return {
        created: result.created,
        replaced: result.replaced,
        skippedManualLocked: result.summary.skippedManualLocked,
      };
    },
  };
}

export async function applyUnclassifiedImportDefault(
  rows: FinanceUnclassifiedRawRow[],
  options: FinanceUnclassifiedImportApplyOptions,
  user: { userId: string | null; userName: string | null }
): Promise<FinanceUnclassifiedImportApplyResult> {
  const ctx = await loadUnclassifiedValidationContextDefault();
  const deps = createDefaultUnclassifiedImportApplyDeps(user);
  return applyUnclassifiedImport(deps, rows, ctx, options, user);
}

export async function buildUnclassifiedImportPreviewDefault(
  rows: FinanceUnclassifiedRawRow[]
): Promise<FinanceUnclassifiedImportPreview> {
  const ctx = await loadUnclassifiedValidationContextDefault();
  return buildUnclassifiedImportPreview(rows, ctx);
}
