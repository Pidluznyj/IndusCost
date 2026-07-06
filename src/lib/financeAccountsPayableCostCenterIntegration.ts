import type { Prisma } from "@prisma/client";
import {
  decimalFieldToNumber,
  roundMoney,
  safeRatio,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import { filterOfficialApTitlesForCostCenter } from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import type { FinanceApTitleListItem, FinanceApTitlesPayload } from "@/src/lib/financeAccountsPayableTitles.js";
import {
  buildFinanceApExportCsv,
  FINANCE_AP_EXPORT_HEADERS,
  mapFinanceApRowToExportCells,
} from "@/src/lib/financeAccountsPayableExport.js";
import { fleetRowsToCsv } from "@/src/lib/fleetCsv.js";
import {
  isTitleFullyClassified,
  resolveCostCenterTitleAmount,
  resolveTitleAllocatedAmount,
  resolveTitleUnallocatedGap,
} from "@/src/lib/financeCostCenterAllocationMetrics.js";
import type {
  AllocationDashboardRow,
  CostCenterMetaRow,
} from "@/src/lib/financeCostCenterDashboard.js";
import { FINANCE_AP_ALLOCATION_AUDIT_ENTITY } from "@/src/lib/financeApAllocationShared.js";
import {
  accountsPayableMatchesFinancialSupplier,
  type SupplierWithAliases,
} from "@/src/lib/financeSupplierCostCenterRules.js";
import { resolveSupplierForAccountsPayable } from "@/src/lib/financeAccountsPayableCostCenterAllocation.js";
import type { NomusApReportSyncCutoff } from "@/src/lib/financeNomusApReportFreshness.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  FINANCE_AP_NO_CLASSIFICATION,
  FINANCE_AP_UNIDENTIFIED_SUPPLIER,
  type FinanceApClassificationStatusFilter,
} from "@/src/lib/financeAccountsPayableCostCenterShared.js";
import type {
  FinanceApClassificationAuditEntry,
  FinanceApClassificationFilterOptions,
  FinanceApClassificationSummary,
  FinanceApTitleClassificationDetail,
  FinanceApTitleClassificationEnrichment,
  FinanceApTitleClassificationLine,
} from "@/src/lib/financeAccountsPayableCostCenterTypes.js";

export {
  FINANCE_AP_NO_CLASSIFICATION,
  FINANCE_AP_UNIDENTIFIED_SUPPLIER,
  FINANCE_AP_CLASSIFICATION_STATUS_OPTIONS,
  type FinanceApClassificationStatusFilter,
} from "@/src/lib/financeAccountsPayableCostCenterShared.js";
export type {
  FinanceApClassificationAuditEntry,
  FinanceApClassificationFilterOptions,
  FinanceApClassificationSummary,
  FinanceApTitleClassificationDetail,
  FinanceApTitleClassificationEnrichment,
  FinanceApTitleClassificationLine,
} from "@/src/lib/financeAccountsPayableCostCenterTypes.js";

export const FINANCE_AP_CLASSIFICATION_EXPORT_HEADERS = [
  "Fornecedor consolidado",
  "Centro de custo",
  "Origem classificação",
  "Percentual classificação",
  "Valor alocado",
] as const;

export type ApIntegrationAllocationRow = AllocationDashboardRow & {
  source: "AUTO_RULE" | "MANUAL" | "BATCH";
  lockedManual: boolean;
  ruleId: string | null;
};

export type ApCostCenterIntegrationContext = {
  allocationsByPayable: Map<number, ApIntegrationAllocationRow[]>;
  costCenterById: Map<string, CostCenterMetaRow>;
  suppliers: SupplierWithAliases[];
  rulesById: Map<string, { id: string; supplierId: string; costCenterId: string }>;
};

