import { prisma } from "@/src/lib/prisma.js";
import { decimalFieldToNumber } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  buildCompanyIntelligencePayload,
  CompanyIntelligenceError,
} from "@/src/lib/companyCnpjLookup.js";
import { isValidCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import type { NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";
import {
  buildSupplierApplyPatch,
  compareSupplierWithCnpjData,
} from "@/src/lib/financeSupplierCnpjCompare.js";
import { normalizeSupplierDocument, normalizeSupplierName } from "@/src/lib/financeSupplierIdentity.js";
import type { CustomerCompareResult } from "@/src/lib/companyCnpjCompare.js";
import type { CompanyIntelligencePayload } from "@/src/lib/companyCnpjLookup.js";

export class FinanceSupplierProfileError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly existingSupplierId?: string;

  constructor(
    message: string,
    code: string,
    httpStatus: number,
    extras?: { existingSupplierId?: string }
  ) {
    super(message);
    this.name = "FinanceSupplierProfileError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.existingSupplierId = extras?.existingSupplierId;
  }
}

export const FINANCE_SUPPLIER_AUDIT_ENTITY = "FinancialSupplier";

export const FINANCE_SUPPLIER_AUDIT_ACTION = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  CNPJ_LOOKUP: "CNPJ_LOOKUP",
  CNPJ_APPLY: "CNPJ_APPLY",
  DEACTIVATE: "DEACTIVATE",
} as const;

export type FinancialSupplierProfileDto = {
  id: string;
  displayName: string;
  legalName: string | null;
  tradeName: string | null;
  document: string | null;
  normalizedDocument: string | null;
  status: string;
  titlesCount: number;
  totalAmountSeen: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  aliases: Array<{
    id: string;
    originalName: string | null;
    originalDocument: string | null;
    titlesCount: number;
  }>;
  activeRules: Array<{
    id: string;
    costCenterId: string;
    costCenterName: string;
    percentage: number;
  }>;
  allocationCount: number;
};

export type FinanceSupplierIntelligencePayload = CompanyIntelligencePayload & {
  supplierId: string;
  comparison: CustomerCompareResult;
  history: Array<{
    id: string;
    cnpj: string;
    fetchedAt: string;
    expiresAt: string;
    riskScore: number;
    riskVerdict: string;
    source: string;
  }>;
};

function serializeSupplier(row: {
  id: string;
  displayName: string;
  legalName: string | null;
  tradeName: string | null;
  document: string | null;
  normalizedDocument: string | null;
  status: string;
  titlesCount: number;
  totalAmountSeen: unknown;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  aliases: Array<{
    id: string;
    originalName: string | null;
    originalDocument: string | null;
    titlesCount: number;
  }>;
  costCenterRules: Array<{
    id: string;
    percentage: unknown;
    costCenter: { id: string; name: string };
  }>;
  _count: { allocations: number };
}): FinancialSupplierProfileDto {
  return {
    id: row.id,
    displayName: row.displayName,
    legalName: row.legalName,
    tradeName: row.tradeName,
    document: row.document,
    normalizedDocument: row.normalizedDocument,
    status: row.status,
    titlesCount: row.titlesCount,
    totalAmountSeen: decimalFieldToNumber(row.totalAmountSeen) ?? 0,
    firstSeenAt: row.firstSeenAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    aliases: row.aliases.map((alias) => ({
      id: alias.id,
      originalName: alias.originalName,
      originalDocument: alias.originalDocument,
      titlesCount: alias.titlesCount,
    })),
    activeRules: row.costCenterRules.map((rule) => ({
      id: rule.id,
      costCenterId: rule.costCenter.id,
      costCenterName: rule.costCenter.name,
      percentage: decimalFieldToNumber(rule.percentage) ?? 100,
    })),
    allocationCount: row._count.allocations,
  };
}

async function writeSupplierAudit(input: {
  supplierId: string;
  action: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  userId?: string | null;
  userName?: string | null;
}) {
  await prisma.financialCostCenterAuditLog.create({
    data: {
      entityType: FINANCE_SUPPLIER_AUDIT_ENTITY,
      entityId: input.supplierId,
      action: input.action,
      beforeJson: input.beforeJson as object | undefined,
      afterJson: input.afterJson as object | undefined,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
    },
  });
}

export async function getFinancialSupplierProfileDefault(
  supplierId: string
): Promise<FinancialSupplierProfileDto> {
  return getFinancialSupplierProfile(supplierId);
}

