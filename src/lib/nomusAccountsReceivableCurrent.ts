/**
 * Regra central de AR vigente — títulos de pedido sem NF substituídos no Nomus.
 *
 * Quando o Nomus altera uma parcela de pedido, cria um novo externalId e mantém o histórico.
 * Esta camada identifica o título vigente por chave de negócio (empresa + pessoa + pedido + parcela)
 * e exclui obsoletos seguros das leituras gerenciais, preservando auditoria e conflitos protegidos.
 */
import { deduplicateFinanceArRows } from "./financeAccountsReceivableDeduplication.js";
import {
  hasFinanceArSourceInvoice,
  isFinanceArOpen,
  roundMoney,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";

export const AR_ORDER_PARCEL_FULL_DESCRIPTION_RE =
  /pedido\s+pd\s*[- ]?0*(\d+)\s*[-–—]\s*parcela\s*(\d+)(?:\s+de\s+(\d+))?/i;

export type ParsedOrderParcelReceivableRef = {
  orderCode: string;
  installmentNumber: number;
  totalInstallments: number | null;
};

export type OrderParcelReceivableBusinessKey = {
  companyKey: string;
  personKey: string;
  orderCode: string;
  installmentNumber: number;
  totalInstallments: number | null;
};

export type ArOrderParcelProtectedConflict = {
  businessKey: string;
  orderCode: string;
  installmentNumber: number;
  totalInstallments: number | null;
  currentExternalId: number;
  protectedExternalId: number;
  protectionReasons: string[];
  amountReceivable: number;
  balanceReceivable: number;
};

export type ArOrderParcelAuditGroup = {
  businessKey: string;
  orderCode: string;
  personName: string | null;
  personId: number | null;
  companyName: string | null;
  companyId: number | null;
  installmentNumber: number;
  totalInstallments: number | null;
  externalIds: number[];
  amounts: number[];
  balances: number[];
  dueDates: (string | null)[];
  modifiedAtNomus: (string | null)[];
  createdAtNomus: (string | null)[];
  syncedAt: string[];
  currentExternalId: number;
  obsoleteExternalIds: number[];
  protectedExternalIds: number[];
  grossAmount: number;
  currentAmount: number;
  obsoleteAmount: number;
  protectedAmount: number;
  requiresManualReview: boolean;
};

export type OrderParcelReceivableResolution = {
  keptExternalIds: Set<number>;
  obsoleteExternalIds: Set<number>;
  obsoleteAmount: number;
  conflicts: ArOrderParcelProtectedConflict[];
  auditGroups: ArOrderParcelAuditGroup[];
};

export type ExcludeObsoleteOrderParcelResult = {
  rows: FinanceArDashboardRow[];
  obsoleteCount: number;
  obsoleteAmount: number;
  conflicts: ArOrderParcelProtectedConflict[];
  auditGroups: ArOrderParcelAuditGroup[];
};

export type FinanceArConsolidationResult = {
  rows: FinanceArDashboardRow[];
  supersededPreInvoiceCount: number;
  supersededPreInvoiceAmount: number;
  obsoleteOrderParcelCount: number;
  obsoleteOrderParcelAmount: number;
  conflicts: ArOrderParcelProtectedConflict[];
  auditGroups: ArOrderParcelAuditGroup[];
};

export function parseOrderParcelFromArDescription(
  description: string | null | undefined
): ParsedOrderParcelReceivableRef | null {
  if (!description?.trim()) return null;
  const match = description.trim().match(AR_ORDER_PARCEL_FULL_DESCRIPTION_RE);
  if (!match) return null;
  const orderNumber = Number.parseInt(match[1]!, 10);
  const installmentNumber = Number.parseInt(match[2]!, 10);
  const totalInstallments =
    match[3] != null ? Number.parseInt(match[3], 10) : null;
  if (!Number.isFinite(orderNumber) || !Number.isFinite(installmentNumber)) return null;
  if (totalInstallments != null && !Number.isFinite(totalInstallments)) return null;
  return {
    orderCode: `PD ${String(orderNumber).padStart(5, "0")}`,
    installmentNumber,
    totalInstallments,
  };
}

export function isOrderParcelWithoutInvoiceCandidate(
  row: Pick<
    FinanceArDashboardRow,
    "description" | "sourceInvoiceId" | "sourceInvoiceNumber"
  >
): boolean {
  if (hasFinanceArSourceInvoice(row)) return false;
  return parseOrderParcelFromArDescription(row.description) != null;
}

export function buildOrderParcelReceivableBusinessKey(
  row: Pick<FinanceArDashboardRow, "companyId" | "companyName" | "personId" | "personName">,
  parsed: ParsedOrderParcelReceivableRef
): string {
  const companyKey =
    row.companyId != null && row.companyId > 0
      ? `c:${row.companyId}`
      : `cn:${(row.companyName ?? "").trim().toLowerCase()}`;
  const personKey =
    row.personId != null && row.personId > 0
      ? `p:${row.personId}`
      : `pn:${(row.personName ?? "").trim().toLowerCase()}`;
  const installments = parsed.totalInstallments ?? 0;
  return `${companyKey}|${personKey}|${parsed.orderCode}|i${parsed.installmentNumber}|t${installments}`;
}

export function isArTitleProtectedFromObsolescence(
  row: Pick<
    FinanceArDashboardRow,
    "amountReceived" | "settlementDate" | "sourceInvoiceId" | "sourceInvoiceNumber"
  >
): boolean {
  if (row.amountReceived > 0) return true;
  if (row.settlementDate != null) return true;
  if (hasFinanceArSourceInvoice(row)) return true;
  return false;
}

export function listArTitleObsolescenceProtectionReasons(
  row: Pick<
    FinanceArDashboardRow,
    "amountReceived" | "settlementDate" | "sourceInvoiceId" | "sourceInvoiceNumber"
  >
): string[] {
  const reasons: string[] = [];
  if (row.amountReceived > 0) reasons.push("amountReceived > 0");
  if (row.settlementDate != null) reasons.push("settlementDate");
  if (row.sourceInvoiceId != null && row.sourceInvoiceId > 0) reasons.push("sourceInvoiceId");
  if (row.sourceInvoiceNumber?.trim()) reasons.push("sourceInvoiceNumber");
  return reasons;
}

function toIso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

/** Maior modifiedAtNomus → createdAtNomus → syncedAt → externalId vence. */
export function compareArTitleRecency(a: FinanceArDashboardRow, b: FinanceArDashboardRow): number {
  const modA = a.modifiedAtNomus?.getTime() ?? 0;
  const modB = b.modifiedAtNomus?.getTime() ?? 0;
  if (modA !== modB) return modB - modA;

  const creA = a.createdAtNomus?.getTime() ?? 0;
  const creB = b.createdAtNomus?.getTime() ?? 0;
  if (creA !== creB) return creB - creA;

  const syncA = a.syncedAt.getTime();
  const syncB = b.syncedAt.getTime();
  if (syncA !== syncB) return syncB - syncA;

  return b.externalId - a.externalId;
}

function resolveRowFinancialAmount(row: FinanceArDashboardRow): number {
  return isFinanceArOpen(row) ? row.balanceReceivable : row.amountReceivable;
}

export function resolveOrderParcelReceivableGroups(
  rows: FinanceArDashboardRow[]
): OrderParcelReceivableResolution {
  const groups = new Map<string, FinanceArDashboardRow[]>();

  for (const row of rows) {
    if (!isOrderParcelWithoutInvoiceCandidate(row)) continue;
    const parsed = parseOrderParcelFromArDescription(row.description);
    if (!parsed) continue;
    const key = buildOrderParcelReceivableBusinessKey(row, parsed);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const keptExternalIds = new Set<number>();
  const obsoleteExternalIds = new Set<number>();
  let obsoleteAmount = 0;
  const conflicts: ArOrderParcelProtectedConflict[] = [];
  const auditGroups: ArOrderParcelAuditGroup[] = [];

  for (const row of rows) {
    if (!isOrderParcelWithoutInvoiceCandidate(row)) {
      keptExternalIds.add(row.externalId);
    }
  }

  for (const [businessKey, group] of groups) {
    if (group.length === 1) {
      keptExternalIds.add(group[0]!.externalId);
      continue;
    }

    const sorted = [...group].sort(compareArTitleRecency);
    const current = sorted[0]!;
    const parsed = parseOrderParcelFromArDescription(current.description)!;
    keptExternalIds.add(current.externalId);

    const obsoleteIds: number[] = [];
    const protectedIds: number[] = [];
    let groupObsoleteAmount = 0;
    let groupProtectedAmount = 0;

    for (const row of sorted.slice(1)) {
      if (isArTitleProtectedFromObsolescence(row)) {
        keptExternalIds.add(row.externalId);
        protectedIds.push(row.externalId);
        groupProtectedAmount += resolveRowFinancialAmount(row);
        conflicts.push({
          businessKey,
          orderCode: parsed.orderCode,
          installmentNumber: parsed.installmentNumber,
          totalInstallments: parsed.totalInstallments,
          currentExternalId: current.externalId,
          protectedExternalId: row.externalId,
          protectionReasons: listArTitleObsolescenceProtectionReasons(row),
          amountReceivable: row.amountReceivable,
          balanceReceivable: row.balanceReceivable,
        });
      } else {
        obsoleteExternalIds.add(row.externalId);
        obsoleteIds.push(row.externalId);
        const amount = resolveRowFinancialAmount(row);
        groupObsoleteAmount += amount;
        obsoleteAmount += amount;
      }
    }

    auditGroups.push({
      businessKey,
      orderCode: parsed.orderCode,
      personName: current.personName,
      personId: current.personId,
      companyName: current.companyName,
      companyId: current.companyId ?? null,
      installmentNumber: parsed.installmentNumber,
      totalInstallments: parsed.totalInstallments,
      externalIds: group.map((r) => r.externalId),
      amounts: group.map((r) => r.amountReceivable),
      balances: group.map((r) => r.balanceReceivable),
      dueDates: group.map((r) => toIso(r.dueDate)),
      modifiedAtNomus: group.map((r) => toIso(r.modifiedAtNomus)),
      createdAtNomus: group.map((r) => toIso(r.createdAtNomus)),
      syncedAt: group.map((r) => r.syncedAt.toISOString()),
      currentExternalId: current.externalId,
      obsoleteExternalIds: obsoleteIds,
      protectedExternalIds: protectedIds,
      grossAmount: roundMoney(group.reduce((sum, r) => sum + resolveRowFinancialAmount(r), 0)),
      currentAmount: roundMoney(resolveRowFinancialAmount(current)),
      obsoleteAmount: roundMoney(groupObsoleteAmount),
      protectedAmount: roundMoney(groupProtectedAmount),
      requiresManualReview: protectedIds.length > 0,
    });
  }

  return {
    keptExternalIds,
    obsoleteExternalIds,
    obsoleteAmount: roundMoney(obsoleteAmount),
    conflicts,
    auditGroups,
  };
}

/** Exclui títulos obsoletos de pedido/parcela das leituras gerenciais (dry-run friendly). */
export function excludeObsoleteOrderParcelArRows(
  rows: FinanceArDashboardRow[]
): ExcludeObsoleteOrderParcelResult {
  const resolution = resolveOrderParcelReceivableGroups(rows);
  return {
    rows: rows.filter((row) => !resolution.obsoleteExternalIds.has(row.externalId)),
    obsoleteCount: resolution.obsoleteExternalIds.size,
    obsoleteAmount: resolution.obsoleteAmount,
    conflicts: resolution.conflicts,
    auditGroups: resolution.auditGroups,
  };
}

/**
 * Consolidação oficial AR gerencial: dedup pré-NF + exclusão de obsoletos de pedido.
 * Usar em Contas a Receber, Fluxo de Caixa, Relatório Presidencial e exportações.
 */
export function consolidateFinanceArReceivableRows(
  rows: FinanceArDashboardRow[]
): FinanceArConsolidationResult {
  const deduped = deduplicateFinanceArRows(rows);
  const current = excludeObsoleteOrderParcelArRows(deduped.rows);
  return {
    rows: current.rows,
    supersededPreInvoiceCount: deduped.supersededPreInvoiceCount,
    supersededPreInvoiceAmount: deduped.supersededPreInvoiceAmount,
    obsoleteOrderParcelCount: current.obsoleteCount,
    obsoleteOrderParcelAmount: current.obsoleteAmount,
    conflicts: current.conflicts,
    auditGroups: current.auditGroups,
  };
}

/** Auditoria dry-run — não altera dados. */
export function auditNomusAccountsReceivableCurrentState(rows: FinanceArDashboardRow[]): {
  duplicateGroupCount: number;
  obsoleteTitleCount: number;
  obsoleteAmount: number;
  protectedConflictCount: number;
  grossAmount: number;
  currentAmount: number;
  impactDelta: number;
  groups: ArOrderParcelAuditGroup[];
  conflicts: ArOrderParcelProtectedConflict[];
} {
  const resolution = resolveOrderParcelReceivableGroups(rows);
  const grossAmount = roundMoney(
    rows.reduce((sum, row) => sum + resolveRowFinancialAmount(row), 0)
  );
  const currentAmount = roundMoney(
    rows
      .filter((row) => !resolution.obsoleteExternalIds.has(row.externalId))
      .reduce((sum, row) => sum + resolveRowFinancialAmount(row), 0)
  );

  return {
    duplicateGroupCount: resolution.auditGroups.length,
    obsoleteTitleCount: resolution.obsoleteExternalIds.size,
    obsoleteAmount: resolution.obsoleteAmount,
    protectedConflictCount: resolution.conflicts.length,
    grossAmount,
    currentAmount,
    impactDelta: roundMoney(grossAmount - currentAmount),
    groups: resolution.auditGroups,
    conflicts: resolution.conflicts,
  };
}
