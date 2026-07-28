/**
 * Página — saldos finais guiados + fechamento via TreasuryDailyClosing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type { TreasuryGuidedDailyClosingWorkspaceDto } from "@/src/lib/treasury/contracts/index.js";
import {
  fetchTreasuryTodayClosing,
  saveTreasuryTodayClosing,
  type TreasuryTodayClosingSaveItem,
} from "@/src/lib/treasury/treasuryTodayClosingApi.js";
import { closeTreasuryDailyClosing } from "@/src/lib/treasury/treasuryDailyClosingApi.js";
import {
  canCloseTreasuryDailyClosing,
  canViewTreasuryDailyClosing,
} from "@/src/lib/treasury/treasuryDailyClosingPermissions.js";
import { canViewTreasuryToday } from "@/src/lib/treasury/treasuryTodayPermissions.js";
import { canManageTreasuryBalances } from "@/src/lib/treasury/treasuryBalancesPermissions.js";
import {
  TREASURY_TODAY_CLOSING_PAGE_SUBTITLE,
  TREASURY_TODAY_CLOSING_PAGE_TITLE,
  createTreasuryTodayClosingDrafts,
  parseTreasuryTodayClosingStep,
  resolveTreasuryTodayClosingViewKind,
  type TreasuryTodayClosingDraftRow,
  type TreasuryTodayClosingStep,
} from "@/src/lib/treasury/treasuryTodayClosingUi.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryTodayUi.js";
import { parseTreasuryPtBrMoneyToApi } from "@/src/lib/treasury/treasuryBalancesUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryTodayClosingPanel } from "./TreasuryTodayClosingPanel.js";

export function TreasuryTodayClosingPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView =
    canViewTreasuryToday(permCheck) || canViewTreasuryDailyClosing(permCheck);
  const canManage = canManageTreasuryBalances(permCheck);
  const canClose = canCloseTreasuryDailyClosing(permCheck);

  const abortRef = useRef<AbortController | null>(null);
  const [data, setData] = useState<TreasuryGuidedDailyClosingWorkspaceDto | null>(
    null
  );
  const [drafts, setDrafts] = useState<
    Record<string, TreasuryTodayClosingDraftRow>
  >({});
  const [caveatDrafts, setCaveatDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);

  const civilDate = useMemo(() => todayCivilDateLocal(), []);
  const step = parseTreasuryTodayClosingStep(searchParams.get("step"));

  const load = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTreasuryTodayClosing({
        date: civilDate,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setData(payload);
      setDrafts(createTreasuryTodayClosingDrafts(payload));
      setHasLoaded(true);
      setHeaderUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(
        buildFinanceTabLoadError("Não foi possível carregar os saldos finais.", err)
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
    (accountId: string, patch: Partial<TreasuryTodayClosingDraftRow>) => {
      setDrafts((prev) => {
        const current = prev[accountId];
        if (!current) return prev;
        return { ...prev, [accountId]: { ...current, ...patch } };
      });
    },
    []
  );

  const onCaveatChange = useCallback((code: string, message: string) => {
    setCaveatDrafts((prev) => ({ ...prev, [code]: message }));
  }, []);

  const onStepChange = useCallback(
    (next: TreasuryTodayClosingStep) => {
      const qs = new URLSearchParams(searchParams);
      if (next === "final-balances") qs.delete("step");
      else qs.set("step", next === "divergences" ? "divergences" : "close");
      setSearchParams(qs, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const onSave = useCallback(async () => {
    if (!canManage || !data) return;
    setSaving(true);
    setError(null);
    try {
      const items: TreasuryTodayClosingSaveItem[] = [];
      for (const account of data.accounts) {
        if (!account.canInformClosing) continue;
        const draft = drafts[account.accountId];
        if (!draft) continue;
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
        });
      }
      if (items.length === 0) {
        setError("Informe ao menos um saldo final para salvar.");
        return;
      }
      await saveTreasuryTodayClosing({ civilDate, items });
      await load();
      onStepChange("divergences");
    } catch (err) {
      setError(
        buildFinanceTabLoadError("Não foi possível salvar os saldos finais.", err)
      );
    } finally {
      setSaving(false);
    }
  }, [canManage, civilDate, data, drafts, load, onStepChange]);

  const onCloseDay = useCallback(
    async (withCaveats: boolean) => {
      if (!canClose || !data?.closeGates.sourceHash) return;
      setClosing(true);
      setError(null);
      try {
        const caveats = withCaveats
          ? data.closeGates.requiredCaveatCodes.map((code) => ({
              code,
              message: (caveatDrafts[code] ?? "").trim() || `Ressalva ${code}`,
            }))
          : [];
        if (
          withCaveats &&
          caveats.some((c) => !c.message || c.message.startsWith("Ressalva "))
        ) {
          // allow default message but prefer filled
        }
        await closeTreasuryDailyClosing({
          companyCode: data.companyCode?.trim() || "DEFAULT",
          date: civilDate,
          sourceHash: data.closeGates.sourceHash,
          caveats,
        });
        await load();
        navigate("/finance/treasury/today");
      } catch (err) {
        setError(
          buildFinanceTabLoadError("Não foi possível fechar o dia. Recarregue e tente novamente.", err)
        );
        await load();
      } finally {
        setClosing(false);
      }
    },
    [canClose, caveatDrafts, civilDate, data, load, navigate]
  );

  const viewKind = resolveTreasuryTodayClosingViewKind({
    canView,
    loading,
    error,
    hasLoaded,
    accountCount: data?.accounts.length ?? 0,
  });

  return (
    <FinanceBiDashboardShell
      header={
        <FinanceExecutivePageHeader
          title={TREASURY_TODAY_CLOSING_PAGE_TITLE}
          subtitle={TREASURY_TODAY_CLOSING_PAGE_SUBTITLE}
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
      <TreasuryTodayClosingPanel
        viewKind={viewKind}
        step={step}
        data={data}
        drafts={drafts}
        error={error}
        saving={saving}
        closing={closing}
        canManage={canManage}
        canClose={canClose}
        caveatDrafts={caveatDrafts}
        onDraftChange={onDraftChange}
        onCaveatChange={onCaveatChange}
        onStepChange={onStepChange}
        onSave={() => void onSave()}
        onCloseDay={(withCaveats) => void onCloseDay(withCaveats)}
        onRefresh={() => void load()}
        onDismissError={() => setError(null)}
      />
    </FinanceBiDashboardShell>
  );
}
