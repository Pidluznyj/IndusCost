/**
 * Motor oficial de fornecedores financeiros (Centro de Custo).
 * Unifica cadastro gerencial (FinancialSupplier) com identidades derivadas de AP.
 */
import { Prisma } from "@prisma/client";
import { decimalFieldToNumber } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  buildFinancialSupplierSearchWhere,
  clampSupplierSearchLimit,
  serializeFinancialSupplierSearchRow,
  type FinanceSupplierSearchResult,
  type FinanceSupplierSearchRow,
} from "@/src/lib/financeSupplierCostCenterRules.js";
import {
  buildSupplierIdentityKey,
  extractSupplierFromAccountsPayable,
  groupAccountsPayableSuppliers,
  normalizeSupplierDocument,
  normalizeSupplierName,
  type FinanceSupplierApGroup,
} from "@/src/lib/financeSupplierIdentity.js";
import {
  buildSupplierMatchIndex,
  createDefaultFinanceSupplierRebuildDeps,
  findExistingSupplierForGroup,
  pickDisplayName,
  upsertFinancialSupplierAliases,
  upsertFinancialSupplierFromGroup,
  type FinanceSupplierRebuildApRow,
  type FinanceSupplierRebuildDeps,
  type FinanceSupplierRebuildUserContext,
} from "@/src/lib/financeSupplierRebuild.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceSupplierEngineError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus = 400) {
    super(message);
    this.name = "FinanceSupplierEngineError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type OfficialSupplierSearchInput = {
  search?: string;
  limit?: number;
  /** Incluir cadastros INACTIVE na busca (padrão: false). */
  includeInactive?: boolean;
};

export type EnsureSupplierFromApIdentityInput = {
  identityKey?: string;
  personName?: string;
  personDocument?: string | null;
  accountsPayableId?: number;
};

export type EnsureSupplierFromApIdentityResult = {
  supplierId: string;
  displayName: string;
  document: string | null;
  created: boolean;
  identityKey: string;
};

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return decimalFieldToNumber(value);
}

/** Verifica se um grupo AP corresponde ao termo de busca (nome, documento, código). */
export function apGroupMatchesSearchTerm(group: FinanceSupplierApGroup, rawSearch: string): boolean {
  const search = (rawSearch ?? "").trim();
  if (!search) return true;

  const lower = search.toLowerCase();
  const normalizedSearch = normalizeSupplierName(search);
  const displayName = pickDisplayName(group);

  const candidateNames = [displayName, group.extracted.originalName].filter(Boolean) as string[];
  for (const name of candidateNames) {
    if (name.toLowerCase().includes(lower)) return true;
    const normalized = normalizeSupplierName(name);
    if (normalizedSearch && normalized?.includes(normalizedSearch)) return true;
  }

  const digits = search.replace(/\D/g, "");
  if (digits.length >= 2) {
    const doc = group.extracted.normalizedDocument ?? "";
    if (doc.includes(digits)) return true;
    const origDoc = (group.extracted.originalDocument ?? "").replace(/\D/g, "");
    if (origDoc.includes(digits)) return true;
  }

  if (/^\d+$/.test(search) && group.extracted.externalSupplierId != null) {
    if (String(group.extracted.externalSupplierId).includes(search)) return true;
  }

  return false;
}

function serializeMasterSearchRow(
  row: FinanceSupplierSearchRow,
  extras: {
    matched: boolean;
    hasActiveRule: boolean;
    displayNameOverride?: string;
  }
): FinanceSupplierSearchResult {
  const base = serializeFinancialSupplierSearchRow(row);
  return {
    ...base,
    name: extras.displayNameOverride ?? base.name,
    matched: extras.matched,
    source: "MASTER",
    status: row.status,
    hasActiveRule: extras.hasActiveRule,
    identityKey: null,
  };
}

function serializeApOnlyGroup(
  group: FinanceSupplierApGroup,
  hasActiveRule: boolean
): FinanceSupplierSearchResult {
  const displayName = pickDisplayName(group);
  const document =
    group.extracted.originalDocument ??
    (group.extracted.normalizedDocument ? group.extracted.normalizedDocument : null);
  return {
    id: null,
    identityKey: group.identityKey,
    name: displayName,
    document,
    externalCode:
      group.extracted.externalSupplierId != null
        ? String(group.extracted.externalSupplierId)
        : null,
    titlesCount: group.recordCount,
    lastTitleDate: null,
    totalValue: null,
    matched: false,
    source: "AP_ONLY",
    status: null,
    hasActiveRule,
  };
}

