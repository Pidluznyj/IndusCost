import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Eye,
  Loader2,
  Package,
  Search,
  X,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "@/src/components/shared/SearchableSelect";
import {
  formatCivilDatePtBrFromIso,
  formatEffectiveProductionCostSummary,
  formatProductionCostVersionStatusLabel,
  PRODUCTION_COST_DISPLAY_LABELS,
  PRODUCTION_COST_IMMUTABLE_NOTICE,
  productionCostVersionStatusBadgeClass,
  isProductionCostVersionReadOnly,
} from "@/src/lib/productionCostTablesUi";
import type { EffectiveProductProductionCostResult } from "@/src/lib/productionCostVersioning";

type ProductLite = { id: string; sku: string; name: string };

export type ProductionCostVersionRow = {
  id: string;
  code: string;
  name: string;
  effectiveDate: string;
  status: string;
  revision: number;
  publishedAt: string | null;
  publishedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  itemsCount: number;
  source: string | null;
  notes: string | null;
  supersedesVersionId: string | null;
  supersedesVersion?: {
    id: string;
    code: string;
    revision: number;
    status: string;
  } | null;
};

type ProductionCostVersionDetail = ProductionCostVersionRow & {
  items: Array<{
    id: string;
    productId: string;
    productCodeSnapshot: string;
    productNameSnapshot: string;
    unitProductionCost: number | string;
    materialCost: number | string;
    processCost: number | string;
    laborCost: number | string;
    machineCost: number | string;
    overheadCost: number | string;
    otherCost: number | string;
    currency: string;
    calculationHash: string | null;
    calculationSnapshot: unknown;
  }>;
};

type EffectiveCostApiResponse = EffectiveProductProductionCostResult & {
  product?: { id: string; sku: string; name: string };
  referenceDate: string;
  summaryText: string;
};

type ProductionCostTablesPanelProps = {
  products: ProductLite[];
  canManage?: boolean;
};

function money(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? formatCurrency(n, 2) : "—";
}

