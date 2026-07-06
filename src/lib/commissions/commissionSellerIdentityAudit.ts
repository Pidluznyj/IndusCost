/**
 * Auditoria de identidade de vendedores — lógica pura.
 */
import { roundMoney } from "./commission-money.js";
import { normalizeCommissionPersonName } from "./commissionPersonIdentity.js";
import {
  classifySellerGroupStatus,
  resolveCommissionSellerIdentity,
  sellerNameMatchesFilter,
  type CommissionSellerIdentityContext,
  type SellerIdentityGroupSummary,
} from "./commissionSellerIdentity.js";
import type { VisualAuditRow } from "./commissionVisualAudit.js";

export type SellerSourceObservation = {
  sourceTable: string;
  sourceId: string;
  rawSellerId: number | null;
  rawSellerName: string | null;
  normalizedSellerName: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  issueDate: string | null;
  settlementDate: string | null;
  customer: string | null;
  order: string | null;
  nfe: string | null;
  receivable: number | null;
  base: number;
  expectedCommission: number;
  releasedCommission: number;
  status: string;
  warning: string | null;
};

export type SellerIdentityAuditSummary = {
  year: number;
  month: number;
  sellerFilter: string | null;
  groups: SellerIdentityGroupSummary[];
  sellerFocusAudit: SellerFocusAudit | null;
};

export type SellerFocusAudit = {
  displayName: string;
  status: string;
  rawIds: number[];
  rawNames: string[];
  internalPersonIds: string[];
  canonicalPersonId: string | null;
  canonicalPersonName: string | null;
  commission: {
    generatedExpected: number;
    generatedReleased: number;
    forecastExpected: number;
    payableExpected: number;
    payableReleased: number;
  };
  pending: {
    withoutSeller: number;
    outsideCanonical: number;
    duplicatedRecords: number;
  };
  warnings: string[];
};

/** @deprecated Use SellerFocusAudit */
export type GisleneSellerAudit = SellerFocusAudit;

export function buildSellerFocusAudit(input: {
  sellerFilter: string;
  groups: SellerIdentityGroupSummary[];
  payableRows: VisualAuditRow[];
  generatedRows: VisualAuditRow[];
  forecastRows: VisualAuditRow[];
  identityCtx: CommissionSellerIdentityContext;
}): SellerFocusAudit | null {
  const matchedGroups = input.groups.filter((g) =>
    sellerNameMatchesFilter(g.normalizedSellerName, input.sellerFilter)
  );
  if (matchedGroups.length === 0) return null;

  const rawIds = [...new Set(matchedGroups.flatMap((g) => g.rawSellerIds))].sort((a, b) => a - b);
  const rawNames = [...new Set(matchedGroups.flatMap((g) => g.rawSellerNames))];
  const internalPersonIds = [
    ...new Set(
      matchedGroups.map((g) => g.canonicalSellerId).filter(Boolean) as string[]
    ),
  ];

  const canonicalGroup =
    matchedGroups.find((g) => g.status === "OK_CANONICAL") ??
    matchedGroups.find((g) => g.canonicalSellerId) ??
    matchedGroups[0]!;

  const canonicalPersonId = canonicalGroup.canonicalSellerId;
  const canonicalPersonName = canonicalGroup.canonicalSellerName;

  const filterRows = (rows: VisualAuditRow[]) =>
    rows.filter((row) =>
      sellerNameMatchesFilter(
        normalizeCommissionPersonName(row.canonicalSellerName ?? row.commissionPersonName),
        input.sellerFilter
      )
    );

  const sumField = (rows: VisualAuditRow[], field: "commissionExpected" | "commissionReleased") =>
    roundMoney(rows.reduce((sum, row) => sum + row[field], 0));

  const payable = filterRows(input.payableRows);
  const generated = filterRows(input.generatedRows);
  const forecast = filterRows(input.forecastRows);

  const outsideCanonical = payable.filter(
    (row) => canonicalPersonId && row.canonicalSellerId !== canonicalPersonId
  ).length;

  const withoutSeller = payable.filter((row) => !row.canonicalSellerId && !row.commissionPersonId).length;

  const status =
    internalPersonIds.length > 1 ? "MULTIPLE_CANONICALS" : canonicalGroup.status;

  const warnings: string[] = [];
  if (internalPersonIds.length > 1) {
    warnings.push(`Múltiplos cadastros internos: ${internalPersonIds.join(", ")}`);
  }
  if (rawIds.length > 1) {
    warnings.push(`Múltiplos raw seller IDs: ${rawIds.join(", ")}`);
  }
  if (rawNames.some((n) => !n)) {
    warnings.push("Existem registros sem nome de vendedor");
  }

  return {
    displayName: canonicalPersonName ?? input.sellerFilter,
    status,
    rawIds,
    rawNames,
    internalPersonIds,
    canonicalPersonId,
    canonicalPersonName,
    commission: {
      generatedExpected: sumField(generated, "commissionExpected"),
      generatedReleased: sumField(generated, "commissionReleased"),
      forecastExpected: sumField(forecast, "commissionExpected"),
      payableExpected: sumField(payable, "commissionExpected"),
      payableReleased: sumField(payable, "commissionReleased"),
    },
    pending: {
      withoutSeller,
      outsideCanonical,
      duplicatedRecords: internalPersonIds.length > 1 ? payable.length : 0,
    },
    warnings,
  };
}