export type ApCostCenterIntegrationDeps = {
  loadAllocations: (externalIds: number[]) => Promise<ApIntegrationAllocationRow[]>;
  loadCostCenters: () => Promise<CostCenterMetaRow[]>;
  loadSuppliers: () => Promise<SupplierWithAliases[]>;
  loadRules: () => Promise<Array<{ id: string; supplierId: string; costCenterId: string }>>;
  loadAuditForPayable: (
    externalId: number,
    allocationIds: string[]
  ) => Promise<FinanceApClassificationAuditEntry[]>;
};

function finiteMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(value);
}

function safePercent(part: number, total: number): number {
  return finiteMoney(safeRatio(part, total) * 100);
}

export function parseFinanceApClassificationStatusFilter(
  value: unknown
): FinanceApClassificationStatusFilter {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "classified" || raw === "classificados" || raw === "classificado") return "classified";
  if (raw === "unclassified" || raw === "sem_classificacao" || raw === "sem classificação") {
    return "unclassified";
  }
  if (raw === "manual") return "manual";
  if (raw === "automatic" || raw === "automatico" || raw === "automático") return "automatic";
  if (raw === "split" || raw === "rateio") return "split";
  return "all";
}

export function formatApAllocationSourceLabel(
  source: "AUTO_RULE" | "MANUAL" | "BATCH" | null | undefined
): string {
  if (source === "AUTO_RULE") return "Regra automática";
  if (source === "MANUAL") return "Manual";
  if (source === "BATCH") return "Lote automático";
  return "—";
}

function resolveFinancialSupplier(
  row: FinanceApDashboardRow,
  suppliers: SupplierWithAliases[]
): SupplierWithAliases | null {
  for (const supplier of suppliers) {
    if (supplier.status !== "ACTIVE") continue;
    if (accountsPayableMatchesFinancialSupplier(row, supplier)) return supplier;
  }
  return null;
}

function resolveConsolidatedSupplier(
  row: FinanceApDashboardRow,
  allocations: ApIntegrationAllocationRow[],
  suppliers: SupplierWithAliases[]
): { id: string | null; name: string; document: string | null } {
  const allocationSupplierId = allocations.find((a) => a.supplierId)?.supplierId ?? null;
  if (allocationSupplierId) {
    const fromAllocation = suppliers.find((s) => s.id === allocationSupplierId);
    if (fromAllocation) {
      return {
        id: fromAllocation.id,
        name: fromAllocation.displayName,
        document: fromAllocation.normalizedDocument,
      };
    }
  }
  const resolved = resolveSupplierForAccountsPayable(row, suppliers);
  if (resolved) {
    return {
      id: resolved.id,
      name: resolved.displayName,
      document: resolved.normalizedDocument,
    };
  }
  const matched = resolveFinancialSupplier(row, suppliers);
  if (matched) {
    return {
      id: matched.id,
      name: matched.displayName,
      document: matched.normalizedDocument,
    };
  }
  return {
    id: null,
    name: FINANCE_AP_UNIDENTIFIED_SUPPLIER,
    document: row.personCnpj,
  };
}

function resolveCostCenterLabel(
  allocations: ApIntegrationAllocationRow[],
  costCenterById: Map<string, CostCenterMetaRow>
): string {
  if (allocations.length === 0) return FINANCE_AP_NO_CLASSIFICATION;
  const uniqueCc = new Set(allocations.map((a) => a.costCenterId));
  if (uniqueCc.size > 1) return "Rateio";
  const ccId = allocations[0]?.costCenterId;
  if (!ccId) return FINANCE_AP_NO_CLASSIFICATION;
  const meta = costCenterById.get(ccId);
  return meta ? `${meta.code} — ${meta.name}` : ccId;
}

function resolveAllocationShareAmount(
  allocation: ApIntegrationAllocationRow,
  titleAmount: number
): number {
  const explicit = allocation.amount != null ? decimalFieldToNumber(allocation.amount) : 0;
  if (explicit > 0) return finiteMoney(explicit);
  return finiteMoney((titleAmount * decimalFieldToNumber(allocation.percentage)) / 100);
}

