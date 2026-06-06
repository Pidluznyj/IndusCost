import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";

type DashboardCards = {
  totalRecords: number;
  openTitlesCount: number;
  settledTitlesCount: number;
  totalOpenAmount: number;
  overdueAmount: number;
  dueTodayAmount: number;
  upcomingAmount: number;
  delinquencyRate: number;
  lastSyncAt: string | null;
};

type DashboardPayload = {
  generatedAt: string;
  cards: DashboardCards;
};

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTimeSafe(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export function FinanceAccountsReceivableFoundationPanel() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<DashboardPayload>(
        "/api/finance/accounts-receivable/dashboard"
      );
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o dashboard.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = data?.cards;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card/60 p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Contas a Receber — fundação</h3>
            <p className="text-sm text-muted-foreground">
              Backend read-only conectado ao stage local Nomus. A UI completa do dashboard será
              entregue na próxima fase.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Atualizar
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Endpoint: <span className="font-mono">GET /api/finance/accounts-receivable/dashboard</span>
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {cards ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <MetricCard label="Total de títulos" value={String(cards.totalRecords)} />
          <MetricCard label="Em aberto" value={String(cards.openTitlesCount)} />
          <MetricCard label="Baixados" value={String(cards.settledTitlesCount)} />
          <MetricCard label="Saldo em aberto" value={formatMoney(cards.totalOpenAmount)} />
          <MetricCard label="Vencido" value={formatMoney(cards.overdueAmount)} />
          <MetricCard label="Vence hoje" value={formatMoney(cards.dueTodayAmount)} />
          <MetricCard label="A vencer" value={formatMoney(cards.upcomingAmount)} />
          <MetricCard label="Inadimplência" value={`${cards.delinquencyRate.toFixed(2)}%`} />
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando métricas…
        </div>
      ) : null}

      {data ? (
        <p className="text-xs text-muted-foreground">
          Gerado em {formatDateTimeSafe(data.generatedAt)} · Última sync Nomus:{" "}
          {formatDateTimeSafe(cards?.lastSyncAt)}
        </p>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