export function ProductionCostTablesPanel({
  products,
  canManage = false,
}: ProductionCostTablesPanelProps) {
  const [versions, setVersions] = useState<ProductionCostVersionRow[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [detail, setDetail] = useState<ProductionCostVersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [lookupProductId, setLookupProductId] = useState("");
  const [lookupDate, setLookupDate] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<EffectiveCostApiResponse | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: p.id,
        label: `${p.sku} — ${p.name}`,
      })),
    [products]
  );

  const selectedProduct = products.find((p) => p.id === lookupProductId);

  const loadVersions = useCallback(async () => {
    setLoadingVersions(true);
    try {
      const rows = await fetchJsonOk<ProductionCostVersionRow[]>(
        "/api/production-cost-tables/versions?limit=50"
      );
      setVersions(Array.isArray(rows) ? rows : []);
    } catch {
      setVersions([]);
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const openDetail = async (versionId: string) => {
    setDetailLoading(true);
    try {
      const row = await fetchJsonOk<ProductionCostVersionDetail>(
        `/api/production-cost-table-versions/${versionId}`
      );
      setDetail(row);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const runLookup = async () => {
    if (!lookupProductId || !lookupDate.trim()) {
      setLookupError("Selecione produto e data de referência.");
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const qs = new URLSearchParams({
        productId: lookupProductId,
        referenceDate: lookupDate,
      });
      const data = await fetchJsonOk<EffectiveCostApiResponse>(
        `/api/production-cost-tables/effective-cost?${qs.toString()}`
      );
      setLookupResult(data);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Falha na consulta.");
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="production-cost-tables-panel">
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-100 flex gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <p>{PRODUCTION_COST_IMMUTABLE_NOTICE}</p>
      </div>

      <section className="space-y-3" data-testid="production-cost-versions-section">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold">Versões da tabela de custo de produção</h4>
          <button
            type="button"
            onClick={() => void loadVersions()}
            disabled={loadingVersions}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Atualizar
          </button>
        </div>

        {loadingVersions ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma versão cadastrada.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-accent/30 text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="p-2 text-left font-semibold">Código</th>
                  <th className="p-2 text-left font-semibold">Nome</th>
                  <th className="p-2 text-left font-semibold">Vigência</th>
                  <th className="p-2 text-left font-semibold">Status</th>
                  <th className="p-2 text-right font-semibold">Rev.</th>
                  <th className="p-2 text-right font-semibold">Produtos</th>
                  <th className="p-2 text-left font-semibold">Publicado em</th>
                  <th className="p-2 text-left font-semibold">Publicado por</th>
                  <th className="p-2 text-left font-semibold">Substitui</th>
                  <th className="p-2 text-left font-semibold">Obs.</th>
                  <th className="p-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {versions.map((v) => (
                  <tr key={v.id} className="hover:bg-accent/10">
                    <td className="p-2 font-mono font-semibold">{v.code}</td>
                    <td className="p-2">{v.name}</td>
                    <td className="p-2 whitespace-nowrap">
                      {formatCivilDatePtBrFromIso(v.effectiveDate)}
                    </td>
                    <td className="p-2">
                      <span
                        className={cn(
                          "inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          productionCostVersionStatusBadgeClass(v.status)
                        )}
                      >
                        {formatProductionCostVersionStatusLabel(v.status)}
                      </span>
                    </td>
                    <td className="p-2 text-right tabular-nums">{v.revision}</td>
                    <td className="p-2 text-right tabular-nums">{v.itemsCount}</td>
                    <td className="p-2 whitespace-nowrap">
                      {v.publishedAt
                        ? new Date(v.publishedAt).toLocaleString("pt-BR")
                        : "—"}
                    </td>
                    <td className="p-2">{v.publishedBy ?? "—"}</td>
                    <td className="p-2 text-muted-foreground">
                      {v.supersedesVersion
                        ? `${v.supersedesVersion.code} rev.${v.supersedesVersion.revision}`
                        : "—"}
                    </td>
                    <td className="p-2 max-w-[140px] truncate" title={v.notes ?? ""}>
                      {v.notes ?? "—"}
                    </td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        onClick={() => void openDetail(v.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
                        data-testid={`production-cost-view-items-${v.id}`}
                      >
                        <Eye className="h-3.5 w-3.5" /> Itens
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="rounded-xl border border-border bg-card p-4 space-y-4"
        data-testid="production-cost-effective-lookup"
      >
        <h4 className="text-sm font-bold flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          {PRODUCTION_COST_DISPLAY_LABELS.effectiveCostLookup}
        </h4>
        <p className="text-xs text-muted-foreground">
          Informe produto e data para ver qual custo de produção IndusCost estaria vigente (mesma
          regra da margem de pedidos).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Produto</label>
            <SearchableSelect
              options={productOptions}
              value={lookupProductId}
              onChange={setLookupProductId}
              placeholder="Buscar por SKU ou nome..."
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" /> Data de referência
            </label>
            <input
              type="date"
              className="w-full p-2.5 rounded-xl border border-border bg-background text-sm"
              value={lookupDate}
              onChange={(e) => setLookupDate(e.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void runLookup()}
          disabled={lookupLoading}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
          Consultar custo vigente
        </button>

        {lookupError ? (
          <p className="text-xs text-red-600">{lookupError}</p>
        ) : null}

        {lookupResult ? (
          <div
            className={cn(
              "rounded-xl border p-4 text-sm space-y-2",
              lookupResult.status === "OK"
                ? "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20"
            )}
            data-testid="production-cost-lookup-result"
          >
            <p className="font-medium">{lookupResult.summaryText}</p>
            {lookupResult.status === "OK" ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Custo unitário</span>
                  <p className="font-mono font-semibold">
                    {money(lookupResult.unitProductionCost)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Tabela</span>
                  <p className="font-semibold">
                    {lookupResult.versionCode} rev.{lookupResult.revision}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Vigência</span>
                  <p>{formatCivilDatePtBrFromIso(lookupResult.effectiveDate)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Publicado em</span>
                  <p>
                    {lookupResult.publishedAt
                      ? new Date(lookupResult.publishedAt).toLocaleString("pt-BR")
                      : "—"}
                  </p>
                </div>
                {lookupResult.breakdown ? (
                  <>
                    <div>
                      <span className="text-muted-foreground">MP</span>
                      <p className="font-mono">{money(lookupResult.breakdown.materialCost)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Processo</span>
                      <p className="font-mono">{money(lookupResult.breakdown.processCost)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Mão de obra</span>
                      <p className="font-mono">{money(lookupResult.breakdown.laborCost)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Máquina</span>
                      <p className="font-mono">{money(lookupResult.breakdown.machineCost)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Overhead/outros</span>
                      <p className="font-mono">
                        {money(
                          Number(lookupResult.breakdown.overheadCost) +
                            Number(lookupResult.breakdown.otherCost)
                        )}
                      </p>
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Status: {PRODUCTION_COST_DISPLAY_LABELS.costUnresolved} — nenhuma tabela publicada
                cobre este produto na data informada.
              </p>
            )}
          </div>
        ) : null}
      </section>

      {(detailLoading || detail) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl flex flex-col"
            data-testid="production-cost-version-detail"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div>
                <h3 className="text-lg font-bold">
                  {detail ? `${detail.code} — ${detail.name}` : "Carregando..."}
                </h3>
                {detail ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    Rev. {detail.revision} · vigência{" "}
                    {formatCivilDatePtBrFromIso(detail.effectiveDate)} ·{" "}
                    {formatProductionCostVersionStatusLabel(detail.status)}
                    {isProductionCostVersionReadOnly(detail.status)
                      ? " · somente leitura"
                      : canManage
                        ? " · editável (DRAFT)"
                        : ""}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg p-2 hover:bg-accent"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {detailLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
              ) : detail ? (
                <table className="w-full text-xs">
                  <thead className="bg-accent/30 text-muted-foreground uppercase">
                    <tr>
                      <th className="p-2 text-left">Código</th>
                      <th className="p-2 text-left">Descrição</th>
                      <th className="p-2 text-right">Custo unit.</th>
                      <th className="p-2 text-right">MP</th>
                      <th className="p-2 text-right">Processo</th>
                      <th className="p-2 text-right">MO</th>
                      <th className="p-2 text-right">Máq.</th>
                      <th className="p-2 text-right">Overhead</th>
                      <th className="p-2 text-left">Hash</th>
                      <th className="p-2 text-left">Origem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td className="p-2 font-mono">{item.productCodeSnapshot}</td>
                        <td className="p-2">{item.productNameSnapshot}</td>
                        <td className="p-2 text-right font-mono font-semibold">
                          {money(item.unitProductionCost)}
                        </td>
                        <td className="p-2 text-right font-mono">{money(item.materialCost)}</td>
                        <td className="p-2 text-right font-mono">{money(item.processCost)}</td>
                        <td className="p-2 text-right font-mono">{money(item.laborCost)}</td>
                        <td className="p-2 text-right font-mono">{money(item.machineCost)}</td>
                        <td className="p-2 text-right font-mono">
                          {money(
                            Number(item.overheadCost) + Number(item.otherCost)
                          )}
                        </td>
                        <td className="p-2 font-mono text-[10px] text-muted-foreground max-w-[80px] truncate">
                          {item.calculationHash ?? "—"}
                        </td>
                        <td className="p-2 text-[10px] text-muted-foreground">
                          {item.calculationSnapshot ? "Motor industrial" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