export async function getFinancialSupplierProfile(
  supplierId: string
): Promise<FinancialSupplierProfileDto> {
  const row = await prisma.financialSupplier.findUnique({
    where: { id: supplierId },
    include: {
      aliases: { orderBy: { titlesCount: "desc" } },
      costCenterRules: {
        where: { isActive: true },
        include: { costCenter: { select: { id: true, name: true } } },
      },
      _count: { select: { allocations: true } },
    },
  });

  if (!row) {
    throw new FinanceSupplierProfileError("Fornecedor não encontrado.", "NOT_FOUND", 404);
  }

  return serializeSupplier(row);
}

export type UpdateFinancialSupplierInput = {
  displayName?: string;
  legalName?: string | null;
  tradeName?: string | null;
  document?: string | null;
};

export type CreateFinancialSupplierInput = {
  displayName?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  document?: string | null;
};

export type FinanceSupplierCnpjLookupPayload = CompanyIntelligencePayload & {
  comparison: CustomerCompareResult;
};

const SUPPLIER_PROFILE_INCLUDE = {
  aliases: { orderBy: { titlesCount: "desc" as const } },
  costCenterRules: {
    where: { isActive: true },
    include: { costCenter: { select: { id: true, name: true } } },
  },
  _count: { select: { allocations: true } },
};

function resolveDocumentFields(rawInput: string | null | undefined): {
  document: string | null;
  normalizedDocument: string | null;
} {
  const raw = rawInput?.trim() || "";
  if (!raw) {
    return { document: null, normalizedDocument: null };
  }
  const normalized = normalizeSupplierDocument(raw);
  if (!normalized) {
    throw new FinanceSupplierProfileError("Documento inválido.", "INVALID_DOCUMENT", 422);
  }
  if (normalized.length === 14 && !isValidCnpj(normalized)) {
    throw new FinanceSupplierProfileError("CNPJ inválido.", "INVALID_CNPJ", 422);
  }
  return { document: raw, normalizedDocument: normalized };
}