function resolveClassificationOriginKey(
  allocations: ApIntegrationAllocationRow[]
): "AUTO_RULE" | "MANUAL" | "BATCH" | "mixed" | null {
  if (allocations.length === 0) return null;
  const sources = new Set(allocations.map((a) => a.source));
  if (sources.size > 1) return "mixed";
  return allocations[0]!.source;
}

export function resolveApClassificationOriginLabel(
  allocations: ApIntegrationAllocationRow[]
): string {
  const key = resolveClassificationOriginKey(allocations);
  if (!key) return "—";
  if (key === "mixed") return "Misto";
  return formatApAllocationSourceLabel(key);
}

export function resolveApClassificationStatusKey(
  allocations: ApIntegrationAllocationRow[]
): FinanceApClassificationStatusFilter | "classified" {
  const classified = isTitleFullyClassified(allocations);
  if (!classified) return "unclassified";
  const uniqueCc = new Set(allocations.map((a) => a.costCenterId));
  if (uniqueCc.size > 1 || allocations.length > 1) return "split";
  const origin = resolveClassificationOriginKey(allocations);
  if (origin === "MANUAL" || allocations.some((a) => a.lockedManual)) return "manual";
  return "automatic";
}

export function resolveApClassificationStatusLabel(
  allocations: ApIntegrationAllocationRow[]
): string {
  const key = resolveApClassificationStatusKey(allocations);
  if (key === "unclassified") return FINANCE_AP_NO_CLASSIFICATION;
  if (key === "split") return "Rateio";
  if (key === "manual") return "Manual";
  if (key === "automatic") return "Automático";
  return "Classificado";
}

function resolveRuleLabel(
  ruleId: string | null,
  rulesById: Map<string, { id: string; supplierId: string; costCenterId: string }>,
  costCenterById: Map<string, CostCenterMetaRow>
): string | null {
  if (!ruleId) return null;
  const rule = rulesById.get(ruleId);
  if (!rule) return `Regra ${ruleId}`;
  const cc = costCenterById.get(rule.costCenterId);
  return cc ? `Regra → ${cc.code}` : `Regra ${ruleId}`;
}

export function enrichApTitleClassification(
  row: FinanceApDashboardRow,
  ctx: ApCostCenterIntegrationContext,
  referenceDate: Date = new Date()
): FinanceApTitleClassificationEnrichment {
  void referenceDate;
  const allocations = ctx.allocationsByPayable.get(row.externalId) ?? [];
  const titleAmount = resolveCostCenterTitleAmount(row, "open_only");
  const classified = isTitleFullyClassified(allocations, titleAmount);
  const supplier = resolveConsolidatedSupplier(row, allocations, ctx.suppliers);
  const lines: FinanceApTitleClassificationLine[] = allocations.map((allocation) => {
    const meta = ctx.costCenterById.get(allocation.costCenterId);
    return {
      allocationId: allocation.id,
      costCenterId: allocation.costCenterId,
      costCenterCode: meta?.code ?? allocation.costCenterId,
      costCenterName: meta?.name ?? allocation.costCenterId,
      percentage: finiteMoney(decimalFieldToNumber(allocation.percentage)),
      amount: resolveAllocationShareAmount(allocation, titleAmount),
      source: allocation.source,
      sourceLabel: formatApAllocationSourceLabel(allocation.source),
      ruleId: allocation.ruleId,
      ruleLabel: resolveRuleLabel(allocation.ruleId, ctx.rulesById, ctx.costCenterById),
      lockedManual: allocation.lockedManual,
    };
  });
  const allocatedPercentage = classified
    ? finiteMoney(allocations.reduce((sum, a) => sum + decimalFieldToNumber(a.percentage), 0))
    : 0;
  const statusKey = resolveApClassificationStatusKey(allocations);

  return {
    consolidatedSupplierId: supplier.id,
    consolidatedSupplierName: supplier.name,
    consolidatedSupplierDocument: supplier.document,
    costCenterLabel: classified ? resolveCostCenterLabel(allocations, ctx.costCenterById) : FINANCE_AP_NO_CLASSIFICATION,
    classificationOriginLabel: classified
      ? resolveApClassificationOriginLabel(allocations)
      : "—",
    classificationStatusLabel: resolveApClassificationStatusLabel(allocations),
    classificationStatusKey: statusKey,
    isClassified: classified,
    isSplit: statusKey === "split",
    isManualLocked: allocations.some((a) => a.lockedManual),
    allocatedPercentage,
    allocatedAmount: classified
      ? titleAmount
      : finiteMoney(resolveTitleAllocatedAmount(allocations, titleAmount)),
    lines,
  };
}

