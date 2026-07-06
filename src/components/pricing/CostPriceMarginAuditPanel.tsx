import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import type { CostPriceMarginAuditPayload } from "@/src/lib/costPriceMarginIntegratedAudit";

type Props = {
  canView: boolean;
};

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, 1)}%`;
}

function CoverageCard(props: {
  title: string;
  metrics: { total: number; withCoverage: number; withoutCoverage: number; coveragePercent: number | null };
  tone?: "default" | "warning";
}) {
  const { title, metrics, tone = "default" } = props;
  return (
    <div
      className={cn(
        "rounded-xl border p-4 bg-card",
        tone === "warning" && metrics.withoutCoverage > 0 ? "border-amber-500/40" : "border-border"
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-2xl font-bold mt-1">{pct(metrics.coveragePercent)}</p>
      <p className="text-xs text-muted-foreground mt-1">
        {metrics.withCoverage}/{metrics.total} cobertos
        {metrics.withoutCoverage > 0 ? (
          <span className="text-amber-700 dark:text-amber-400"> · {metrics.withoutCoverage} pendente(s)</span>
        ) : null}
      </p>
    </div>
  );
}

export function CostPriceMarginAuditPanel({ canView }: Props) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CostPriceMarginAuditPayload | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ year, month, top: "10" });
      const data = await fetchJsonOk<CostPriceMarginAuditPayload>(
        `/api/cost-price-margin/audit?${q.toString()}`
      );
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar auditoria.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [canView, year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-muted-foreground">
          Ano
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1 block w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Mês
          <input
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-1 block w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {loading && !payload ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando auditoria integrada...
        </div>
      ) : null}

      {payload ? (
        <>
          <p className="text-xs text-muted-foreground">
            Período {payload.period.label} · referência catálogo {payload.referenceDate} · gerado{" "}
            {new Date(payload.generatedAt).toLocaleString("pt-BR")}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CoverageCard title="Cobertura MP" metrics={payload.materials} />
            <CoverageCard title="Cobertura custo produtos" metrics={payload.products.activeProducts} />
            <CoverageCard title="Cobertura custo componentes" metrics={payload.products.activeComponents} />
            <CoverageCard
              title="Cobertura preço (produtos)"
              metrics={{
                total: payload.officialPrice.activeProductsTotal,
                withCoverage: payload.officialPrice.productsWithOfficialPrice,
                withoutCoverage:
                  payload.officialPrice.activeProductsTotal -
                  payload.officialPrice.productsWithOfficialPrice,
                coveragePercent:
                  payload.officialPrice.activeProductsTotal > 0
                    ? Math.round(
                        (payload.officialPrice.productsWithOfficialPrice /
                          payload.officialPrice.activeProductsTotal) *
                          10000
                      ) / 100
                    : null,
              }}
            />
            <div className="rounded-xl border border-border p-4 bg-card">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pedidos margem OK
              </p>
              <p className="text-2xl font-bold mt-1">{payload.salesOrders.marginOk}</p>
              <p className="text-xs text-muted-foreground mt-1">
                de {payload.salesOrders.itemsSold} itens em {payload.salesOrders.ordersTotal} pedido(s)
              </p>
            </div>
            <div
              className={cn(
                "rounded-xl border p-4 bg-card",
                payload.criticalPendingCount > 0 ? "border-amber-500/40" : "border-emerald-500/30"
              )}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                {payload.criticalPendingCount > 0 ? (
                  <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                )}
                Pendências críticas
              </p>
              <p className="text-2xl font-bold mt-1">{payload.criticalPendingCount}</p>
              <p className="text-xs text-muted-foreground mt-1">
                SEM_CUSTO: {payload.salesOrders.semCusto} · SEM_PRECO_TABELA:{" "}
                {payload.salesOrders.semPrecoTabela} · PRECO_INDISPONIVEL:{" "}
                {payload.salesOrders.precoIndisponivel}
              </p>
            </div>
          </div>

          {(payload.topSoldWithoutCost.length > 0 || payload.topSoldWithoutOfficialPrice.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {payload.topSoldWithoutCost.length > 0 ? (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-muted/40 text-xs font-bold">Top vendidos SEM_CUSTO</div>
                  <ul className="divide-y divide-border text-xs">
                    {payload.topSoldWithoutCost.map((row) => (
                      <li key={`${row.productId}:cost`} className="px-3 py-2">
                        <span className="font-mono">{row.sku}</span> ({row.productType}) —{" "}
                        {formatCurrency(row.revenueSold)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {payload.topSoldWithoutOfficialPrice.length > 0 ? (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-muted/40 text-xs font-bold">Top vendidos sem preço oficial</div>
                  <ul className="divide-y divide-border text-xs">
                    {payload.topSoldWithoutOfficialPrice.map((row) => (
                      <li key={`${row.productId}:${row.reason}`} className="px-3 py-2">
                        <span className="font-mono">{row.sku}</span> [{row.reason}] —{" "}
                        {formatCurrency(row.revenueSold)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
