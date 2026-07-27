import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryFinancialAccountAccessDto,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  createTreasuryAccount,
  deactivateTreasuryAccount,
  fetchTreasuryAccountAccess,
  fetchTreasuryAccounts,
  putTreasuryAccountAccess,
  reactivateTreasuryAccount,
  updateTreasuryAccount,
} from "@/src/lib/treasury/treasuryAccountsApi.js";
import {
  canManageTreasuryAccounts,
  canViewTreasuryAccounts,
} from "@/src/lib/treasury/treasuryAccountsPermissions.js";
import {
  TREASURY_ACCOUNTS_PAGE_SUBTITLE,
  TREASURY_ACCOUNTS_PAGE_TITLE,
  buildTreasuryAccountsListQuery,
  createEmptyTreasuryAccountForm,
  formFromTreasuryAccount,
  resolveTreasuryAccountsViewKind,
  toCreateAccountInput,
  validateTreasuryAccountForm,
  type TreasuryAccountFormState,
} from "@/src/lib/treasury/treasuryAccountsUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import {
  TreasuryAccountAccessDialog,
  type TreasuryAccessDraft,
} from "./TreasuryAccountAccessDialog.js";
import { TreasuryAccountFormDialog } from "./TreasuryAccountFormDialog.js";
import {
  TreasuryAccountsPanel,
  type TreasuryAccountsStatusFilter,
} from "./TreasuryAccountsPanel.js";

const DEFAULT_ACCESS_DRAFT: TreasuryAccessDraft = {
  userId: "",
  accessLevel: "VIEW",
  canViewBalance: true,
  canMutateBalance: false,
  notes: "",
};

function readStatus(raw: string | null): TreasuryAccountsStatusFilter {
  if (raw === "active" || raw === "inactive") return raw;
  return "all";
}