export function attachClassificationFieldsToTitleItem(
  item: FinanceApTitleListItem,
  enrichment: FinanceApTitleClassificationEnrichment
): FinanceApTitleListItem {
  return {
    ...item,
    consolidatedSupplierName: enrichment.consolidatedSupplierName,
    costCenterLabel: enrichment.costCenterLabel,
    classificationOriginLabel: enrichment.classificationOriginLabel,
    classificationStatusLabel: enrichment.classificationStatusLabel,
    isClassified: enrichment.isClassified,
  };
}

export function matchesApClassificationFilters(
  row: FinanceApDashboardRow,
  ctx: ApCostCenterIntegrationContext,
  filters: {
    costCenterId?: string;
    supplierId?: string;
    classificationStatus?: FinanceApClassificationStatusFilter;
  }
): boolean {
  const allocations = ctx.allocationsByPayable.get(row.externalId) ?? [];
  const costCenterId = filters.costCenterId?.trim();
  if (costCenterId && !allocations.some((a) => a.costCenterId === costCenterId)) {
    return false;
  }
  const supplierId = filters.supplierId?.trim();
  if (supplierId) {
    const supplier = resolveConsolidatedSupplier(row, allocations, ctx.suppliers);
    if (supplier.id !== supplierId) return false;
  }
  const statusFilter = filters.classificationStatus ?? "all";
  if (statusFilter === "all") return true;
  const statusKey = resolveApClassificationStatusKey(allocations);
  if (statusFilter === "classified") return statusKey !== "unclassified";
  if (statusFilter === "unclassified") return statusKey === "unclassified";
  return statusKey === statusFilter;
}

export function filterApRowsByClassification(
  rows: FinanceApDashboardRow[],
  ctx: ApCostCenterIntegrationContext,
  filters: {
    costCenterId?: string;
    supplierId?: string;
    classificationStatus?: FinanceApClassificationStatusFilter;
  }
): FinanceApDashboardRow[] {
  const hasFilter =
    Boolean(filters.costCenterId?.trim()) ||
    Boolean(filters.supplierId?.trim()) ||
    (filters.classificationStatus && filters.classificationStatus !== "all");
  if (!hasFilter) return rows;
  return rows.filter((row) => matchesApClassificationFilters(row, ctx, filters));
}

export function computeApClassificationSummary(
  rows: FinanceApDashboardRow[],
  ctx: ApCostCenterIntegrationContext
): FinanceApClassificationSummary {
  let classifiedAmount = 0;
  let unclassifiedAmount = 0;
  for (const row of rows) {
    const allocations = ctx.allocationsByPayable.get(row.externalId) ?? [];
    const amount = resolveCostCenterTitleAmount(row, "open_only");
    const allocated = resolveTitleAllocatedAmount(allocations, amount);
    const gap = resolveTitleUnallocatedGap(allocations, amount);
    classifiedAmount += allocated;
    unclassifiedAmount += gap;
  }
  const total = classifiedAmount + unclassifiedAmount;
  return {
    classifiedAmount: finiteMoney(classifiedAmount),
    unclassifiedAmount: finiteMoney(unclassifiedAmount),
    classifiedPercentage: safePercent(classifiedAmount, total),
  };
}