/** Mantido por compatibilidade — use buildSellerFocusAudit com filtro explícito. */
export function buildGisleneAudit(input: {
  groups: SellerIdentityGroupSummary[];
  payableRows: VisualAuditRow[];
  generatedRows: VisualAuditRow[];
  forecastRows: VisualAuditRow[];
  identityCtx: CommissionSellerIdentityContext;
}): SellerFocusAudit | null {
  return buildSellerFocusAudit({ ...input, sellerFilter: "GISLENE" });
}

function addObservation(
  bucket: Map<string, SellerSourceObservation[]>,
  key: string,
  row: SellerSourceObservation
): void {
  const list = bucket.get(key) ?? [];
  list.push(row);
  bucket.set(key, list);
}

export function buildSellerIdentityGroups(input: {
  observations: SellerSourceObservation[];
  identityCtx: CommissionSellerIdentityContext;
}): SellerIdentityGroupSummary[] {
  const byName = new Map<string, SellerSourceObservation[]>();

  for (const obs of input.observations) {
    const key = obs.normalizedSellerName || "SEM_NOME";
    const list = byName.get(key) ?? [];
    list.push(obs);
    byName.set(key, list);
  }

  const groups: SellerIdentityGroupSummary[] = [];

  for (const [normalizedSellerName, rows] of byName.entries()) {
    const rawSellerNames = [...new Set(rows.map((r) => r.rawSellerName).filter(Boolean))] as string[];
    const rawSellerIds = [
      ...new Set(
        rows.map((r) => r.rawSellerId).filter((id): id is number => id != null && id > 0)
      ),
    ].sort((a, b) => a - b);

    const personIdsSeen = [
      ...new Set(rows.map((r) => r.canonicalSellerId).filter(Boolean)),
    ] as string[];

    const sample = rows[0]!;
    const resolution = resolveCommissionSellerIdentity(
      {
        rawSellerId: rawSellerIds[0] ?? null,
        rawSellerName: rawSellerNames[0] ?? sample.rawSellerName,
        source: sample.sourceTable,
      },
      input.identityCtx
    );

    const canonicalSellerId =
      resolution.canonicalSellerId ?? personIdsSeen[0] ?? null;
    const canonicalSellerName =
      resolution.canonicalSellerName ??
      rows.find((r) => r.canonicalSellerName)?.canonicalSellerName ??
      rawSellerNames[0] ??
      null;

    const hasMissingId = rows.some((r) => r.rawSellerId == null);
    const hasConflict = resolution.resolutionStatus === "CONFLICT";

    const status = classifySellerGroupStatus({
      rawSellerIds,
      canonicalSellerId,
      personIdsSeen,
      hasMissingId,
      hasConflict,
    });

    const orderIds = new Set(rows.filter((r) => r.order).map((r) => r.order!));
    const nfeIds = new Set(rows.filter((r) => r.nfe).map((r) => r.nfe!));
    const receivableIds = new Set(
      rows.filter((r) => r.receivable != null).map((r) => String(r.receivable))
    );

    groups.push({
      normalizedSellerName,
      rawSellerNames,
      rawSellerIds,
      canonicalSellerId,
      canonicalSellerName,
      status,
      orderCount: orderIds.size,
      nfeCount: nfeIds.size,
      receivableCount: receivableIds.size,
      recordCount: rows.length,
      baseAmount: roundMoney(rows.reduce((sum, r) => sum + r.base, 0)),
      expectedCommission: roundMoney(rows.reduce((sum, r) => sum + r.expectedCommission, 0)),
      releasedCommission: roundMoney(rows.reduce((sum, r) => sum + r.releasedCommission, 0)),
      warnings: resolution.warnings,
    });
  }

  return groups.sort((a, b) => b.releasedCommission - a.releasedCommission);
}

export function sellerIdentityDetailCsvHeader(): string[] {
  return [
    "sourceTable",
    "sourceId",
    "rawSellerId",
    "rawSellerName",
    "normalizedSellerName",
    "canonicalSellerId",
    "canonicalSellerName",
    "issueDate",
    "settlementDate",
    "customer",
    "order",
    "nfe",
    "receivable",
    "base",
    "expectedCommission",
    "releasedCommission",
    "status",
    "warning",
  ];
}

export function sellerObservationToCsvRow(row: SellerSourceObservation): unknown[] {
  return [
    row.sourceTable,
    row.sourceId,
    row.rawSellerId,
    row.rawSellerName,
    row.normalizedSellerName,
    row.canonicalSellerId,
    row.canonicalSellerName,
    row.issueDate,
    row.settlementDate,
    row.customer,
    row.order,
    row.nfe,
    row.receivable,
    row.base,
    row.expectedCommission,
    row.releasedCommission,
    row.status,
    row.warning,
  ];
}

export { addObservation };