async function loadMasterSearchRows(
  search: string,
  limit: number,
  includeInactive: boolean
): Promise<FinanceSupplierSearchRow[]> {
  const where = buildFinancialSupplierSearchWhere(search);
  const statusFilter: Prisma.FinancialSupplierWhereInput = includeInactive
    ? {}
    : { status: { not: "INACTIVE" } };

  const combinedWhere: Prisma.FinancialSupplierWhereInput =
    Object.keys(where).length > 0 ? { AND: [where, statusFilter] } : statusFilter;

  return prisma.financialSupplier.findMany({
    where: combinedWhere,
    orderBy: [{ titlesCount: "desc" }, { displayName: "asc" }],
    take: limit,
    select: {
      id: true,
      displayName: true,
      document: true,
      normalizedDocument: true,
      status: true,
      titlesCount: true,
      totalAmountSeen: true,
      lastSeenAt: true,
      aliases: {
        select: { externalSupplierId: true },
        orderBy: { titlesCount: "desc" },
      },
    },
  });
}

async function loadApGroups(): Promise<FinanceSupplierApGroup[]> {
  const rows = await prisma.nomusAccountsPayable.findMany({
    select: {
      externalId: true,
      personId: true,
      personName: true,
      personCnpj: true,
      companyId: true,
      companyName: true,
      rawPayload: true,
    },
    orderBy: { externalId: "asc" },
  });
  return groupAccountsPayableSuppliers(rows);
}

async function loadSupplierIdsWithActiveRules(): Promise<Set<string>> {
  const rows = await prisma.supplierCostCenterRule.findMany({
    where: { isActive: true },
    select: { supplierId: true },
    distinct: ["supplierId"],
  });
  return new Set(rows.map((row) => row.supplierId));
}

function findApGroup(input: EnsureSupplierFromApIdentityInput, groups: FinanceSupplierApGroup[]): FinanceSupplierApGroup | null {
  if (input.identityKey?.trim()) {
    return groups.find((group) => group.identityKey === input.identityKey!.trim()) ?? null;
  }

  if (input.accountsPayableId != null && Number.isFinite(input.accountsPayableId)) {
    const apId = Math.trunc(input.accountsPayableId);
    return (
      groups.find((group) => group.records.some((record) => record.externalId === apId)) ?? null
    );
  }

  const personName = (input.personName ?? "").trim();
  if (!personName) return null;

  const normalizedTarget = normalizeSupplierName(personName);
  const matches = groups.filter((group) => {
    const display = pickDisplayName(group);
    if (display.trim() === personName) return true;
    if (normalizedTarget && group.extracted.normalizedName === normalizedTarget) return true;
    return normalizeSupplierName(display) === normalizedTarget;
  });

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  const doc = normalizeSupplierDocument(input.personDocument);
  if (doc) {
    const byDoc = matches.find((group) => group.extracted.normalizedDocument === doc);
    if (byDoc) return byDoc;
  }

  return matches.sort((a, b) => b.recordCount - a.recordCount)[0] ?? null;
}

/**
 * Busca unificada: cadastro gerencial + origens AP ainda não casadas.
 * Nunca retorna menos cobertura que a aba Fornecedores para o mesmo termo.
 */
