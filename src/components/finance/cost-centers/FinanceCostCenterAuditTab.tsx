import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";

type AuditLogRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userName: string | null;
  createdAt: string;
};

type Props = {
  canView: boolean;
};

export function FinanceCostCenterAuditTab({ canView }: Props) {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState("");
  const [userName, setUserName] = useState("");

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (entityType.trim()) q.set("entityType", entityType.trim());
      if (userName.trim()) q.set("userName", userName.trim());
      const payload = await fetchJsonOk<{ items: AuditLogRow[] }>(
        `/api/finance/cost-center-audit?${q.toString()}`,
        { credentials: "include" }
      );
      setRows(payload.items);
    } catch {
      setRows([]);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [canView, entityType, userName]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) {
    return (
      <FinanceModuleEmptyState
        title="Sem permissão para auditoria"
        description="Solicite acesso à auditoria de classificação para consultar o histórico de alterações."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-audit-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Entidade</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="Ex.: FinancialCostCenter"
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Usuário</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Nome do usuário"
            />
          </label>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando auditoria…" /> : null}

      {!loading && rows.length === 0 ? (
        <FinanceModuleEmptyState
          title="Nenhum registro de auditoria"
          description="As alterações em centros de custo, regras e classificações aparecerão aqui conforme forem registradas."
        />
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className={cn(financeBiCardClass, "overflow-x-auto")}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Entidade</th>
                <th className="px-3 py-2">Ação</th>
                <th className="px-3 py-2">Usuário</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-3 py-2">{formatFinanceDateTime(row.createdAt)}</td>
                  <td className="px-3 py-2">{row.entityType}</td>
                  <td className="px-3 py-2">{row.action}</td>
                  <td className="px-3 py-2">{row.userName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