export function buildApClassificationFilterOptions(
  costCenters: CostCenterMetaRow[],
  suppliers: SupplierWithAliases[]
): FinanceApClassificationFilterOptions {
  return {
    costCenters: costCenters
      .filter((cc) => cc.status === "ACTIVE")
      .map((cc) => ({ id: cc.id, code: cc.code, name: cc.name }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    suppliers: suppliers
      .filter((s) => s.status === "ACTIVE")
      .map((s) => ({
        id: s.id,
        name: s.displayName,
        document: s.normalizedDocument,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function buildApCostCenterIntegrationContext(
  externalIds: number[],
  deps: ApCostCenterIntegrationDeps
): Promise<ApCostCenterIntegrationContext> {
  const uniqueIds = [...new Set(externalIds)];
  const [allocations, costCenters, suppliers, rules] = await Promise.all([
    deps.loadAllocations(uniqueIds),
    deps.loadCostCenters(),
    deps.loadSuppliers(),
    deps.loadRules(),
  ]);
  const allocationsByPayable = new Map<number, ApIntegrationAllocationRow[]>();
  for (const allocation of allocations) {
    const list = allocationsByPayable.get(allocation.accountsPayableId) ?? [];
    list.push(allocation);
    allocationsByPayable.set(allocation.accountsPayableId, list);
  }
  return {
    allocationsByPayable,
    costCenterById: new Map(costCenters.map((cc) => [cc.id, cc])),
    suppliers,
    rulesById: new Map(rules.map((rule) => [rule.id, rule])),
  };
}

function summarizeAuditEntry(entry: {
  action: string;
  entityType: string;
  beforeJson: Prisma.JsonValue;
  afterJson: Prisma.JsonValue;
}): string {
  if (entry.action === "BATCH_APPLY") return "Classificação em lote aplicada";
  if (entry.action === "CREATE") return "Classificação criada";
  if (entry.action === "UPDATE") return "Classificação atualizada";
  if (entry.action === "DELETE") return "Classificação removida";
  if (entry.action === "MANUAL_RECLASSIFICATION") return "Reclassificação manual de centro de custo";
  return entry.action;
}

export function createDefaultApCostCenterIntegrationDeps(): ApCostCenterIntegrationDeps {
  return {
    loadAllocations: async (externalIds) => {
      if (externalIds.length === 0) return [];
      return prisma.accountsPayableCostCenterAllocation.findMany({
        where: { accountsPayableId: { in: externalIds } },
        select: {
          id: true,
          accountsPayableId: true,
          supplierId: true,
          costCenterId: true,
          amount: true,
          percentage: true,
          source: true,
          lockedManual: true,
          ruleId: true,
        },
      });
    },
    loadCostCenters: async () =>
      prisma.financialCostCenter.findMany({
        select: { id: true, code: true, name: true, status: true },
      }),
    loadSuppliers: async () =>
      prisma.financialSupplier.findMany({
        select: {
          id: true,
          displayName: true,
          status: true,
          normalizedDocument: true,
          normalizedName: true,
          aliases: {
            select: {
              externalSupplierId: true,
              normalizedDocument: true,
              normalizedName: true,
            },
          },
        },
      }),
    loadRules: async () =>
      prisma.supplierCostCenterRule.findMany({
        where: { isActive: true },
        select: { id: true, supplierId: true, costCenterId: true },
      }),
    loadAuditForPayable: async (externalId, allocationIds) => {
      const entityIds = [
        String(externalId),
        ...allocationIds,
        FINANCE_AP_ALLOCATION_AUDIT_ENTITY.BATCH_RUN,
      ];
      const rows = await prisma.financialCostCenterAuditLog.findMany({
        where: {
          OR: [
            {
              entityType: FINANCE_AP_ALLOCATION_AUDIT_ENTITY.ALLOCATION,
              entityId: { in: allocationIds },
            },
            {
              entityType: FINANCE_AP_ALLOCATION_AUDIT_ENTITY.BATCH_RUN,
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          userName: true,
          createdAt: true,
          beforeJson: true,
          afterJson: true,
        },
      });
      void entityIds;
      return rows
        .filter((row) => {
          if (row.entityType === FINANCE_AP_ALLOCATION_AUDIT_ENTITY.ALLOCATION) {
            return allocationIds.includes(row.entityId);
          }
          if (row.entityType === FINANCE_AP_ALLOCATION_AUDIT_ENTITY.BATCH_RUN) {
            const after = row.afterJson as { accountsPayableIds?: number[] } | null;
            return Array.isArray(after?.accountsPayableIds)
              ? after.accountsPayableIds.includes(externalId)
              : false;
          }
          return false;
        })
        .map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          userName: row.userName,
          createdAt: row.createdAt.toISOString(),
          summary: summarizeAuditEntry(row),
        }));
    },
  };
}

export async function buildApTitleClassificationDetailDefault(
  row: FinanceApDashboardRow,
  referenceDate: Date = new Date()
): Promise<FinanceApTitleClassificationDetail> {
  const deps = createDefaultApCostCenterIntegrationDeps();
  const ctx = await buildApCostCenterIntegrationContext([row.externalId], deps);
  const enrichment = enrichApTitleClassification(row, ctx, referenceDate);
  const allocationIds = (ctx.allocationsByPayable.get(row.externalId) ?? []).map((a) => a.id);
  const auditHistory = await deps.loadAuditForPayable(row.externalId, allocationIds);
  return { externalId: row.externalId, enrichment, auditHistory };
}

export function enrichFinanceApTitlesPayload(
  payload: FinanceApTitlesPayload,
  rowsById: Map<number, FinanceApDashboardRow>,
  ctx: ApCostCenterIntegrationContext,
  referenceDate: Date = new Date()
): FinanceApTitlesPayload {
  return {
    ...payload,
    items: payload.items.map((item) => {
      const row = rowsById.get(item.externalId);
      if (!row) return item;
      return attachClassificationFieldsToTitleItem(
        item,
        enrichApTitleClassification(row, ctx, referenceDate)
      );
    }),
  };
}

export function mapApClassificationToExportCells(
  enrichment: FinanceApTitleClassificationEnrichment
): string[] {
  const pct =
    enrichment.isClassified && enrichment.allocatedPercentage > 0
      ? enrichment.allocatedPercentage.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";
  const amount =
    enrichment.isClassified && enrichment.allocatedAmount > 0
      ? enrichment.allocatedAmount.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";
  return [
    enrichment.consolidatedSupplierName,
    enrichment.costCenterLabel,
    enrichment.isClassified ? enrichment.classificationOriginLabel : "—",
    pct,
    amount,
  ];
}

export function buildFinanceApExportCsvWithClassification(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  ctx: ApCostCenterIntegrationContext,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusApReportSyncCutoff | null
): string {
  const filtered = filterOfficialApTitlesForCostCenter(rows, filters, referenceDate, syncCutoff);
  const headers = [...FINANCE_AP_EXPORT_HEADERS, ...FINANCE_AP_CLASSIFICATION_EXPORT_HEADERS];
  const dataRows = filtered.map((row) => {
    const base = mapFinanceApRowToExportCells(row, referenceDate);
    const enrichment = enrichApTitleClassification(row, ctx, referenceDate);
    return [...base, ...mapApClassificationToExportCells(enrichment)];
  });
  return fleetRowsToCsv(headers, dataRows);
}

/** Mantém CSV legado disponível — use buildFinanceApExportCsv para export sem classificação. */
export { buildFinanceApExportCsv };
