import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http.js";
import { TREASURY_RECONCILE_WORKSPACE_PATH } from "@/src/lib/treasury/contracts/treasuryContracts.js";

type WorkspacePayload = {
  summary: {
    unmatchedCount: number;
    pendingCount: number;
    activeMatches: number;
  };
  movements: Array<{
    id: string;
    accountId: string;
    postedCivilDate: string;
    amount: string;
    direction: string;
    memo: string | null;
    reconciliationStatus: string;
  }>;
};

const BANK_MOVEMENTS_PATH = "/finance/treasury/bank-movements";

/**
 * Workspace de conciliação bancária — visão agregada + link para movimentos/OFX.
 */
export function TreasuryReconcileWorkspacePage() {
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchJsonOk<WorkspacePayload>(
          TREASURY_RECONCILE_WORKSPACE_PATH
        );
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Falha ao carregar workspace."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4" data-testid="treasury-reconcile-workspace-page">
      <div>
        <h2 className="text-lg font-semibold">Conciliação bancária</h2>
        <p className="text-sm text-muted-foreground">
          Workspace operacional. Importação OFX e detalhe em{" "}
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
              </tr>
            ))}
            {!data?.movements?.length ? (
              <tr>
                <td colSpan={5} className="py-4 text-muted-foreground">
                  Nenhum movimento aberto no workspace.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
