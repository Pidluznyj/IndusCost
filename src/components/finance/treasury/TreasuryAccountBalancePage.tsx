import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryBalanceSnapshotDto,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccount } from "@/src/lib/treasury/treasuryAccountsApi.js";
import {
  cancelTreasuryBalanceSnapshot,
  createTreasuryBalanceSnapshot,
  fetchTreasuryAccountBalances,
  fetchTreasuryAccountLatestBalance,
  type TreasuryCreateBalanceSnapshotBody,
} from "@/src/lib/treasury/treasuryBalancesApi.js";
import {
  canManageTreasuryBalances,
  canViewTreasuryBalances,
} from "@/src/lib/treasury/treasuryBalancesPermissions.js";
import {
  TREASURY_BALANCE_DENIED_MESSAGE,
  TREASURY_BALANCE_PAGE_TITLE,
  buildTreasuryBalanceAccountLabel,
  createEmptyTreasuryBalanceForm,
  resolveTreasuryBalanceSaveError,
  resolveTreasuryBalanceStaleState,
  toTreasuryBalanceSnapshotApiBody,
  validateTreasuryBalanceForm,
  type TreasuryBalanceFormState,
} from "@/src/lib/treasury/treasuryBalancesUi.js";
import { TREASURY_UI_BASE_PATH } from "./treasuryFeatureUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import {
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { TreasuryBalanceCancelConfirmDialog } from "./TreasuryBalanceCancelConfirmDialog.js";
import { TreasuryBalanceConfirmDialog } from "./TreasuryBalanceConfirmDialog.js";
import { TreasuryBalanceHistory } from "./TreasuryBalanceHistory.js";
import { TreasuryBalanceUpdateForm } from "./TreasuryBalanceUpdateForm.js";
import {
  formatTreasuryBalanceCurrencyPtBr,
  formatTreasuryBalanceDateTimePtBr,
} from "@/src/lib/treasury/treasuryBalancesUi.js";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `bal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function TreasuryAccountBalancePage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryBalances(permCheck);
  const canManage = canManageTreasuryBalances(permCheck);
  const isSuperAdmin = auth.isSuperAdmin();

  const abortRef = useRef<AbortController | null>(null);
  const [account, setAccount] = useState<TreasuryFinancialAccountDto | null>(
    null
  );
  const [latest, setLatest] = useState<TreasuryBalanceSnapshotDto | null>(null);
  const [history, setHistory] = useState<TreasuryBalanceSnapshotDto[]>([]);
  const [baselineLatestId, setBaselineLatestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TreasuryBalanceFormState>(
    createEmptyTreasuryBalanceForm()
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);
  const [confirmPayload, setConfirmPayload] =
    useState<TreasuryCreateBalanceSnapshotBody | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] =
    useState<TreasuryBalanceSnapshotDto | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView || !accountId) {
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setFormError(null);
    setIsConflict(false);
    try {
      const [acc, latestSnap, list] = await Promise.all([
        fetchTreasuryAccount(accountId, controller.signal),
        fetchTreasuryAccountLatestBalance(accountId, controller.signal),
        fetchTreasuryAccountBalances(accountId, {
          page: 1,
          pageSize: 50,
          signal: controller.signal,
        }),
      ]);
      if (controller.signal.aborted) return;
      setAccount(acc);
      setLatest(latestSnap);
      setHistory(list.rows);
      setBaselineLatestId(latestSnap?.id ?? null);
      setForm(createEmptyTreasuryBalanceForm(latestSnap));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        buildFinanceTabLoadError("Não foi possível carregar o saldo.", e)
      );
      setAccount(null);
      setLatest(null);
      setHistory([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [accountId, canView]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const stale = useMemo(
    () => resolveTreasuryBalanceStaleState(latest),
    [latest]
  );

  const accountLabel = account
    ? buildTreasuryBalanceAccountLabel(account)
    : accountId;

  const requestConfirm = () => {
    setFormError(null);
    setIsConflict(false);
    const validation = validateTreasuryBalanceForm(form);
    if (validation) {
      setFormError(validation);
      return;
    }
    const payload = toTreasuryBalanceSnapshotApiBody(form);
    if (!payload) {
      setFormError("Revise os valores do formulário.");
      return;
    }
    setConfirmPayload(payload);
  };

  const confirmSave = async () => {
    if (!canManage || !accountId || !confirmPayload) return;
    setSaving(true);
    setFormError(null);
    setIsConflict(false);
    try {
      const currentLatest = await fetchTreasuryAccountLatestBalance(accountId);
      if ((currentLatest?.id ?? null) !== baselineLatestId) {
        setConfirmPayload(null);
        setIsConflict(true);
        setFormError(
          "Conflito: o saldo foi atualizado por outro processo. Recarregue antes de salvar."
        );
        setLatest(currentLatest);
        setBaselineLatestId(currentLatest?.id ?? null);
        return;
      }
      await createTreasuryBalanceSnapshot(
        accountId,
        confirmPayload,
        newIdempotencyKey()
      );
      setConfirmPayload(null);
      await load();
    } catch (e) {
      const resolved = resolveTreasuryBalanceSaveError(e);
      setConfirmPayload(null);
      setFormError(resolved.message);
      setIsConflict(resolved.isConflict);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (row: TreasuryBalanceSnapshotDto) => {
    setFormError(null);
    setIsConflict(false);
    setForm(createEmptyTreasuryBalanceForm(row));
  };

  const handleCancelRequest = (row: TreasuryBalanceSnapshotDto) => {
    setCancelError(null);
    setCancelTarget(row);
  };

  const handleCancelConfirm = async (reason: string) => {
    if (!accountId || !cancelTarget) return;
    setCancellingId(cancelTarget.id);
    setCancelError(null);
    try {
      await cancelTreasuryBalanceSnapshot(accountId, cancelTarget.id, reason);
      setCancelTarget(null);
      await load();
    } catch (e) {
      const resolved = resolveTreasuryBalanceSaveError(e);
      setCancelError(resolved.message);
    } finally {
      setCancellingId(null);
    }
  };

  if (!canView) {
    return (
      <PermissionDenied
        title="Sem permissão"
        message={TREASURY_BALANCE_DENIED_MESSAGE}
        testId="treasury-balance-permission-denied"
      />
    );
  }

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-balance-page" className="space-y-4">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_BALANCE_PAGE_TITLE}
          subtitle={
            <>
              {accountLabel}. Informe saldos manuais versionados — distinto do
              Fluxo de Caixa projetado.
            </>
          }
          updatedAt={latest?.referenceAt ?? null}
          updatedAtLabel="Saldo de referência em"
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
            },
          ]}
          extraActions={
            <Link
              to={`${TREASURY_UI_BASE_PATH}/accounts`}
              className="inline-flex items-center rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            >
              Voltar às contas
            </Link>
          }
        />

        {error ? (
          <FinanceModuleErrorBanner
            message={error}
            onRetry={() => void load()}
            onDismiss={() => setError(null)}
          />
        ) : null}

        {loading ? (
          <FinanceModuleLoadingBlock label="Carregando saldo da conta…" />
        ) : null}

        {!loading && account ? (
          <>
            {stale.kind !== "none" ? (
              <div
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                data-testid="treasury-balance-stale-alert"
                role="status"
              >
                {stale.message}
              </div>
            ) : null}

            {latest ? (
              <div
                className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3 text-sm sm:grid-cols-5"
                data-testid="treasury-balance-latest-summary"
              >
                <div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    Disponível
                  </p>
                  <p className="font-semibold tabular-nums">
                    {formatTreasuryBalanceCurrencyPtBr(
                      latest.operationalAvailableBalance
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    Bloqueado
                  </p>
                  <p className="tabular-nums">
                    {formatTreasuryBalanceCurrencyPtBr(latest.blockedBalance)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    Aplicação
                  </p>
                  <p className="tabular-nums">
                    {formatTreasuryBalanceCurrencyPtBr(
                      latest.investmentsBalance
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    Limite
                  </p>
                  <p className="tabular-nums">
                    {formatTreasuryBalanceCurrencyPtBr(latest.usedLimit)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    Observado
                  </p>
                  <p className="tabular-nums">
                    {formatTreasuryBalanceCurrencyPtBr(latest.observedBalance)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatTreasuryBalanceDateTimePtBr(latest.referenceAt)}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end md:hidden">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                onClick={() => void load()}
              >
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </button>
            </div>

            <TreasuryBalanceUpdateForm
              form={form}
              canManage={canManage && account.isActive}
              saving={saving}
              error={formError}
              isConflict={isConflict}
              onChange={setForm}
              onSubmitRequest={requestConfirm}
              onReload={() => void load()}
            />

            <TreasuryBalanceHistory
              rows={history}
              isSuperAdmin={isSuperAdmin}
              onEdit={handleEdit}
              onCancel={handleCancelRequest}
              cancellingId={cancellingId}
            />
          </>
        ) : null}

        {confirmPayload && account ? (
          <TreasuryBalanceConfirmDialog
            accountLabel={accountLabel}
            payload={confirmPayload}
            saving={saving}
            onCancel={() => setConfirmPayload(null)}
            onConfirm={() => void confirmSave()}
          />
        ) : null}

        <TreasuryBalanceCancelConfirmDialog
          row={cancelTarget}
          busy={!!cancellingId}
          error={cancelError}
          onCancel={() => setCancelTarget(null)}
          onConfirm={(reason) => void handleCancelConfirm(reason)}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
