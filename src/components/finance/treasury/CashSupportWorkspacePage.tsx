/**
 * Apoio ao Caixa — página interativa (CS-007 leitura + CS-012/013/014/016
 * escrita). Busca dados, orquestra os diálogos e delega toda gravação ao
 * motor oficial já corrigido (`treasuryReconciliationApi.ts`, mesmas rotas
 * `POST /reconciliations` e `.../unmatch` e `.../reverse` do resto da
 * Tesouraria) — nenhum cálculo financeiro acontece neste arquivo.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCashSupport,
  type CashSupportFetchParams,
} from "@/src/lib/treasury/cashSupportApi.js";
import {
  acceptTreasuryReconciliation,
  fetchTreasuryActiveReconciliationsByMovement,
  reverseTreasuryReconciliation,
  unmatchTreasuryReconciliation,
} from "@/src/lib/treasury/treasuryReconciliationApi.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/treasuryContracts.js";
import type { TreasuryReconciliationMatchDto } from "@/src/lib/treasury/contracts/index.js";
import type { CashSupportReadModel, CashSupportUnifiedRow } from "@/src/lib/treasury/contracts/cashSupportContracts.js";
import { CashSupportPanel } from "./CashSupportPanel.js";
import {
  CashSupportPeriodFilters,
  type CashSupportPeriodFilterState,
} from "./CashSupportPeriodFilters.js";
import {
  CashSupportReconcileDialog,
  type CashSupportReconcileSubmitPayload,
} from "./CashSupportReconcileDialog.js";
import { CashSupportUnmatchDialog } from "./CashSupportUnmatchDialog.js";
import { TreasuryReconciliationReverseConfirmDialog } from "./TreasuryReconciliationReverseConfirmDialog.js";

export type CashSupportWorkspacePageProps = {
  /** Injeção para teste — em produção usa `fetchCashSupport`. */
  fetcher?: typeof fetchCashSupport;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Ano/(Mês) → primeiro dia do período (mês, ou 1º de janeiro se "todos os meses"). */
function firstDayOf(state: CashSupportPeriodFilterState): string {
  const month = state.month === "" ? 1 : state.month;
  return `${state.year}-${pad2(month)}-01`;
}

function candidateTitlesFor(
  movements: CashSupportUnifiedRow[],
  allRows: readonly CashSupportUnifiedRow[]
): CashSupportUnifiedRow[] {
  const directions = new Set(movements.map((m) => m.direction));
  if (directions.size !== 1) return [];
  const direction = [...directions][0];
  return allRows.filter(
    (r) =>
      (r.resourceType === "OFFICIAL_RECEIVABLE" || r.resourceType === "OFFICIAL_PAYABLE") &&
      r.direction === direction &&
      Number(r.residualAmount) > 0
  );
}

export function CashSupportWorkspacePage({
  fetcher = fetchCashSupport,
}: CashSupportWorkspacePageProps) {
  const today = useMemo(() => todayTreasuryCivilDateInSaoPaulo(), []);
  const [period, setPeriod] = useState<CashSupportPeriodFilterState>(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    until: today,
  }));
  const yearOptions = useMemo(() => {
    const base = Number(today.slice(0, 4));
    const out: number[] = [];
    for (let y = base - 3; y <= base + 3; y += 1) out.push(y);
    return out;
  }, [today]);

  const civilDateFrom = useMemo(() => firstDayOf(period), [period]);
  const civilDateTo = period.until;

  const [data, setData] = useState<CashSupportReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reconcileMovements, setReconcileMovements] = useState<CashSupportUnifiedRow[] | null>(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const [pendingMatch, setPendingMatch] = useState<TreasuryReconciliationMatchDto | null>(null);
  const [pendingAction, setPendingAction] = useState<"UNMATCH" | "REVERSE" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      const params: CashSupportFetchParams = { civilDateFrom, civilDateTo, signal };
      return fetcher(params)
        .then((res) => {
          setData(res);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          setError(err instanceof Error ? err.message : "Falha ao carregar.");
          setLoading(false);
        });
    },
    [civilDateFrom, civilDateTo, fetcher]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function handleReconcileSubmit(payload: CashSupportReconcileSubmitPayload) {
    setReconcileBusy(true);
    setReconcileError(null);
    try {
      await acceptTreasuryReconciliation({
        companyCode: payload.companyCode,
        accountId: payload.accountId,
        justification: payload.justification,
        idempotencyKey:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `cs-${Date.now()}-${Math.random()}`,
        movements: payload.movements,
        allocations: payload.allocations,
      });
      setReconcileMovements(null);
      await load();
    } catch (err) {
      setReconcileError(err instanceof Error ? err.message : "Falha ao conciliar.");
    } finally {
      setReconcileBusy(false);
    }
  }

  async function openMatchAction(row: CashSupportUnifiedRow, matchId: string, action: "UNMATCH" | "REVERSE") {
    setActionError(null);
    try {
      const movementId = row.bankMovementKey?.bankMovementId;
      if (!movementId) return;
      const matches = await fetchTreasuryActiveReconciliationsByMovement(movementId);
      const match = matches.find((m) => m.id === matchId) ?? null;
      setPendingMatch(match);
      setPendingAction(match ? action : null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao carregar match.");
    }
  }

  async function handleUnmatchConfirm(input: { reason: string }) {
    if (!pendingMatch) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await unmatchTreasuryReconciliation({
        matchId: pendingMatch.id,
        expectedVersion: pendingMatch.version,
        reason: input.reason,
      });
      setPendingMatch(null);
      setPendingAction(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao desfazer.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReverseConfirm(input: { reason: string; confirmPhrase: string }) {
    if (!pendingMatch) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await reverseTreasuryReconciliation({
        matchId: pendingMatch.id,
        expectedVersion: pendingMatch.version,
        reason: input.reason,
        confirmPhrase: input.confirmPhrase,
      });
      setPendingMatch(null);
      setPendingAction(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao reverter.");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
        <CashSupportPeriodFilters
          value={period}
          yearOptions={yearOptions}
          onChange={setPeriod}
        />
      </div>

      <CashSupportPanel
        civilDateFrom={civilDateFrom}
        civilDateTo={civilDateTo}
        loading={loading}
        error={error}
        data={data}
        onReconcileSelected={(movements) => {
          setReconcileError(null);
          setReconcileMovements(movements);
        }}
        onUnmatchRequested={(row, matchId) => void openMatchAction(row, matchId, "UNMATCH")}
        onReverseRequested={(row, matchId) => void openMatchAction(row, matchId, "REVERSE")}
      />

      <CashSupportReconcileDialog
        open={reconcileMovements != null}
        movements={reconcileMovements ?? []}
        candidateTitles={candidateTitlesFor(reconcileMovements ?? [], data?.rows ?? [])}
        busy={reconcileBusy}
        error={reconcileError}
        onCancel={() => setReconcileMovements(null)}
        onSubmit={handleReconcileSubmit}
      />

      <CashSupportUnmatchDialog
        open={pendingAction === "UNMATCH"}
        match={pendingMatch}
        busy={actionBusy}
        error={actionError}
        onCancel={() => {
          setPendingMatch(null);
          setPendingAction(null);
        }}
        onConfirm={handleUnmatchConfirm}
      />

      <TreasuryReconciliationReverseConfirmDialog
        open={pendingAction === "REVERSE"}
        match={pendingMatch}
        busy={actionBusy}
        error={actionError}
        onCancel={() => {
          setPendingMatch(null);
          setPendingAction(null);
        }}
        onConfirm={handleReverseConfirm}
      />
    </>
  );
}