async function assertDocumentAvailable(
  normalizedDocument: string | null,
  excludeSupplierId?: string
): Promise<void> {
  if (!normalizedDocument) return;
  const existing = await prisma.financialSupplier.findFirst({
    where: {
      normalizedDocument,
      ...(excludeSupplierId ? { id: { not: excludeSupplierId } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, displayName: true, status: true },
  });
  if (!existing) return;
  const statusHint =
    existing.status === "INACTIVE" ? " (cadastro inativo)" : "";
  throw new FinanceSupplierProfileError(
    `Já existe fornecedor com este documento: ${existing.displayName}${statusHint}.`,
    "DUPLICATE_DOCUMENT",
    409,
    { existingSupplierId: existing.id }
  );
}

export async function createFinancialSupplierDefault(
  input: CreateFinancialSupplierInput,
  user: { id?: string | null; name?: string | null; email?: string | null }
): Promise<FinancialSupplierProfileDto> {
  return createFinancialSupplier(input, user);
}

export async function createFinancialSupplier(
  input: CreateFinancialSupplierInput,
  user: { id?: string | null; name?: string | null; email?: string | null }
): Promise<FinancialSupplierProfileDto> {
  const legalName = input.legalName?.trim() || null;
  const tradeName = input.tradeName?.trim() || null;
  const displayName = (input.displayName?.trim() || legalName || tradeName || "").trim();
  if (!displayName) {
    throw new FinanceSupplierProfileError(
      "Nome / razão social é obrigatório.",
      "INVALID_DISPLAY_NAME",
      422
    );
  }

  const { document, normalizedDocument } = resolveDocumentFields(input.document);
  await assertDocumentAvailable(normalizedDocument);

  const created = await prisma.financialSupplier.create({
    data: {
      displayName,
      legalName,
      tradeName,
      document,
      normalizedDocument,
      normalizedName: normalizeSupplierName(displayName),
      source: "MANUAL",
      status: "ACTIVE",
    },
    include: SUPPLIER_PROFILE_INCLUDE,
  });

  await writeSupplierAudit({
    supplierId: created.id,
    action: FINANCE_SUPPLIER_AUDIT_ACTION.CREATE,
    afterJson: {
      displayName: created.displayName,
      legalName: created.legalName,
      tradeName: created.tradeName,
      document: created.document,
      source: created.source,
      status: created.status,
    },
    userId: user.id ?? user.email ?? null,
    userName: user.name ?? user.email ?? null,
  });

  return serializeSupplier(created);
}

export async function updateFinancialSupplierProfileDefault(
  supplierId: string,
  input: UpdateFinancialSupplierInput,
  user: { id?: string | null; name?: string | null; email?: string | null }
): Promise<FinancialSupplierProfileDto> {
  return updateFinancialSupplierProfile(supplierId, input, user);
}

export async function updateFinancialSupplierProfile(
  supplierId: string,
  input: UpdateFinancialSupplierInput,
  user: { id?: string | null; name?: string | null; email?: string | null }
): Promise<FinancialSupplierProfileDto> {
  const current = await prisma.financialSupplier.findUnique({ where: { id: supplierId } });
  if (!current) {
    throw new FinanceSupplierProfileError("Fornecedor não encontrado.", "NOT_FOUND", 404);
  }
  if (current.status === "INACTIVE") {
    throw new FinanceSupplierProfileError(
      "Fornecedor inativo não pode ser editado.",
      "SUPPLIER_INACTIVE",
      409
    );
  }

  const data: Record<string, string | null> = {};

  if (input.displayName !== undefined) {
    const name = input.displayName.trim();
    if (!name) {
      throw new FinanceSupplierProfileError("Nome exibido é obrigatório.", "INVALID_DISPLAY_NAME", 422);
    }
    data.displayName = name;
    data.normalizedName = normalizeSupplierName(name);
  }
  if (input.legalName !== undefined) {
    data.legalName = input.legalName?.trim() || null;
  }
  if (input.tradeName !== undefined) {
    data.tradeName = input.tradeName?.trim() || null;
  }
  if (input.document !== undefined) {
    const resolved = resolveDocumentFields(input.document);
    data.document = resolved.document;
    data.normalizedDocument = resolved.normalizedDocument;
    await assertDocumentAvailable(resolved.normalizedDocument, supplierId);
  }

  if (Object.keys(data).length === 0) {
    return getFinancialSupplierProfile(supplierId);
  }

  const updated = await prisma.financialSupplier.update({
    where: { id: supplierId },
    data,
    include: SUPPLIER_PROFILE_INCLUDE,
  });

  await writeSupplierAudit({
    supplierId,
    action: FINANCE_SUPPLIER_AUDIT_ACTION.UPDATE,
    beforeJson: {
      displayName: current.displayName,
      legalName: current.legalName,
      tradeName: current.tradeName,
      document: current.document,
    },
    afterJson: {
      displayName: updated.displayName,
      legalName: updated.legalName,
      tradeName: updated.tradeName,
      document: updated.document,
    },
    userId: user.id ?? user.email ?? null,
    userName: user.name ?? user.email ?? null,
  });

  return serializeSupplier(updated);
}

function resolveSupplierCnpj(
  supplier: { document: string | null },
  cnpjOverride?: string | null
): string {
  const cnpj = normalizeCnpj(cnpjOverride ?? supplier.document ?? "");
  if (!cnpj) {
    throw new FinanceSupplierProfileError(
      "Informe um CNPJ válido para consulta.",
      "SUPPLIER_WITHOUT_CNPJ",
      422
    );
  }
  if (!isValidCnpj(cnpj)) {
    throw new FinanceSupplierProfileError("CNPJ inválido.", "INVALID_CNPJ", 422);
  }
  return cnpj;
}

export async function buildFinanceSupplierCnpjLookupPayloadDefault(input: {
  cnpj: string;
  forceRefresh?: boolean;
  userId?: string | null;
  draft?: {
    displayName?: string | null;
    legalName?: string | null;
    tradeName?: string | null;
    document?: string | null;
  };
}): Promise<FinanceSupplierCnpjLookupPayload> {
  return buildFinanceSupplierCnpjLookupPayload(input);
}

/** Consulta CNPJ sem fornecedor persistido (modo create) — mesma base publica.cnpj.ws. */
export async function buildFinanceSupplierCnpjLookupPayload(input: {
  cnpj: string;
  forceRefresh?: boolean;
  userId?: string | null;
  draft?: {
    displayName?: string | null;
    legalName?: string | null;
    tradeName?: string | null;
    document?: string | null;
  };
}): Promise<FinanceSupplierCnpjLookupPayload> {
  const cnpj = resolveSupplierCnpj({ document: null }, input.cnpj);

  let payload: CompanyIntelligencePayload;
  try {
    payload = await buildCompanyIntelligencePayload({
      cnpj,
      forceRefresh: input.forceRefresh,
      userId: input.userId ?? null,
    });
  } catch (e) {
    if (e instanceof CompanyIntelligenceError) {
      throw new FinanceSupplierProfileError(e.message, e.code, e.httpStatus);
    }
    throw e;
  }

  const draft = input.draft ?? {};
  const comparison = compareSupplierWithCnpjData(
    {
      displayName: draft.displayName ?? null,
      legalName: draft.legalName ?? null,
      tradeName: draft.tradeName ?? null,
      document: draft.document ?? null,
    },
    payload.summary
  );

  return { ...payload, comparison };
}

export async function buildFinanceSupplierCompanyIntelligencePayloadDefault(input: {
  supplierId: string;
  cnpjOverride?: string | null;
  forceRefresh?: boolean;
  userId?: string | null;
}): Promise<FinanceSupplierIntelligencePayload> {
  return buildFinanceSupplierCompanyIntelligencePayload(input);
}

export async function buildFinanceSupplierCompanyIntelligencePayload(input: {
  supplierId: string;
  cnpjOverride?: string | null;
  forceRefresh?: boolean;
  userId?: string | null;
}): Promise<FinanceSupplierIntelligencePayload> {
  const supplier = await prisma.financialSupplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) {
    throw new FinanceSupplierProfileError("Fornecedor não encontrado.", "NOT_FOUND", 404);
  }
  if (supplier.status === "INACTIVE") {
    throw new FinanceSupplierProfileError(
      "Fornecedor inativo não pode consultar CNPJ.",
      "SUPPLIER_INACTIVE",
      409
    );
  }

  const cnpj = resolveSupplierCnpj(supplier, input.cnpjOverride);

  let payload: CompanyIntelligencePayload;
  try {
    payload = await buildCompanyIntelligencePayload({
      cnpj,
      forceRefresh: input.forceRefresh,
      userId: input.userId ?? null,
    });
  } catch (e) {
    if (e instanceof CompanyIntelligenceError) {
      throw new FinanceSupplierProfileError(e.message, e.code, e.httpStatus);
    }
    throw e;
  }

  const comparison = compareSupplierWithCnpjData(supplier, payload.summary);

  const history = await prisma.customerCnpjLookup.findMany({
    where: { cnpj },
    orderBy: { fetchedAt: "desc" },
    take: 10,
    select: {
      id: true,
      cnpj: true,
      fetchedAt: true,
      expiresAt: true,
      riskScore: true,
      riskVerdict: true,
      source: true,
    },
  });

  await writeSupplierAudit({
    supplierId: supplier.id,
    action: input.forceRefresh
      ? FINANCE_SUPPLIER_AUDIT_ACTION.CNPJ_LOOKUP
      : FINANCE_SUPPLIER_AUDIT_ACTION.CNPJ_LOOKUP,
    afterJson: { cnpj, lookupId: payload.lookupId, forceRefresh: Boolean(input.forceRefresh) },
    userId: input.userId ?? null,
  });

  return {
    ...payload,
    supplierId: supplier.id,
    comparison,
    history: history.map((row) => ({
      id: row.id,
      cnpj: row.cnpj,
      fetchedAt: row.fetchedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      riskScore: row.riskScore,
      riskVerdict: row.riskVerdict,
      source: row.source,
    })),
  };
}

export async function applyCompanyIntelligenceToSupplierDefault(input: {
  supplierId: string;
  lookupId: string;
  selectedFields: string[];
  userId?: string | null;
  userName?: string | null;
}): Promise<{ supplier: FinancialSupplierProfileDto; appliedFields: string[] }> {
  return applyCompanyIntelligenceToSupplier(input);
}

export async function applyCompanyIntelligenceToSupplier(input: {
  supplierId: string;
  lookupId: string;
  selectedFields: string[];
  userId?: string | null;
  userName?: string | null;
}): Promise<{ supplier: FinancialSupplierProfileDto; appliedFields: string[] }> {
  const supplier = await prisma.financialSupplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) {
    throw new FinanceSupplierProfileError("Fornecedor não encontrado.", "NOT_FOUND", 404);
  }
  if (supplier.status === "INACTIVE") {
    throw new FinanceSupplierProfileError(
      "Fornecedor inativo não pode receber dados da consulta.",
      "SUPPLIER_INACTIVE",
      409
    );
  }

  const lookup = await prisma.customerCnpjLookup.findUnique({ where: { id: input.lookupId } });
  if (!lookup) {
    throw new FinanceSupplierProfileError("Consulta não encontrada.", "LOOKUP_NOT_FOUND", 404);
  }

  const summary = lookup.normalizedSummary as NormalizedCnpjSummary;
  const patch = buildSupplierApplyPatch(supplier, summary, input.selectedFields);

  if (Object.keys(patch).length === 0) {
    throw new FinanceSupplierProfileError(
      "Nenhum campo válido selecionado para atualização.",
      "NO_FIELDS_SELECTED",
      422
    );
  }

  const data: Record<string, string | null> = { ...patch };
  if (patch.document) {
    data.normalizedDocument = normalizeSupplierDocument(patch.document);
    data.normalizedName = normalizeSupplierName(patch.displayName ?? patch.legalName ?? supplier.displayName);
  } else if (patch.displayName) {
    data.normalizedName = normalizeSupplierName(patch.displayName);
  }

  const updated = await prisma.financialSupplier.update({
    where: { id: supplier.id },
    data,
    include: {
      aliases: { orderBy: { titlesCount: "desc" } },
      costCenterRules: {
        where: { isActive: true },
        include: { costCenter: { select: { id: true, name: true } } },
      },
      _count: { select: { allocations: true } },
    },
  });

  await writeSupplierAudit({
    supplierId: supplier.id,
    action: FINANCE_SUPPLIER_AUDIT_ACTION.CNPJ_APPLY,
    beforeJson: {
      displayName: supplier.displayName,
      legalName: supplier.legalName,
      tradeName: supplier.tradeName,
      document: supplier.document,
    },
    afterJson: {
      displayName: updated.displayName,
      legalName: updated.legalName,
      tradeName: updated.tradeName,
      document: updated.document,
      appliedFields: Object.keys(patch),
    },
    userId: input.userId ?? null,
    userName: input.userName ?? null,
  });

  return { supplier: serializeSupplier(updated), appliedFields: Object.keys(patch) };
}

