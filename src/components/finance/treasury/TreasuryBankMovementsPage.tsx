/**
 * Tela — Movimentos bancários / importação OFX.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryBankImportBatchDto,
  TreasuryBankMovementDto,
  TreasuryFinancialAccountDto,
  TreasuryReconciliationMatchDto,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import {
  fetchTreasuryBankImportBatches,
  fetchTreasuryBankMovements,
  type TreasuryOfxApplyResponse,
} from "@/src/lib/treasury/treasuryBankImportOfxApi.js";
import {
  fetchTreasuryActiveReconciliationsByMovement,
  reverseTreasuryReconciliation,
} from "@/src/lib/treasury/treasuryReconciliationApi.js";
import {
  canManageTreasuryReconciliation,
  canReverseTreasuryReconciliation,
  canViewTreasuryReconciliation,
} from "@/src/lib/treasury/treasuryReconciliationPermissions.js";
import {
  TREASURY_BANK_MOVEMENTS_DENIED_MESSAGE,
  TREASURY_BANK_MOVEMENTS_PAGE_SUBTITLE,
  TREASURY_BANK_MOVEMENTS_PAGE_TITLE,
  createEmptyTreasuryBankMovementsFilters,
  isTreasuryBankMovementFilterBucket,
  resolveTreasuryBankMovementsViewKind,
  type TreasuryBankMovementsFilterState,
} from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryBankMovementsPanel } from "./TreasuryBankMovementsPanel.js";
import { TreasuryOfxImportDialog } from "./TreasuryOfxImportDialog.js";
import { TreasuryReconciliationReverseConfirmDialog } from "./TreasuryReconciliationReverseConfirmDialog.js";

function readFilters(params: URLSearchParams): TreasuryBankMovementsFilterState {
  const base = createEmptyTreasuryBankMovementsFilters();
  const bucketRaw = params.get("bucket") ?? "";
  return {
    bucket: isTreasuryBankMovementFilterBucket(bucketRaw)
      ? bucketRaw
      : base.bucket,
    accountId: params.get("accountId") ?? "",
    companyCode: params.get("companyCode") ?? "",
    batchId: params.get("batchId") ?? "",
    search: params.get("search") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
}

function filtersToParams(
  filters: TreasuryBankMovementsFilterState
): URLSearchParams {
  const qs = new URLSearchParams();
  if (filters.bucket) qs.set("bucket", filters.bucket);
  if (filters.accountId.trim()) qs.set("accountId", filters.accountId.trim());
  if (filters.companyCode.trim())
    qs.set("companyCode", filters.companyCode.trim());
  if (filters.batchId.trim()) qs.set("batchId", filters.batchId.trim());
  if (filters.search.trim()) qs.set("search", filters.search.trim());
  if (filters.from.trim()) qs.set("from", filters.from.trim());
  if (filters.to.trim()) qs.set("to", filters.to.trim());
  return qs;
}

export function TreasuryBankMovementsPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryReconciliation(permCheck);
  const canManage = canManageTreasuryReconciliation(permCheck);
  const canReverse = canReverseTreasuryReconciliation(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const [accounts, setAccounts] = useState<TreasuryFinancialAccountDto[]>([]);
  const [batches, setBatches] = useState<TreasuryBankImportBatchDto[]>([]);
  const [movements, setMovements] = useState<TreasuryBankMovementDto[]>([]);
  const [selected, setSelected] = useState<TreasuryBankMovementDto | null>(
    null
  );
  const [activeMatches, setActiveMatches] = useState<
    TreasuryReconciliationMatchDto[]
  >([]);
  const [reverseTarget, setReverseTarget] =
    useState<TreasuryReconciliationMatchDto | null>(null);
  const [reverseBusy, setReverseBusy] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [duplicatesMessage, setDuplicatesMessage] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!canView) return;
    const ticket = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const [acc, batchList, movementList] = await Promise.all([
        fetchTreasuryAccounts({ page: 1, pageSize: 200, isActive: true }),
        fetchTreasuryBankImportBatches({
          page: 1,
          pageSize: 50,
          companyCode: filters.companyCode || null,
          accountId: filters.accountId || null,
        }),
        fetchTreasuryBankMovements({
          page: 1,
          pageSize: 100,
          companyCode: filters.companyCode || null,
          accountId: filters.accountId || null,
          batchId: filters.batchId || null,
          bucket: filters.bucket || null,
          search: filters.search || null,
          from: filters.from || null,
          to: filters.to || null,
        }),
      ]);
      if (ticket !== seq.current) return;
      setAccounts(acc.rows ?? []);
      setBatches(batchList.items);
      setMovements(movementList.items);
      setDuplicatesMessage(
        movementList.duplicatesNotPersisted
          ? movementList.message
          : null
      );
    } catch (err) {
      if (ticket !== seq.current) return;
      setError(
        buildFinanceTabLoadError(
          err,
          "Não foi possível carregar movimentos bancários."
        )
      );
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setActiveMatches([]);
      return;
    }
    let cancelled = false;
    void fetchTreasuryActiveReconciliationsByMovement(selected.id)
      .then((items) => {
        if (!cancelled) setActiveMatches(items);
      })
      .catch(() => {
        if (!cancelled) setActiveMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const viewKind = resolveTreasuryBankMovementsViewKind({
    canView,
    loading,
    error,
    itemCount: movements.length,
    duplicatesNotPersisted: Boolean(duplicatesMessage),
  });

  function updateFilters(next: TreasuryBankMovementsFilterState) {
    setSearchParams(filtersToParams(next), { replace: true });
  }

  function handleApplied(result: TreasuryOfxApplyResponse) {
    setFlash(
      result.idempotent
        ? `Lote já existia (idempotente). Ignorados: ${result.ignored.count}.`
        : `Importação OK — criados ${result.created.count}, ignorados ${result.ignored.count}, inválidos ${result.invalid.count}.`
    );
    void load();
  }

  async function handleReverseConfirm(input: {
    reason: string;
    confirmPhrase: string;
  }) {
    if (!reverseTarget) return;
    setReverseBusy(true);
    setReverseError(null);
    try {
      const result = await reverseTreasuryReconciliation({
        matchId: reverseTarget.id,
        expectedVersion: reverseTarget.version,
        reason: input.reason,
        confirmPhrase: input.confirmPhrase,
      });
      const closed =
        result.postClosing &&
        typeof result.postClosing === "object" &&
        (result.postClosing as { raised?: boolean }).raised
          ? " Exceção pós-fechamento registrada."
          : "";
      setFlash(`Conciliação revertida.${closed}`);
      setReverseTarget(null);
      setSelected(null);
      await load();
    } catch (err) {
      setReverseError(
        err instanceof Error ? err.message : "Falha ao reverter conciliação."
      );
    } finally {
      setReverseBusy(false);
    }
  }

  return (
    <FinanceBiDashboardShell>
      <div className="contents" data-testid="treasury-bank-movements-page">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_BANK_MOVEMENTS_PAGE_TITLE}
          subtitle={TREASURY_BANK_MOVEMENTS_PAGE_SUBTITLE}
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
            },
          ]}
        />

        {viewKind === "denied" ? (
          <PermissionDenied
            title="Sem permissão"
            message={TREASURY_BANK_MOVEMENTS_DENIED_MESSAGE}
            testId="treasury-bank-movements-permission-denied"
          />
        ) : null}
        {viewKind === "loading" ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : null}
        {viewKind === "error" ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {flash ? (
          <p
            className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
            data-testid="treasury-bank-movements-flash"
          >
            {flash}
          </p>
        ) : null}

        {canView && viewKind !== "denied" && viewKind !== "loading" ? (
          <TreasuryBankMovementsPanel
            filters={filters}
            accounts={accounts}
            batches={batches}
            movements={movements}
            selected={selected}
            activeMatches={activeMatches}
            canManage={canManage}
            canReverse={canReverse}
            duplicatesMessage={duplicatesMessage}
            onFiltersChange={updateFilters}
            onImport={() => setImportOpen(true)}
            onSelectMovement={setSelected}
            onClearSelection={() => setSelected(null)}
            onSelectBatch={(batchId) =>
              updateFilters({ ...filters, batchId })
            }
            onReverseMatch={(match) => {
              setReverseError(null);
              setReverseTarget(match);
            }}
          />
        ) : null}

        {canManage ? (
          <TreasuryOfxImportDialog
            open={importOpen}
            accounts={accounts}
            onClose={() => setImportOpen(false)}
            onApplied={handleApplied}
          />
        ) : null}

        <TreasuryReconciliationReverseConfirmDialog
          open={Boolean(reverseTarget)}
          match={reverseTarget}
          busy={reverseBusy}
          error={reverseError}
          onCancel={() => {
            if (reverseBusy) return;
            setReverseTarget(null);
            setReverseError(null);
          }}
          onConfirm={(input) => void handleReverseConfirm(input)}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
