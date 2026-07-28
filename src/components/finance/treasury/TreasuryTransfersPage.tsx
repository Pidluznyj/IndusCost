/**
 * Tela — Transferências internas da Central de Tesouraria.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryFinancialAccountDto,
  TreasuryTransferDto,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import {
  cancelTreasuryTransfer,
  createTreasuryTransfer,
  fetchTreasuryTransfers,
  receiveTreasuryTransfer,
  reconcileTreasuryTransfer,
  scheduleTreasuryTransfer,
  sendTreasuryTransfer,
} from "@/src/lib/treasury/treasuryTransfersApi.js";
import {
  canManageTreasuryTransfers,
  canViewTreasuryTransfers,
} from "@/src/lib/treasury/treasuryTransfersPermissions.js";
import {
  TREASURY_TRANSFERS_DENIED_MESSAGE,
  TREASURY_TRANSFERS_PAGE_SUBTITLE,
  TREASURY_TRANSFERS_PAGE_TITLE,
  createEmptyTreasuryTransferForm,
  createEmptyTreasuryTransfersFilters,
  isTreasuryTransferStatus,
  resolveTreasuryTransfersViewKind,
  validateTreasuryTransferForm,
  type TreasuryTransferFormState,
  type TreasuryTransfersFilterState,
} from "@/src/lib/treasury/treasuryTransfersUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { TreasuryTransferFormDialog } from "./TreasuryTransferFormDialog.js";
import { TreasuryTransfersPanel } from "./TreasuryTransfersPanel.js";

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readFilters(params: URLSearchParams): TreasuryTransfersFilterState {
  const base = createEmptyTreasuryTransfersFilters();
  const statusRaw = params.get("status") ?? "";
  return {
    status: isTreasuryTransferStatus(statusRaw) ? statusRaw : base.status,
    companyCode: params.get("companyCode") ?? "",
    fromAccountId: params.get("fromAccountId") ?? "",
    toAccountId: params.get("toAccountId") ?? "",
  };
}

function filtersToParams(filters: TreasuryTransfersFilterState): URLSearchParams {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.companyCode.trim()) qs.set("companyCode", filters.companyCode.trim());
  if (filters.fromAccountId.trim())
    qs.set("fromAccountId", filters.fromAccountId.trim());
  if (filters.toAccountId.trim()) qs.set("toAccountId", filters.toAccountId.trim());
  return qs;
}

export function TreasuryTransfersPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryTransfers(permCheck);
  const canManage = canManageTreasuryTransfers(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const [items, setItems] = useState<TreasuryTransferDto[]>([]);
  const [accounts, setAccounts] = useState<TreasuryFinancialAccountDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<TreasuryTransferFormState>(() =>
    createEmptyTreasuryTransferForm(todayLocal())
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!canView) return;
    const ticket = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const [list, acc] = await Promise.all([
        fetchTreasuryTransfers({
          page: 1,
          pageSize: 100,
          status: filters.status || null,
          companyCode: filters.companyCode || null,
          fromAccountId: filters.fromAccountId || null,
          toAccountId: filters.toAccountId || null,
        }),
        fetchTreasuryAccounts({ page: 1, pageSize: 200, isActive: true }),
      ]);
      if (ticket !== seq.current) return;
      setItems(list.items);
      setAccounts(acc.rows ?? []);
    } catch (err) {
      if (ticket !== seq.current) return;
      setError(
        buildFinanceTabLoadError(err, "Não foi possível carregar transferências.")
      );
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewKind = resolveTreasuryTransfersViewKind({
    canView,
    loading,
    error,
    itemCount: items.length,
  });

  async function runTransition(
    row: TreasuryTransferDto,
    action: "schedule" | "send" | "receive" | "reconcile" | "cancel"
  ) {
    try {
      if (action === "cancel") {
        const justification = window.prompt(
          "Justificativa do cancelamento (obrigatória):"
        );
        if (!justification?.trim()) return;
        await cancelTreasuryTransfer(row.id, {
          expectedVersion: row.version,
          justification: justification.trim(),
        });
      } else if (action === "schedule") {
        await scheduleTreasuryTransfer(row.id, {
          expectedVersion: row.version,
          civilDate: row.civilDate,
        });
      } else if (action === "send") {
        await sendTreasuryTransfer(row.id, {
          expectedVersion: row.version,
          civilDate: todayLocal(),
        });
      } else if (action === "receive") {
        await receiveTreasuryTransfer(row.id, {
          expectedVersion: row.version,
          civilDate: todayLocal(),
        });
      } else {
        await reconcileTreasuryTransfer(row.id, {
          expectedVersion: row.version,
          civilDate: todayLocal(),
        });
      }
      await load();
    } catch (err) {
      setError(
        buildFinanceTabLoadError(err, "Falha ao atualizar transferência.")
      );
    }
  }

  async function handleCreate() {
    const validation = validateTreasuryTransferForm(form);
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createTreasuryTransfer({
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        civilDate: form.civilDate,
        amount: form.amount.trim(),
        memo: form.memo.trim() || null,
        status: form.status,
      });
      setDialogOpen(false);
      setForm(createEmptyTreasuryTransferForm(todayLocal()));
      await load();
    } catch (err) {
      setFormError(
        buildFinanceTabLoadError(err, "Não foi possível criar a transferência.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-transfers-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_TRANSFERS_PAGE_TITLE}
          subtitle={TREASURY_TRANSFERS_PAGE_SUBTITLE}
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
            message={TREASURY_TRANSFERS_DENIED_MESSAGE}
            testId="treasury-transfers-permission-denied"
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
        {viewKind === "empty" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Nenhuma transferência no filtro atual.
            </p>
            {canManage ? (
              <TreasuryTransfersPanel
                items={[]}
                accounts={accounts}
                filters={filters}
                canManage={canManage}
                onFiltersChange={(next) => setSearchParams(filtersToParams(next))}
                onCreate={() => {
                  setForm(createEmptyTreasuryTransferForm(todayLocal()));
                  setFormError(null);
                  setDialogOpen(true);
                }}
                onSchedule={() => undefined}
                onSend={() => undefined}
                onReceive={() => undefined}
                onReconcile={() => undefined}
                onCancel={() => undefined}
              />
            ) : null}
          </div>
        ) : null}
        {viewKind === "ready" ? (
          <TreasuryTransfersPanel
            items={items}
            accounts={accounts}
            filters={filters}
            canManage={canManage}
            onFiltersChange={(next) => setSearchParams(filtersToParams(next))}
            onCreate={() => {
              setForm(createEmptyTreasuryTransferForm(todayLocal()));
              setFormError(null);
              setDialogOpen(true);
            }}
            onSchedule={(row) => void runTransition(row, "schedule")}
            onSend={(row) => void runTransition(row, "send")}
            onReceive={(row) => void runTransition(row, "receive")}
            onReconcile={(row) => void runTransition(row, "reconcile")}
            onCancel={(row) => void runTransition(row, "cancel")}
          />
        ) : null}

        <TreasuryTransferFormDialog
          open={dialogOpen}
          accounts={accounts}
          form={form}
          error={formError}
          saving={saving}
          onChange={setForm}
          onClose={() => setDialogOpen(false)}
          onSubmit={() => void handleCreate()}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
