/**
 * Página — saldos iniciais guiados do dia.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type { TreasuryGuidedDailyOpeningWorkspaceDto } from "@/src/lib/treasury/contracts/index.js";
import {
  fetchTreasuryTodayOpening,
  saveTreasuryTodayOpening,
  type TreasuryTodayOpeningSaveItem,
} from "@/src/lib/treasury/treasuryTodayOpeningApi.js";
import { canViewTreasuryToday } from "@/src/lib/treasury/treasuryTodayPermissions.js";
import { canManageTreasuryBalances } from "@/src/lib/treasury/treasuryBalancesPermissions.js";
import {
  TREASURY_TODAY_OPENING_PAGE_SUBTITLE,
  TREASURY_TODAY_OPENING_PAGE_TITLE,
  createTreasuryTodayOpeningDrafts,
  resolveTreasuryTodayOpeningDraftDiff,
  resolveTreasuryTodayOpeningViewKind,
  type TreasuryTodayOpeningDraftRow,
} from "@/src/lib/treasury/treasuryTodayOpeningUi.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryTodayUi.js";
import { parseTreasuryPtBrMoneyToApi } from "@/src/lib/treasury/treasuryBalancesUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryTodayOpeningPanel } from "./TreasuryTodayOpeningPanel.js";

export function TreasuryTodayOpeningPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryToday(permCheck);
  const canManage = canManageTreasuryBalances(permCheck);

  const abortRef = useRef<AbortController | null>(null);
  const [data, setData] = useState<TreasuryGuidedDailyOpeningWorkspaceDto | null>(
    null
  );
  const [drafts, setDrafts] = useState<
    Record<string, TreasuryTodayOpeningDraftRow>
  >({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);

  const civilDate = useMemo(() => todayCivilDateLocal(), []);

  const load = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTreasuryTodayOpening({
        date: civilDate,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setData(payload);
      setDrafts(createTreasuryTodayOpeningDrafts(payload));
      setHeaderUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(
        buildFinanceTabLoadError("Não foi possível carregar os saldos iniciais.", err)
      );
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [canView, civilDate]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const onDraftChange = useCallback(
    (accountId: string, patch: Partial<TreasuryTodayOpeningDraftRow>) => {
      setDrafts((prev) => {
        const current = prev[accountId];
        if (!current) return prev;
        return { ...prev, [accountId]: { ...current, ...patch } };
      });
    },
    []
  );

  const buildItems = useCallback(
    (mode: "all-pending" | "confirmable-only"): TreasuryTodayOpeningSaveItem[] => {
      if (!data) return [];
      const items: TreasuryTodayOpeningSaveItem[] = [];
      for (const account of data.accounts) {
        if (account.situation === "INACTIVE") continue;
        if (account.situation === "CONFIRMED" && mode === "confirmable-only") {
          continue;
        }
        const draft = drafts[account.accountId];
        if (!draft) continue;

        if (mode === "confirmable-only") {
          if (!account.canConfirmSuggested) continue;
          items.push({
            accountId: account.accountId,
            expectedVersion: draft.expectedVersion,
            confirmSuggested: true,
            notes: draft.notes.trim() || null,
          });
          continue;
        }

        if (account.situation === "CONFIRMED" && !draft.editing) continue;

        const diff = resolveTreasuryTodayOpeningDraftDiff(account, draft);
        const matchesSuggestion =
          account.suggestedOpeningBalance != null &&
          diff.validAmount &&
          diff.informedOpeningBalance === account.suggestedOpeningBalance &&
          !diff.hasDifference;

        if (matchesSuggestion && !draft.editing) {
          items.push({
            accountId: account.accountId,
            expectedVersion: draft.expectedVersion,
            confirmSuggested: true,
            notes: draft.notes.trim() || null,
          });
          continue;
        }

        const amount = parseTreasuryPtBrMoneyToApi(draft.displayAmount);
        if (!amount) {
          throw new Error(
            `Informe um valor válido para ${account.accountName}.`
          );
        }
        items.push({
          accountId: account.accountId,
          expectedVersion: draft.expectedVersion,
          amount,
          notes: draft.notes.trim() || null,
          justificationCode: draft.justificationCode || null,
          justificationDetail: draft.justificationDetail.trim() || null,
        });
      }
      return items;
    },
    [data, drafts]
  );

  const onConfirmAll = useCallback(async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const items = buildItems("confirmable-only");
      if (items.length === 0) {
        setError("Não há contas prontas para confirmar sem divergência.");
        return;
      }
      const result = await saveTreasuryTodayOpening({
        civilDate,
        items,
      });
      await load();
      if (result.nextStepHref) {
        navigate(result.nextStepHref);
      }
    } catch (err) {
      setError(
        buildFinanceTabLoadError("Não foi possível confirmar os saldos.", err)
      );
    } finally {
      setSaving(false);
    }
  }, [buildItems, canManage, civilDate, load, navigate]);

  const onSave = useCallback(async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const items = buildItems("all-pending");
      if (items.length === 0) {
        setError("Nenhuma alteração para salvar.");
        return;
      }
      const result = await saveTreasuryTodayOpening({
        civilDate,
        items,
      });
      await load();
      if (result.nextStepHref) {
        navigate(result.nextStepHref);
      }
    } catch (err) {
      setError(
        buildFinanceTabLoadError("Não foi possível salvar os saldos iniciais.", err)
      );
    } finally {
      setSaving(false);
    }
  }, [buildItems, canManage, civilDate, load, navigate]);

  const viewKind = resolveTreasuryTodayOpeningViewKind({
    canView,
    loading,
    error,
    data,
  });

  return (
    <FinanceBiDashboardShell
      header={
        <FinanceExecutivePageHeader
          title={TREASURY_TODAY_OPENING_PAGE_TITLE}
          subtitle={TREASURY_TODAY_OPENING_PAGE_SUBTITLE}
          updatedAt={headerUpdatedAt}
          actions={[
            {
              ...FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
              disabled: loading || !canView,
            },
          ]}
        />
      }
    >
      <TreasuryTodayOpeningPanel
        viewKind={viewKind}
        data={data}
        drafts={drafts}
        error={error}
        saving={saving}
        canManage={canManage}
        onDraftChange={onDraftChange}
        onConfirmAll={() => void onConfirmAll()}
        onSave={() => void onSave()}
        onRefresh={() => void load()}
        onDismissError={() => setError(null)}
      />
    </FinanceBiDashboardShell>
  );
}