export async function deactivateFinancialSupplierDefault(input: {
  supplierId: string;
  userId?: string | null;
  userName?: string | null;
}): Promise<{ supplier: FinancialSupplierProfileDto; message: string }> {
  return deactivateFinancialSupplier(input);
}

export async function deactivateFinancialSupplier(input: {
  supplierId: string;
  userId?: string | null;
  userName?: string | null;
}): Promise<{ supplier: FinancialSupplierProfileDto; message: string }> {
  const supplier = await prisma.financialSupplier.findUnique({
    where: { id: input.supplierId },
    include: {
      aliases: { orderBy: { titlesCount: "desc" } },
      costCenterRules: {
        where: { isActive: true },
        include: { costCenter: { select: { id: true, name: true } } },
      },
      _count: { select: { allocations: true } },
    },
  });

  if (!supplier) {
    throw new FinanceSupplierProfileError("Fornecedor não encontrado.", "NOT_FOUND", 404);
  }
  if (supplier.status === "INACTIVE") {
    throw new FinanceSupplierProfileError(
      "Fornecedor já está inativo.",
      "ALREADY_INACTIVE",
      409
    );
  }

  const updated = await prisma.financialSupplier.update({
    where: { id: supplier.id },
    data: { status: "INACTIVE" },
    include: {
      aliases: { orderBy: { titlesCount: "desc" } },
      costCenterRules: {
        where: { isActive: true },
        include: { costCenter: { select: { id: true, name: true } } },
      },
      _count: { select: { allocations: true } },
    },
  });

  await writeSupplierAudit({
    supplierId: supplier.id,
    action: FINANCE_SUPPLIER_AUDIT_ACTION.DEACTIVATE,
    beforeJson: { status: supplier.status },
    afterJson: {
      status: "INACTIVE",
      preserved: {
        allocations: supplier._count.allocations,
        aliases: supplier.aliases.length,
        activeRules: supplier.costCenterRules.length,
        note: "Títulos AP, alocações e histórico financeiro não foram alterados.",
      },
    },
    userId: input.userId ?? null,
    userName: input.userName ?? null,
  });

  const allocationNote =
    supplier._count.allocations > 0
      ? ` ${supplier._count.allocations} alocação(ões) AP preservadas com referência histórica.`
      : "";

  return {
    supplier: serializeSupplier(updated),
    message:
      "Cadastro consolidado do fornecedor inativado. Regras, aliases e títulos AP não foram apagados." +
      allocationNote,
  };
}

export function assertSuperAdminCanDeleteSupplier(role: string | undefined | null): void {
  if (role !== "SUPER_ADMIN") {
    throw new FinanceSupplierProfileError(
      "Somente SUPER_ADMIN pode excluir fornecedor.",
      "FORBIDDEN",
      403
    );
  }
}
