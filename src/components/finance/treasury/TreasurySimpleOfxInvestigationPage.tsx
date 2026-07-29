/**
 * Página — assistente simples de investigação OFX / divergência.
 * Reaproveita preview/apply, sugestões, match/unmatch e ledger existentes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  buildTreasurySimpleRefreshHeaderAction,
  resolveTreasurySimpleCompanyCode,
} from "@/src/lib/treasury/treasurySimpleUiShared.js";
import type {
  TreasuryBankMovementDto,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import {
  fetchTreasuryBankMovements,
  type TreasuryOfxApplyResponse,
} from "@/src/lib/treasury/treasuryBankImportOfxApi.js";
import { fetchTreasuryReceivables } from "@/src/lib/treasury/treasuryReceivablesApi.js";
import { fetchTreasuryPayables } from "@/src/lib/treasury/treasuryPayablesApi.js";
import { fetchTreasuryTodayClosing } from "@/src/lib/treasury/treasuryTodayClosingApi.js";
import {
  canManageTreasuryReconciliation,
  canViewTreasuryReconciliation,
} from "@/src/lib/treasury/treasuryReconciliationPermissions.js";
import {
  runTreasuryReconciliationSuggestionEngine,
  type TreasuryReconciliationSuggestionCandidate,
  type TreasuryReconciliationTitleSeed,
} from "@/src/lib/treasury/domain/treasuryReconciliationSuggestionEngine.js";
import {
  assertTreasurySimpleOfxNoAutoMatch,
  buildTreasurySimpleOfxInvestigationResult,
  type TreasurySimpleOfxInvestigationResultDto,
  type TreasurySimpleOfxUnidentifiedOption,
} from "@/src/lib/treasury/domain/treasurySimpleOfxInvestigationRules.js";
import {
  confirmTreasurySimpleOfxTitleMatch,
  createTreasurySimpleOfxManualFromMovement,
  undoTreasurySimpleOfxMatch,
} from "@/src/lib/treasury/treasurySimpleOfxInvestigationActions.js";
import { fetchTreasuryActiveReconciliationsByMovement } from "@/src/lib/treasury/treasuryReconciliationApi.js";
import {
  TREASURY_SIMPLE_OFX_PAGE_SUBTITLE,
  TREASURY_SIMPLE_OFX_PAGE_TITLE,
  parseTreasurySimpleOfxStep,
  resolveTreasurySimpleOfxViewKind,
  type TreasurySimpleOfxStep,
} from "@/src/lib/treasury/treasurySimpleOfxInvestigationUi.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryTodayUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryOfxImportDialog } from "./TreasuryOfxImportDialog.js";
import { TreasurySimpleOfxInvestigationPanel } from "./TreasurySimpleOfxInvestigationPanel.js";

export function TreasurySimpleOfxInvestigationPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryReconciliation(permCheck);
  const canManage = canManageTreasuryReconciliation(permCheck);

  const abortRef = useRef<AbortController | null>(null);
  const [accounts, setAccounts] = useState<TreasuryFinancialAccountDto[]>([]);
  const [movements, setMovements] = useState<TreasuryBankMovementDto[]>([]);
  const [suggestionsByMovement, setSuggestionsByMovement] = useState<
    Record<string, TreasuryReconciliationSuggestionCandidate[]>
  >({});
  const [result, setResult] =
    useState<TreasurySimpleOfxInvestigationResultDto | null>(null);
  const [selectedOtherTitleId, setSelectedOtherTitleId] = useState<
    Record<string, string>
  >({});
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);

  const civilDate = useMemo(() => todayCivilDateLocal(), []);
  const step = parseTreasurySimpleOfxStep(searchParams.get("step"));
  const accountId =
    searchParams.get("accountId")?.trim() ||
    accounts[0]?.id ||
    "";

  const onStepChange = useCallback(
    (next: TreasurySimpleOfxStep) => {
      const qs = new URLSearchParams(searchParams);
      if (next === "import") qs.delete("step");
      else qs.set("step", next);
      if (accountId) qs.set("accountId", accountId);
      setSearchParams(qs, { replace: true });
    },
    [accountId, searchParams, setSearchParams]
  );

  const setAccountId = useCallback(
    (id: string) => {
      const qs = new URLSearchParams(searchParams);
      if (id) qs.set("accountId", id);
      else qs.delete("accountId");
      setSearchParams(qs, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const [accountsPayload, closing] = await Promise.all([
        fetchTreasuryAccounts({
          page: 1,
          pageSize: 200,
          isActive: true,
          sortBy: "sortOrder",
          signal: ac.signal,
        }),
        fetchTreasuryTodayClosing({ date: civilDate, signal: ac.signal }).catch(
          () => null
        ),
      ]);
      if (ac.signal.aborted) return;
      const accountRows = accountsPayload.rows ?? [];
      setAccounts(accountRows);
      const selected =
        searchParams.get("accountId")?.trim() || accountRows[0]?.id || "";
      if (!searchParams.get("accountId") && accountRows[0]?.id) {
        const qs = new URLSearchParams(searchParams);
        qs.set("accountId", accountRows[0].id);
        setSearchParams(qs, { replace: true });
      }

      let movementRows: TreasuryBankMovementDto[] = [];
      if (selected) {
        const mov = await fetchTreasuryBankMovements({
          accountId: selected,
          page: 1,
          pageSize: 100,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        movementRows = mov.items ?? [];
        setMovements(movementRows);

        const [recv, pay] = await Promise.all([
          fetchTreasuryReceivables({
            page: 1,
            pageSize: 100,
            plannedAccountId: selected,
            includeCancelled: false,
            signal: ac.signal,
          }).catch(() => ({ rows: [] })),
          fetchTreasuryPayables({
            page: 1,
            pageSize: 100,
            plannedAccountId: selected,
            includeCancelled: false,
            signal: ac.signal,
          }).catch(() => ({ rows: [] })),
        ]);
        if (ac.signal.aborted) return;

        const titles: TreasuryReconciliationTitleSeed[] = [
          ...(recv.rows ?? []).map((r) => ({
            side: "AR" as const,
            officialTitleId: r.titleId,
            externalId: r.externalId,
            counterpartyName: r.official.counterparty.name,
            counterpartyTaxId: r.official.counterparty.taxId,
            documentNumber: r.official.documentNumber,
            description: r.official.description,
            invoiceNumber: r.official.invoice.number,
            dueDate: r.official.dueDate,
            openBalance: r.openAmount ?? r.official.openBalance ?? "0.00",
            isCancelled:
              r.official.cancellation.isCancelledOrRemovedFromSource,
            isSettled: Boolean(r.official.officialStatus.isSettled),
          })),
          ...(pay.rows ?? []).map((r) => ({
            side: "AP" as const,
            officialTitleId: r.titleId,
            externalId: r.externalId,
            counterpartyName: r.official.counterparty.name,
            counterpartyTaxId: r.official.counterparty.taxId,
            documentNumber: r.official.documentNumber,
            description: r.official.description,
            invoiceNumber: r.official.invoice.number,
            dueDate: r.official.dueDate,
            openBalance: r.openAmount ?? r.official.openBalance ?? "0.00",
            isCancelled:
              r.official.cancellation.isCancelledOrRemovedFromSource,
            isSettled: Boolean(r.official.officialStatus.isSettled),
          })),
        ];

        const openMovements = movementRows.filter(
          (m) =>
            m.reconciliationStatus === "PENDING" ||
            m.reconciliationStatus === "PARTIAL" ||
            m.reconciliationStatus === "UNMATCHED"
        );
        const companyCode = resolveTreasurySimpleCompanyCode({
          preferred: accountRows.find((a) => a.id === selected)?.companyCode,
          accounts: accountRows,
        });
        if (!companyCode) {
          setSuggestionsByMovement({});
          setError(
            "Selecione uma conta com companyCode configurado para sugerir correspondências."
          );
          return;
        }
        const engine = runTreasuryReconciliationSuggestionEngine({
          companyCode,
          asOfCivilDate: civilDate,
          movements: openMovements.map((m) => ({
            id: m.id,
            accountId: m.accountId,
            direction: m.direction as "DEBIT" | "CREDIT",
            amount: m.amount,
            postedCivilDate: m.postedCivilDate,
            documentNumber: m.documentNumber,
            counterpartyName: m.counterpartyName,
            description: m.description,
            reconciliationStatus: m.reconciliationStatus as
              | "PENDING"
              | "PARTIAL"
              | "MATCHED"
              | "UNMATCHED"
              | "IGNORED",
            reconciledAmount: m.reconciledAmount,
          })),
          titles,
        });
        assertTreasurySimpleOfxNoAutoMatch(engine.autoMatched);
        const byId: Record<string, TreasuryReconciliationSuggestionCandidate[]> =
          {};
        for (const s of engine.suggestions) {
          (byId[s.movementId] ??= []).push(s);
        }
        setSuggestionsByMovement(byId);
      } else {
        setMovements([]);
        setSuggestionsByMovement({});
      }

      const accountClosing = closing?.accounts.find(
        (a) => a.accountId === selected
      );
      setResult(
        buildTreasurySimpleOfxInvestigationResult({
          divergenceBefore: accountClosing?.divergence ?? null,
          movements: movementRows.map((m) => ({
            id: m.id,
            amount: m.amount,
            reconciliationStatus: String(m.reconciliationStatus),
            reconciledAmount: m.reconciledAmount,
          })),
        })
      );
      setHasLoaded(true);
      setHeaderUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(
        buildFinanceTabLoadError("Não foi possível carregar a conferência bancária.", err)
      );
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [canView, civilDate, searchParams, setSearchParams]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const onApplied = useCallback(
    (_result: TreasuryOfxApplyResponse) => {
      setImportOpen(false);
      onStepChange("investigate");
      void load();
    },
    [load, onStepChange]
  );

  const onConfirmSuggestion = useCallback(
    async (
      movement: TreasuryBankMovementDto,
      suggestion: TreasuryReconciliationSuggestionCandidate
    ) => {
      if (!canManage) return;
      setBusyId(movement.id);
      setError(null);
      try {
        await confirmTreasurySimpleOfxTitleMatch({
          companyCode: movement.companyCode,
          accountId: movement.accountId,
          bankMovementId: movement.id,
          amount: suggestion.suggestedAmount,
          matchedCivilDate: movement.postedCivilDate,
          officialTitleId: suggestion.officialTitleId,
          nomusExternalId: suggestion.externalId,
          nomusSide: suggestion.side === "AR" ? "RECEIVABLE" : "PAYABLE",
        });
        await load();
      } catch (err) {
        setError(
          buildFinanceTabLoadError("Não foi possível confirmar a correspondência.", err)
        );
      } finally {
        setBusyId(null);
      }
    },
    [canManage, load]
  );

  const onConfirmOtherTitle = useCallback(
    async (movement: TreasuryBankMovementDto) => {
      if (!canManage) return;
      const titleId = (selectedOtherTitleId[movement.id] ?? "").trim();
      if (!titleId) {
        setError("Informe o ID do título para corresponder.");
        return;
      }
      setBusyId(movement.id);
      setError(null);
      try {
        await confirmTreasurySimpleOfxTitleMatch({
          companyCode: movement.companyCode,
          accountId: movement.accountId,
          bankMovementId: movement.id,
          amount: movement.amount,
          matchedCivilDate: movement.postedCivilDate,
          officialTitleId: titleId,
          nomusSide:
            movement.direction === "CREDIT" ? "RECEIVABLE" : "PAYABLE",
        });
        await load();
      } catch (err) {
        setError(
          buildFinanceTabLoadError("Não foi possível confirmar o título.", err)
        );
      } finally {
        setBusyId(null);
      }
    },
    [canManage, load, selectedOtherTitleId]
  );

  const onCreateManual = useCallback(
    async (
      movement: TreasuryBankMovementDto,
      option: TreasurySimpleOfxUnidentifiedOption
    ) => {
      if (!canManage) return;
      setBusyId(movement.id);
      setError(null);
      try {
        await createTreasurySimpleOfxManualFromMovement({
          companyCode: movement.companyCode,
          accountId: movement.accountId,
          bankMovementId: movement.id,
          amount: movement.amount,
          movementDirection: String(movement.direction),
          postedCivilDate: movement.postedCivilDate,
          option,
        });
        await load();
      } catch (err) {
        setError(
          buildFinanceTabLoadError("Não foi possível criar o lançamento manual.", err)
        );
      } finally {
        setBusyId(null);
      }
    },
    [canManage, load]
  );

  const onUnmatch = useCallback(
    async (movement: TreasuryBankMovementDto) => {
      if (!canManage) return;
      setBusyId(movement.id);
      setError(null);
      try {
        const matches = await fetchTreasuryActiveReconciliationsByMovement(
          movement.id
        );
        const active = matches[0];
        if (!active) {
          setError("Não há correspondência ativa para desfazer.");
          return;
        }
        await undoTreasurySimpleOfxMatch({
          matchId: active.id,
          expectedVersion: active.version,
        });
        await load();
      } catch (err) {
        setError(
          buildFinanceTabLoadError("Não foi possível desfazer a correspondência.", err)
        );
      } finally {
        setBusyId(null);
      }
    },
    [canManage, load]
  );

  const viewKind = resolveTreasurySimpleOfxViewKind({
    canView,
    loading,
    error,
    hasLoaded,
  });

  const movementViews = movements.map((movement) => ({
    movement,
    suggestions: suggestionsByMovement[movement.id] ?? [],
  }));

  const importSlot = (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <label className="block space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted-foreground">Conta</span>
        <select
          className="w-full rounded-lg border border-border bg-background px-3 py-2"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          data-testid="treasury-simple-ofx-account"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        disabled={!canManage || !accountId}
        onClick={() => setImportOpen(true)}
        data-testid="treasury-simple-ofx-open-import"
      >
        Importar arquivo OFX
      </button>
      <p className="text-xs text-muted-foreground">
        Depois do preview e da confirmação, os movimentos entram na etapa de
        correspondências.
      </p>
      <TreasuryOfxImportDialog
        open={importOpen}
        accounts={accounts}
        onClose={() => setImportOpen(false)}
        onApplied={onApplied}
      />
    </div>
  );

  return (
    <FinanceBiDashboardShell>
      <FinanceExecutivePageHeader
        title={TREASURY_SIMPLE_OFX_PAGE_TITLE}
        subtitle={TREASURY_SIMPLE_OFX_PAGE_SUBTITLE}
        updatedAt={headerUpdatedAt}
        actions={[
          buildTreasurySimpleRefreshHeaderAction({
            onClick: () => void load(),
            disabled: loading || !canView,
          }),
        ]}
      />
      <TreasurySimpleOfxInvestigationPanel
        viewKind={viewKind}
        step={step}
        error={error}
        canManage={canManage}
        importSlot={importSlot}
        movements={movementViews}
        result={result}
        busyId={busyId}
        selectedOtherTitleId={selectedOtherTitleId}
        onStepChange={onStepChange}
        onConfirmSuggestion={(m, s) => void onConfirmSuggestion(m, s)}
        onOtherTitleChange={(id, titleId) =>
          setSelectedOtherTitleId((prev) => ({ ...prev, [id]: titleId }))
        }
        onConfirmOtherTitle={(m) => void onConfirmOtherTitle(m)}
        onCreateManual={(m, opt) => void onCreateManual(m, opt)}
        onUnmatch={(m) => void onUnmatch(m)}
        onRefresh={() => void load()}
        onDismissError={() => setError(null)}
      />
    </FinanceBiDashboardShell>
  );
}
