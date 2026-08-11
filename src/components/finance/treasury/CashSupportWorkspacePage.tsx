/**
 * Central de Conciliação Bancária (ex-Apoio ao Caixa) — página interativa.
 *
 * Quatro abas: Conciliação por Títulos (grid operacional), Movimentos
 * Bancários (painel original + conciliação manual), Revisar Sugestões e
 * Histórico. Busca dados, orquestra os diálogos e delega TODA gravação ao
 * motor oficial (`treasuryReconciliationApi.ts` / rotas cash-support) —
 * nenhum cálculo financeiro acontece neste arquivo, e a auto-conciliação é
 * um POST idempotente que o backend decide sozinho (frontend nunca casa).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/src/lib/utils";
import {
  fetchCashSupport,
  fetchCashSupportHistory,
  fetchCashSupportSuggestions,
  fetchCashSupportTitleGrid,
  runCashSupportAutoReconcile,
  type CashSupportAutoReconcilePayload,
  type CashSupportFetchParams,
  type CashSupportHistoryPayload,
  type CashSupportSuggestionsPayload,
  type CashSupportTitleGridPayload,
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
import { CashSupportTitleGridTab } from "./CashSupportTitleGridTab.js";
import { CashSupportSuggestionsTab } from "./CashSupportSuggestionsTab.js";
import { CashSupportHistoryTab } from "./CashSupportHistoryTab.js";

export type CashSupportWorkspaceTab =
  | "titles"
  | "movements"
  | "suggestions"
  | "history";

const TAB_LABELS: Record<CashSupportWorkspaceTab, string> = {
  titles: "Conciliação por Títulos",
  movements: "Movimentos Bancários",
  suggestions: "Revisar Sugestões",
  history: "Histórico",
};

export type CashSupportWorkspacePageProps = {
  /** Injeção para teste — em produção usa `fetchCashSupport`. */
  fetcher?: typeof fetchCashSupport;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Ano/(Mês) → primeiro dia do período (mês, ou 1º de janeiro se "todos os meses"). */
export function firstDayOf(state: CashSupportPeriodFilterState): string {
  const month = state.month === "" ? 1 : state.month;
  return `${state.year}-${pad2(month)}-01`;
}