export async function searchOfficialFinancialSuppliers(
  input: OfficialSupplierSearchInput = {}
): Promise<{ suppliers: FinanceSupplierSearchResult[] }> {
  const search = (input.search ?? "").trim();
  const limit = clampSupplierSearchLimit(input.limit);
  const includeInactive = input.includeInactive === true;

  if (search.length > 0 && search.length < 2 && !/^\d+$/.test(search)) {
    return { suppliers: [] };
  }

  const [masterRows, apGroups, existingSuppliers, ruleSupplierIds] = await Promise.all([
    loadMasterSearchRows(search, limit * 3, includeInactive),
    search.length > 0 ? loadApGroups() : Promise.resolve([]),
    search.length > 0
      ? prisma.financialSupplier.findMany({ include: { aliases: true } })
      : Promise.resolve([]),
    loadSupplierIdsWithActiveRules(),
  ]);

  const index = buildSupplierMatchIndex(
    existingSuppliers.map((row) => ({
      ...row,
      aliases: row.aliases.map((alias) => ({ ...alias })),
    }))
  );

  const results: FinanceSupplierSearchResult[] = [];
  const seenMasterIds = new Set<string>();
  const seenIdentityKeys = new Set<string>();

  for (const row of masterRows) {
    if (seenMasterIds.has(row.id)) continue;
    seenMasterIds.add(row.id);
    results.push(
      serializeMasterSearchRow(row, {
        matched: true,
        hasActiveRule: ruleSupplierIds.has(row.id),
      })
    );
  }

  if (search.length > 0) {
    for (const group of apGroups) {
      if (!apGroupMatchesSearchTerm(group, search)) continue;
      if (seenIdentityKeys.has(group.identityKey)) continue;

      const existing = findExistingSupplierForGroup(group, index);
      if (existing && existing.status !== "INACTIVE") {
        if (!seenMasterIds.has(existing.id)) {
          seenMasterIds.add(existing.id);
          results.push(
            serializeMasterSearchRow(
              {
                id: existing.id,
                displayName: existing.displayName,
                document: existing.document,
                normalizedDocument: existing.normalizedDocument,
                status: existing.status,
                titlesCount: group.recordCount,
                totalAmountSeen: existing.totalAmountSeen,
                lastSeenAt: existing.lastSeenAt,
                aliases: existing.aliases.map((alias) => ({
                  externalSupplierId: alias.externalSupplierId,
                })),
              },
              {
                matched: true,
                hasActiveRule: ruleSupplierIds.has(existing.id),
                displayNameOverride: pickDisplayName(group),
              }
            )
          );
        }
        seenIdentityKeys.add(group.identityKey);
        continue;
      }

      seenIdentityKeys.add(group.identityKey);
      results.push(serializeApOnlyGroup(group, false));
    }
  }

  results.sort((a, b) => {
    const countDiff = (b.titlesCount ?? 0) - (a.titlesCount ?? 0);
    if (countDiff !== 0) return countDiff;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return { suppliers: results.slice(0, limit) };
}

export async function searchOfficialFinancialSuppliersDefault(
  input: OfficialSupplierSearchInput = {}
): Promise<{ suppliers: FinanceSupplierSearchResult[] }> {
  return searchOfficialFinancialSuppliers(input);
}

/**
 * Materializa cadastro gerencial mínimo a partir de identidade AP (sem alterar Nomus/AP).
 */
export async function ensureFinancialSupplierFromApIdentity(
  deps: FinanceSupplierRebuildDeps,
  input: EnsureSupplierFromApIdentityInput,
  user: FinanceSupplierRebuildUserContext
): Promise<EnsureSupplierFromApIdentityResult> {
  const groups = groupAccountsPayableSuppliers(await deps.loadApRows());
  const group = findApGroup(input, groups);

  if (!group) {
    throw new FinanceSupplierEngineError(
      "Origem AP não encontrada para os critérios informados.",
      "AP_IDENTITY_NOT_FOUND",
      404
    );
  }

  const existingSuppliers = await deps.loadExistingSuppliers();
  const index = buildSupplierMatchIndex(existingSuppliers);
  const existing = findExistingSupplierForGroup(group, index);

  const { supplier, action } = await upsertFinancialSupplierFromGroup(deps, group, existing, user);
  await upsertFinancialSupplierAliases(deps, supplier, group, user);

  return {
    supplierId: supplier.id,
    displayName: supplier.displayName,
    document: supplier.document,
    created: action === "create",
    identityKey: group.identityKey,
  };
}

export async function ensureFinancialSupplierFromApIdentityDefault(
  input: EnsureSupplierFromApIdentityInput,
  user: FinanceSupplierRebuildUserContext
): Promise<EnsureSupplierFromApIdentityResult> {
  return ensureFinancialSupplierFromApIdentity(
    createDefaultFinanceSupplierRebuildDeps(),
    input,
    user
  );
}

/** Resolve identityKey a partir de nome/documento de título AP (somente leitura). */
export function resolveApIdentityKeyFromPerson(
  personName: string | null | undefined,
  personDocument?: string | null,
  accountsPayableId?: number
): string | null {
  const extracted = extractSupplierFromAccountsPayable({
    externalId: accountsPayableId ?? 0,
    personName,
    personCnpj: personDocument ?? null,
  });
  return buildSupplierIdentityKey(extracted, accountsPayableId);
}

export type OfficialSupplierEngineAuditSnapshot = {
  totalMasterSuppliers: number;
  totalActiveMasters: number;
  totalInactiveMasters: number;
  totalApGroups: number;
  totalApOnlyGroups: number;
  totalWithoutDocument: number;
  totalWithActiveRules: number;
  dashboardSupplierNames: number;
  searchableSupplierNames: number;
  missingFromSearch: Array<{ name: string; document: string | null; identityKey: string }>;
  unclassifiedNotSearchable: Array<{ name: string; cause: string | null }>;
};

/** Snapshot read-only para auditoria de cobertura do motor oficial. */
export async function buildOfficialSupplierEngineAuditSnapshot(input: {
  dashboardSupplierNames: string[];
  unclassifiedSupplierNames: Array<{ name: string; cause: string | null }>;
}): Promise<OfficialSupplierEngineAuditSnapshot> {
  const [masters, apGroups] = await Promise.all([
    prisma.financialSupplier.findMany({
      select: {
        id: true,
        status: true,
        document: true,
        normalizedDocument: true,
      },
    }),
    loadApGroups(),
  ]);

  const existingSuppliers = await prisma.financialSupplier.findMany({ include: { aliases: true } });
  const index = buildSupplierMatchIndex(
    existingSuppliers.map((row) => ({
      ...row,
      aliases: row.aliases.map((alias) => ({ ...alias })),
    }))
  );

  let apOnly = 0;
  let withoutDocument = 0;
  for (const group of apGroups) {
    const existing = findExistingSupplierForGroup(group, index);
    if (!existing || existing.status === "INACTIVE") apOnly += 1;
    if (!group.extracted.normalizedDocument) withoutDocument += 1;
  }

  const activeRules = await prisma.supplierCostCenterRule.count({ where: { isActive: true } });

  const missingFromSearch: OfficialSupplierEngineAuditSnapshot["missingFromSearch"] = [];
  for (const name of input.dashboardSupplierNames) {
    const term = name.trim().slice(0, Math.min(8, name.trim().length));
    if (term.length < 2) continue;
    const { suppliers } = await searchOfficialFinancialSuppliers({ search: term, limit: 50 });
    const hit = suppliers.some(
      (row) =>
        row.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(row.name.toLowerCase())
    );
    if (!hit) {
      missingFromSearch.push({
        name,
        document: null,
        identityKey: resolveApIdentityKeyFromPerson(name) ?? name,
      });
    }
  }

  const unclassifiedNotSearchable: OfficialSupplierEngineAuditSnapshot["unclassifiedNotSearchable"] =
    [];
  for (const row of input.unclassifiedSupplierNames) {
    const term = row.name.trim().slice(0, Math.min(8, row.name.trim().length));
    if (term.length < 2) continue;
    const { suppliers } = await searchOfficialFinancialSuppliers({ search: term, limit: 50 });
    const hit = suppliers.some((s) => s.name.toLowerCase().includes(term.toLowerCase()));
    if (!hit) unclassifiedNotSearchable.push(row);
  }

  const searchableNames = new Set<string>();
  for (const group of apGroups) {
    searchableNames.add(pickDisplayName(group).toLowerCase());
  }
  for (const master of masters) {
    if (master.status !== "INACTIVE") {
      // displayName loaded separately if needed — count AP + masters
    }
  }

  return {
    totalMasterSuppliers: masters.length,
    totalActiveMasters: masters.filter((m) => m.status === "ACTIVE").length,
    totalInactiveMasters: masters.filter((m) => m.status === "INACTIVE").length,
    totalApGroups: apGroups.length,
    totalApOnlyGroups: apOnly,
    totalWithoutDocument: withoutDocument,
    totalWithActiveRules: activeRules,
    dashboardSupplierNames: input.dashboardSupplierNames.length,
    searchableSupplierNames: searchableNames.size,
    missingFromSearch,
    unclassifiedNotSearchable,
  };
}
