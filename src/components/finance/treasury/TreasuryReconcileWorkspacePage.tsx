import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_RECONCILE_WORKSPACE_PATH,
  todayTreasuryCivilDateInSaoPaulo,
} from "@/src/lib/treasury/contracts/treasuryContracts.js";
import {
  acceptTreasuryReconciliation,
  fetchTreasuryActiveReconciliationsByMovement,
  unmatchTreasuryReconciliation,
} from "@/src/lib/treasury/treasuryReconciliationApi.js";
import type { TreasuryReconciliationMatchDto } from "@/src/lib/treasury/contracts/treasuryDto.js";

type WorkspacePayload = {
  summary: {
    unmatchedCount: number;
    pendingCount: number;
    activeMatches: number;
  };
  movements: Array<{
    id: string;
    accountId: string;
    companyCode?: string;
    postedCivilDate: string;
    amount: string;
    direction: string;
    memo: string | null;
    reconciliationStatus: string;
  }>;
};

const BANK_MOVEMENTS_PATH = "/finance/treasury/bank-movements";

/**
 * Workspace de conciliação bancária — visão agregada + accept/unmatch mínimo.
 */
export function TreasuryReconcileWorkspacePage() {
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [companyCode, setCompanyCode] = useState("LAZARIOS");
  const [justification, setJustification] = useState("Conciliação manual workspace");
  const [activeMatches, setActiveMatches] = useState<
    TreasuryReconciliationMatchDto[]
  >([]);
  const [unmatchReason, setUnmatchReason] = useState("Desfazer match no workspace");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchJsonOk<WorkspacePayload>(
        TREASURY_RECONCILE_WORKSPACE_PATH
      );
      setData(res);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha ao carregar workspace."
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setActiveMatches([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchTreasuryActiveReconciliationsByMovement(
          selectedId
        );
        if (!cancelled) setActiveMatches(items);
      } catch {
        if (!cancelled) setActiveMatches([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = data?.movements.find((m) => m.id === selectedId) ?? null;

  async function onAccept() {
    if (!selected) return;
    setBusyId(selected.id);
    setError(null);
    try {
      await acceptTreasuryReconciliation({
        companyCode: selected.companyCode?.trim() || companyCode.trim(),
        accountId: selected.accountId,
        matchedCivilDate:
          selected.postedCivilDate || todayTreasuryCivilDateInSaoPaulo(),
        justification,
        movements: [
          { bankMovementId: selected.id, amount: selected.amount },
        ],
        allocations: [
          {
            kind: "UNIDENTIFIED",
            amount: selected.amount,
            memo: justification,
          },
        ],
      });
      await load();
      const items = await fetchTreasuryActiveReconciliationsByMovement(
        selected.id
      );
      setActiveMatches(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao aceitar match.");
    } finally {
      setBusyId(null);
    }
  }

  async function onUnmatch(match: TreasuryReconciliationMatchDto) {
    setBusyId(match.id);
    setError(null);
    try {
      await unmatchTreasuryReconciliation({
        matchId: match.id,
        expectedVersion: match.version,
        reason: unmatchReason,
      });
      await load();
      if (selectedId) {
        const items = await fetchTreasuryActiveReconciliationsByMovement(
          selectedId
        );
        setActiveMatches(items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao desfazer match.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="treasury-reconcile-workspace-page">
      <div>
        <h2 className="text-lg font-semibold">Conciliação bancária</h2>
        <p className="text-sm text-muted-foreground">
          Workspace operacional com accept/unmatch. Detalhe OFX em{" "}
          <Link className="underline" to={BANK_MOVEMENTS_PATH}>
            Movimentos bancários
          </Link>
          .
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <span>Pendentes: {data.summary.pendingCount}</span>
          <span>Não conciliados: {data.summary.unmatchedCount}</span>
          <span>Matches ativos: {data.summary.activeMatches}</span>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Data</th>
              <th>Direção</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Memo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.movements ?? []).map((m) => (
              <tr key={m.id} className="border-b border-border/60">
                <td className="py-2">{m.postedCivilDate}</td>
                <td>{m.direction}</td>
                <td>{m.amount}</td>
                <td>{m.reconciliationStatus}</td>
                <td>{m.memo}</td>
                <td>
                  <button
                    type="button"
                    className="underline"
                    data-testid={`treasury-reconcile-select-${m.id}`}
                    onClick={() => setSelectedId(m.id)}
                  >
                    Selecionar
                  </button>
                </td>
              </tr>
            ))}
            {!data?.movements?.length ? (
              <tr>
                <td colSpan={6} className="py-4 text-muted-foreground">
                  Nenhum movimento aberto no workspace.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div
          className="space-y-3 rounded border border-border p-3"
          data-testid="treasury-reconcile-actions"
        >
          <p className="text-sm font-medium">
            Movimento {selected.id.slice(0, 8)}… — {selected.amount}
          </p>
          <label className="block text-sm">
            Empresa
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              value={companyCode}
              onChange={(e) => setCompanyCode(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Justificativa (accept → UNIDENTIFIED)
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            data-testid="treasury-reconcile-accept"
            disabled={busyId === selected.id}
            onClick={() => void onAccept()}
          >
            Aceitar match
          </button>

          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Matches ativos</p>
            <label className="block text-sm">
              Motivo unmatch
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={unmatchReason}
                onChange={(e) => setUnmatchReason(e.target.value)}
              />
            </label>
            {activeMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum match ativo.</p>
            ) : (
              activeMatches.map((match) => (
                <div
                  key={match.id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span>
                    {match.id.slice(0, 8)}… v{match.version} —{" "}
                    {match.status}
                  </span>
                  <button
                    type="button"
                    className="underline"
                    data-testid={`treasury-reconcile-unmatch-${match.id}`}
                    disabled={busyId === match.id}
                    onClick={() => void onUnmatch(match)}
                  >
                    Unmatch
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