export function lastDayOfMonth(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${pad2(month)}-${pad2(lastDay)}`;
}

/**
 * "Até" padrão para Ano/Mês recém-escolhidos: fecha no fim do período (mês
 * ou ano) quando ele já passou; usa "hoje" quando o período ainda está em
 * curso. Sem isto, trocar só o Ano deixava o "Até" antigo (de outro ano)
 * parado, e um ano passado continuava puxando dados até a data de hoje do
 * ano corrente — o filtro de Ano ficava sem efeito real.
 */
export function defaultUntilFor(year: number, month: number | "", today: string): string {
  const todayYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));
  if (month === "") {
    // Ano estritamente futuro também fecha em 31/12: usar "hoje" ali
    // produziria civilDateTo anterior a civilDateFrom (1º de janeiro
    // daquele ano), um intervalo invertido.
    return year === todayYear ? today : `${year}-12-31`;
  }
  if (year > todayYear || (year === todayYear && month > todayMonth)) {
    return lastDayOfMonth(year, month);
  }
  if (year === todayYear && month === todayMonth) {
    return today;
  }
  return lastDayOfMonth(year, month);
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

  const [activeTab, setActiveTab] = useState<CashSupportWorkspaceTab>("titles");

  const [titleGrid, setTitleGrid] = useState<CashSupportTitleGridPayload | null>(null);
  const [titleGridLoading, setTitleGridLoading] = useState(true);
  const [titleGridError, setTitleGridError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<CashSupportSuggestionsPayload | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  const [history, setHistory] = useState<CashSupportHistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [autoRunBusy, setAutoRunBusy] = useState(false);
  const [autoRunResult, setAutoRunResult] = useState<CashSupportAutoReconcilePayload | null>(null);
  const [autoRunError, setAutoRunError] = useState<string | null>(null);

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

  const loadTitleGrid = useCallback(
    (signal?: AbortSignal) => {
      setTitleGridLoading(true);
      setTitleGridError(null);
      return fetchCashSupportTitleGrid({ civilDateFrom, civilDateTo, signal })
        .then((res) => {
          setTitleGrid(res);
          setTitleGridLoading(false);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          setTitleGridError(err instanceof Error ? err.message : "Falha ao carregar grid.");
          setTitleGridLoading(false);
        });
    },
    [civilDateFrom, civilDateTo]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadTitleGrid(controller.signal);
    return () => controller.abort();
  }, [loadTitleGrid]);

  const loadSuggestions = useCallback(
    (signal?: AbortSignal) => {
      setSuggestionsLoading(true);
      setSuggestionsError(null);
      return fetchCashSupportSuggestions({ civilDateFrom, civilDateTo, signal })
        .then((res) => {
          setSuggestions(res);
          setSuggestionsLoading(false);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          setSuggestionsError(
            err instanceof Error ? err.message : "Falha ao carregar sugestões."
          );
          setSuggestionsLoading(false);
        });
    },
    [civilDateFrom, civilDateTo]
  );

  const loadHistory = useCallback(
    (signal?: AbortSignal) => {
      setHistoryLoading(true);
      setHistoryError(null);
      return fetchCashSupportHistory({ civilDateFrom, civilDateTo, signal })
        .then((res) => {
          setHistory(res);
          setHistoryLoading(false);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          setHistoryError(err instanceof Error ? err.message : "Falha ao carregar histórico.");
          setHistoryLoading(false);
        });
    },
    [civilDateFrom, civilDateTo]
  );

  // Abas de sugestões/histórico carregam sob demanda (e recarregam ao trocar
  // o período enquanto abertas).
  useEffect(() => {
    if (activeTab !== "suggestions") return;
    const controller = new AbortController();
    void loadSuggestions(controller.signal);
    return () => controller.abort();
  }, [activeTab, loadSuggestions]);

  useEffect(() => {
    if (activeTab !== "history") return;
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [activeTab, loadHistory]);

  /** Recarrega tudo que está visível após qualquer escrita. */
  const reloadAll = useCallback(async () => {
    await Promise.all([
      load(),
      loadTitleGrid(),
      activeTab === "suggestions" ? loadSuggestions() : Promise.resolve(),
      activeTab === "history" ? loadHistory() : Promise.resolve(),
    ]);
  }, [load, loadTitleGrid, loadSuggestions, loadHistory, activeTab]);

  async function handleAutoReconcile() {
    setAutoRunBusy(true);
    setAutoRunError(null);
    setAutoRunResult(null);
    try {
      const result = await runCashSupportAutoReconcile({ civilDateFrom, civilDateTo });
      setAutoRunResult(result);
      await reloadAll();
    } catch (err) {
      setAutoRunError(
        err instanceof Error ? err.message : "Falha na conciliação automática."
      );
    } finally {
      setAutoRunBusy(false);
    }
  }

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
      await reloadAll();
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
      await reloadAll();
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
      await reloadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao reverter.");
    } finally {
      setActionBusy(false);
    }
  }

  function handlePeriodChange(next: CashSupportPeriodFilterState) {
    // Recalcula "Até" só quando Ano/Mês mudam — se o usuário editou "Até" na
    // mão (mesmo Ano/Mês), a escolha dele prevalece.
    const yearOrMonthChanged =
      next.year !== period.year || next.month !== period.month;
    setPeriod(
      yearOrMonthChanged
        ? { ...next, until: defaultUntilFor(next.year, next.month, today) }
        : next
    );
  }

  const movementLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.rows ?? []) {
      if (row.resourceType === "BANK_MOVEMENT" && row.bankMovementKey) {
        map.set(
          row.bankMovementKey.bankMovementId,
          row.description ?? row.displayId
        );
      }
    }
    return map;
  }, [data]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Conciliação Bancária</h2>
          <p className="text-[12px] text-muted-foreground">
            Vincula movimentos do extrato aos títulos CR/CP como evidência
            local — nunca dá baixa no Nomus, nunca altera o título oficial.
          </p>
        </div>
        <button
          type="button"
          className={cn(
            "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90",
            autoRunBusy && "cursor-wait opacity-60"
          )}
          disabled={autoRunBusy}
          onClick={() => void handleAutoReconcile()}
          data-testid="auto-reconcile-button"
        >
          {autoRunBusy ? "Conciliando…" : "Conciliar automaticamente"}
        </button>
      </div>

      {autoRunError ? (
        <div className="mb-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
          {autoRunError}
        </div>
      ) : null}
      {autoRunResult ? (
        <div
          className="mb-3 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-xs text-[#065F46]"
          data-testid="auto-reconcile-result"
        >
          Auto-conciliação ({autoRunResult.ruleVersion}):{" "}
          <strong>{autoRunResult.autoAccepted}</strong> conciliado(s) agora,{" "}
          {autoRunResult.alreadyReconciled} já existente(s),{" "}
          {autoRunResult.needsReview} para revisar, {autoRunResult.unmatched} sem
          candidato.
          {autoRunResult.failures.length > 0
            ? ` ${autoRunResult.failures.length} falha(s): ${autoRunResult.failures
                .map((f) => f.message)
                .join(" | ")}`
            : ""}
        </div>
      ) : null}

      <div className="mb-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
        <CashSupportPeriodFilters
          value={period}
          yearOptions={yearOptions}
          onChange={handlePeriodChange}
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {(Object.keys(TAB_LABELS) as CashSupportWorkspaceTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium",
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab(tab)}
            data-testid={`tab-${tab}`}
          >
            {TAB_LABELS[tab]}
            {tab === "suggestions" && titleGrid
              ? ` (${titleGrid.cards.reviewCount})`
              : ""}
          </button>
        ))}
      </div>

      {activeTab === "titles" ? (
        <CashSupportTitleGridTab
          loading={titleGridLoading}
          error={titleGridError}
          titleRows={titleGrid?.titleRows ?? []}
          unexplainedMovements={titleGrid?.unexplainedMovements ?? []}
          cards={titleGrid?.cards ?? null}
        />
      ) : null}

      {activeTab === "movements" ? (
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
      ) : null}

      {activeTab === "suggestions" ? (
        <CashSupportSuggestionsTab
          loading={suggestionsLoading}
          error={suggestionsError}
          suggestions={suggestions?.suggestions ?? []}
          movementLabelById={movementLabelById}
          onOpenManualFlow={() => setActiveTab("movements")}
        />
      ) : null}

      {activeTab === "history" ? (
        <CashSupportHistoryTab
          loading={historyLoading}
          error={historyError}
          matches={history?.matches ?? []}
          onUnmatchRequested={(match) => {
            setActionError(null);
            setPendingMatch(match);
            setPendingAction("UNMATCH");
          }}
          onReverseRequested={(match) => {
            setActionError(null);
            setPendingMatch(match);
            setPendingAction("REVERSE");
          }}
        />
      ) : null}

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