export function TreasuryAccountsPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryAccounts(permCheck);
  const canManage = canManageTreasuryAccounts(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const status = readStatus(searchParams.get("status"));
  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") || "50") || 50)
  );

  const abortRef = useRef<AbortController | null>(null);
  const [rows, setRows] = useState<TreasuryFinancialAccountDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<TreasuryFinancialAccountDto | null>(
    null
  );
  const [form, setForm] = useState<TreasuryAccountFormState>(
    createEmptyTreasuryAccountForm()
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [accessAccount, setAccessAccount] =
    useState<TreasuryFinancialAccountDto | null>(null);
  const [accessRows, setAccessRows] = useState<
    TreasuryFinancialAccountAccessDto[]
  >([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessDraft, setAccessDraft] =
    useState<TreasuryAccessDraft>(DEFAULT_ACCESS_DRAFT);

  const listQuery = useMemo(
    () =>
      buildTreasuryAccountsListQuery({
        search,
        status,
        page,
        pageSize,
      }),
    [search, status, page, pageSize]
  );

  const viewKind = resolveTreasuryAccountsViewKind({
    canView,
    loading,
    error,
    rowCount: rows.length,
    hasFilters: listQuery.hasFilters,
  });

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "") next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    if (!canView) {
      setRows([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTreasuryAccounts({
        page: listQuery.page,
        pageSize: listQuery.pageSize,
        search: listQuery.search,
        isActive: listQuery.isActive,
        sortBy: "sortOrder",
        sortDirection: "asc",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRows(payload.rows);
      setTotal(payload.pagination.total);
      setTotalPages(payload.pagination.totalPages);
      const newest = payload.rows.reduce<string | null>((acc, row) => {
        if (!acc || row.updatedAt > acc) return row.updatedAt;
        return acc;
      }, null);
      setHeaderUpdatedAt(newest);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar as contas financeiras.",
          e
        )
      );
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, listQuery]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const openCreate = () => {
    setFormMode("create");
    setEditing(null);
    setForm(createEmptyTreasuryAccountForm());
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (row: TreasuryFinancialAccountDto) => {
    setFormMode("edit");
    setEditing(row);
    setForm(formFromTreasuryAccount(row));
    setFormError(null);
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!canManage) return;
    const validation = validateTreasuryAccountForm(form, formMode);
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (formMode === "create") {
        await createTreasuryAccount(toCreateAccountInput(form));
      } else if (editing) {
        await updateTreasuryAccount(editing.id, {
          expectedUpdatedAt: editing.updatedAt,
          name: form.name.trim(),
          institutionName: form.institutionName.trim(),
          institutionCode: form.institutionCode.trim() || null,
          accountType: form.accountType,
          agencyMasked: form.agencyMasked.trim(),
          accountNumberMasked: form.accountNumberMasked.trim(),
          companyName: form.companyName.trim() || null,
          nomusBankAccountId: form.nomusBankAccountId.trim() || null,
          allowNegativeBalance: form.allowNegativeBalance,
          defaultBalanceOrigin: form.defaultBalanceOrigin,
          includeInConsolidated: form.includeInConsolidated,
          minimumBalance: form.minimumBalance.trim().replace(",", "."),
          liquidity: form.liquidity,
          sortOrder: Number.parseInt(form.sortOrder.trim() || "0", 10) || 0,
        });
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      setFormError(
        buildFinanceTabLoadError("Não foi possível salvar a conta.", e)
      );
    } finally {
      setSaving(false);
    }
  };

  const onDeactivate = async (row: TreasuryFinancialAccountDto) => {
    if (!canManage || !row.isActive) return;
    const reason = window.prompt(
      `Motivo para desativar a conta ${row.code}:`,
      "Desativação pela UI"
    );
    if (!reason?.trim()) return;
    try {
      await deactivateTreasuryAccount(row.id, {
        reason: reason.trim(),
        expectedUpdatedAt: row.updatedAt,
      });
      await load();
    } catch (e) {
      setError(
        buildFinanceTabLoadError("Não foi possível desativar a conta.", e)
      );
    }
  };

  const onReactivate = async (row: TreasuryFinancialAccountDto) => {
    if (!canManage || row.isActive) return;
    if (!window.confirm(`Reativar a conta ${row.code}?`)) return;
    try {
      await reactivateTreasuryAccount(row.id, {
        expectedUpdatedAt: row.updatedAt,
      });
      await load();
    } catch (e) {
      setError(
        buildFinanceTabLoadError("Não foi possível reativar a conta.", e)
      );
    }
  };

  const openAccess = async (row: TreasuryFinancialAccountDto) => {
    setAccessAccount(row);
    setAccessDraft(DEFAULT_ACCESS_DRAFT);
    setAccessError(null);
    setAccessLoading(true);
    try {
      const access = await fetchTreasuryAccountAccess(row.id);
      setAccessRows(access);
    } catch (e) {
      setAccessRows([]);
      setAccessError(
        buildFinanceTabLoadError("Não foi possível carregar os acessos.", e)
      );
    } finally {
      setAccessLoading(false);
    }
  };

  const saveAccess = async () => {
    if (!canManage || !accessAccount || !accessDraft.userId.trim()) return;
    setAccessSaving(true);
    setAccessError(null);
    try {
      await putTreasuryAccountAccess(accessAccount.id, {
        userId: accessDraft.userId.trim(),
        accessLevel: accessDraft.accessLevel,
        canViewBalance: accessDraft.canViewBalance,
        canMutateBalance: accessDraft.canMutateBalance,
        notes: accessDraft.notes.trim() || null,
      });
      const access = await fetchTreasuryAccountAccess(accessAccount.id);
      setAccessRows(access);
      setAccessDraft(DEFAULT_ACCESS_DRAFT);
    } catch (e) {
      setAccessError(
        buildFinanceTabLoadError("Não foi possível salvar o acesso.", e)
      );
    } finally {
      setAccessSaving(false);
    }
  };

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-accounts-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_ACCOUNTS_PAGE_TITLE}
          subtitle={TREASURY_ACCOUNTS_PAGE_SUBTITLE}
          updatedAt={headerUpdatedAt}
          updatedAtLabel="Última atualização em"
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
            },
          ]}
        />

        <TreasuryAccountsPanel
          viewKind={viewKind}
          canManage={canManage}
          rows={rows}
          error={error}
          search={search}
          status={status}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          total={total}
          onSearchChange={(value) =>
            patchParams({ q: value || null, page: "1" })
          }
          onStatusChange={(value) =>
            patchParams({
              status: value === "all" ? null : value,
              page: "1",
            })
          }
          onPageChange={(next) => patchParams({ page: String(next) })}
          onRefresh={() => void load()}
          onCreate={openCreate}
          onEdit={openEdit}
          onDeactivate={(row) => void onDeactivate(row)}
          onReactivate={(row) => void onReactivate(row)}
          onManageAccess={(row) => void openAccess(row)}
          onDismissError={() => setError(null)}
        />

        {formOpen ? (
          <TreasuryAccountFormDialog
            mode={formMode}
            form={form}
            saving={saving}
            error={formError}
            onChange={setForm}
            onClose={() => setFormOpen(false)}
            onSave={() => void saveForm()}
          />
        ) : null}

        {accessAccount ? (
          <TreasuryAccountAccessDialog
            accountLabel={`${accessAccount.code} · ${accessAccount.name}`}
            loading={accessLoading}
            saving={accessSaving}
            error={accessError}
            rows={accessRows}
            draft={accessDraft}
            onDraftChange={setAccessDraft}
            onClose={() => setAccessAccount(null)}
            onSave={() => void saveAccess()}
          />
        ) : null}
      </div>
    </FinanceBiDashboardShell>
  );
}
