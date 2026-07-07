import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { AdminKpiSection } from "@/src/components/admin/adminUi";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import type { CostPriceMarginAuditPayload } from "@/src/lib/costPriceMarginIntegratedAudit";

type Props = {
  canView: boolean;
};

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, 1)}%`;
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

          <AdminKpiSection
            title="Cobertura integrada Custo → Preço → Margem"
            eyebrow={`Período ${payload.period.label} · referência ${payload.referenceDate}`}
            minColumnWidth={180}
            testId="cost-price-margin-audit-kpi"
          >
            <MetricCard
              label="Cobertura MP"
              value={pct(payload.materials.coveragePercent)}
              subtitle={`${payload.materials.withCoverage}/${payload.materials.total} cobertos`}
              variant={payload.materials.withoutCoverage > 0 ? "warning" : "success"}
            />
            <MetricCard
              label="Cobertura custo produtos"
              value={pct(payload.products.activeProducts.coveragePercent)}
              subtitle={`${payload.products.activeProducts.withCoverage}/${payload.products.activeProducts.total} cobertos`}
              variant={payload.products.activeProducts.withoutCoverage > 0 ? "warning" : "success"}
            />
            <MetricCard
              label="Cobertura custo componentes"
              value={pct(payload.products.activeComponents.coveragePercent)}
              subtitle={`${payload.products.activeComponents.withCoverage}/${payload.products.activeComponents.total} cobertos`}
              variant={payload.products.activeComponents.withoutCoverage > 0 ? "warning" : "success"}
            />
            <MetricCard
              label="Cobertura preço (produtos)"
              value={pct(
                payload.officialPrice.activeProductsTotal > 0
                  ? Math.round(
                      (payload.officialPrice.productsWithOfficialPrice /
                        payload.officialPrice.activeProductsTotal) *
                        10000
                    ) / 100
                  : null
              )}
              subtitle={`${payload.officialPrice.productsWithOfficialPrice}/${payload.officialPrice.activeProductsTotal} com preço oficial`}
              variant={
                payload.officialPrice.productsWithOfficialPrice <
                payload.officialPrice.activeProductsTotal
                  ? "warning"
                  : "success"
              }
            />
            <MetricCard
              label="Pedidos margem OK"
              value={String(payload.salesOrders.marginOk)}
              subtitle={`de ${payload.salesOrders.itemsSold} itens em ${payload.salesOrders.ordersTotal} pedido(s)`}
              variant="info"
            />
            <MetricCard
              label="Pendências críticas"
              value={String(payload.criticalPendingCount)}
              subtitle={`SEM_CUSTO: ${payload.salesOrders.semCusto} · SEM_PRECO_TABELA: ${payload.salesOrders.semPrecoTabela} · PRECO_INDISPONIVEL: ${payload.salesOrders.precoIndisponivel}`}
              variant={payload.criticalPendingCount > 0 ? "danger" : "success"}
              icon={
                payload.criticalPendingCount > 0 ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )
              }
            />
          </AdminKpiSection>

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
