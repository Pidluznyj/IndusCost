/**
 * Hook pós-sync Nomus para materialização de comissão (opcional via env).
 */
import type { CommissionMaterializationRunSummary } from "./commissionMaterializationOrchestrator.js";

export const COMMISSION_MATERIALIZATION_AFTER_SYNC_ENV = "COMMISSION_MATERIALIZATION_AFTER_SYNC";

export type NomusSyncMaterializationSource =
  | "sales-orders"
  | "nfes"
  | "accounts-receivable"
  | "customers";

export type NomusSyncMaterializationTrigger = {
  source: NomusSyncMaterializationSource;
  syncMode: "apply" | "dry" | "preview";
  salesOrderIds?: string[];
  nfeIds?: number[];
  receivableIds?: number[];
  customerIds?: string[];
};

export type CommissionMaterializationAfterSyncResult = {
  enabled: boolean;
  skipped: boolean;
  skipReason?: string;
  summary?: CommissionMaterializationRunSummary;
  error?: string;
};

function safeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniquePositiveInts(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))];
}

export function isCommissionMaterializationAfterSyncEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[COMMISSION_MATERIALIZATION_AFTER_SYNC_ENV]?.trim().toLowerCase() === "true";
}

export function buildNomusSyncMaterializationTrigger(input: {
  source: NomusSyncMaterializationSource;
  syncMode: "apply" | "dry" | "preview";
  salesOrderIds?: string[];
  nfeIds?: number[];
  receivableIds?: number[];
  customerIds?: string[];
}): NomusSyncMaterializationTrigger {
  return {
    source: input.source,
    syncMode: input.syncMode,
    salesOrderIds: input.salesOrderIds?.length
      ? uniqueStrings(input.salesOrderIds)
      : undefined,
    nfeIds: input.nfeIds?.length ? uniquePositiveInts(input.nfeIds) : undefined,
    receivableIds: input.receivableIds?.length
      ? uniquePositiveInts(input.receivableIds)
      : undefined,
    customerIds: input.customerIds?.length
      ? uniqueStrings(input.customerIds)
      : undefined,
  };
}

export function hasMaterializationTriggerTargets(
  trigger: NomusSyncMaterializationTrigger
): boolean {
  return Boolean(
    trigger.salesOrderIds?.length ||
      trigger.nfeIds?.length ||
      trigger.receivableIds?.length ||
      trigger.customerIds?.length
  );
}

export function extractSalesOrderIdsFromSalesOrdersSyncPayload(
  payload: Record<string, unknown>
): string[] {
  const applied = safeObject(payload.applied);
  const fromApplied = Array.isArray(applied?.affectedSalesOrderIds)
    ? applied.affectedSalesOrderIds
    : [];
  const summary = safeObject(payload.summary);
  const changedOrders = Array.isArray(summary?.changedOrders) ? summary.changedOrders : [];
  const fromChanged = changedOrders
    .map((row) => safeObject(row)?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return uniqueStrings([
    ...fromApplied.filter((id): id is string => typeof id === "string"),
    ...fromChanged,
  ]);
}

export function extractReceivableIdsFromAccountsReceivableSyncPayload(
  payload: Record<string, unknown>
): number[] {
  const applied = safeObject(payload.applied);
  if (!Array.isArray(applied?.affectedReceivableIds)) return [];
  return uniquePositiveInts(
    applied.affectedReceivableIds.filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id)
    )
  );
}

export function extractNfeIdsFromNfesSyncPayload(payload: Record<string, unknown>): number[] {
  const applied = safeObject(payload.applied);
  if (!Array.isArray(applied?.affectedNfeIds)) return [];
  return uniquePositiveInts(
    applied.affectedNfeIds.filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id)
    )
  );
}

export function extractCustomerIdsFromCustomersSyncPayload(
  payload: Record<string, unknown>
): string[] {
  const applied = safeObject(payload.applied);
  if (!Array.isArray(applied?.affectedCustomerIds)) return [];
  return uniqueStrings(
    applied.affectedCustomerIds.filter((id): id is string => typeof id === "string")
  );
}

export function formatCommissionMaterializationAfterSyncLog(
  result: CommissionMaterializationAfterSyncResult,
  trigger: NomusSyncMaterializationTrigger
): string {
  if (!result.enabled) {
    return `[commission-materialization-after-sync] desabilitado (${COMMISSION_MATERIALIZATION_AFTER_SYNC_ENV}!=true)`;
  }
  if (result.skipped) {
    return `[commission-materialization-after-sync] ignorado source=${trigger.source} reason=${result.skipReason ?? "unknown"}`;
  }
  if (result.error) {
    return `[commission-materialization-after-sync] ERRO source=${trigger.source} error=${result.error}`;
  }
  const summary = result.summary;
  if (!summary) {
    return `[commission-materialization-after-sync] concluído source=${trigger.source} sem resumo`;
  }
  return (
    `[commission-materialization-after-sync] source=${trigger.source} pedidos=${summary.ordersProcessed} ` +
    `snapshotsCriados=${summary.snapshotsCreated} snapshotsSemAlteracao=${summary.snapshotsUnchanged} ` +
    `schedulesCriados=${summary.schedulesCreated} schedulesAtualizados=${summary.schedulesUpdated} ` +
    `schedulesStale=${summary.schedulesStaled} erros=${summary.errors.length}`
  );
}
