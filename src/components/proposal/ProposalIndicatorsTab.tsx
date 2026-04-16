import React, { useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import type { Proposal, ProposalItem } from "@/src/types/commercial";
import {
  buildProposalMaterialConsolidation,
  formatAdaptiveCurrency,
  formatAdaptiveNumber,
  type ConsolidatedMaterialLite,
} from "@/src/lib/proposalMaterialConsolidation";
import {
  AlertCircle,
  BarChart3,
  ChevronRight,
  Expand,
  Layers,
  Loader2,
  Package,
  ShieldAlert,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

function safeNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function moneyOrDash(value: unknown, decimals = 2): string {
  const n = safeNum(value);
  if (n === null) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: decimals,
    maximumFractionDigits: 6,
  });
}

function numOrDash(value: unknown, decimals = 2): string {
  const n = safeNum(value);
  if (n === null) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: 6 });
}

type CostAnalysisLite = {
  totalMaterialCost?: unknown;
  totalHH_Unit?: unknown;
  totalHM_Unit?: unknown;
  totalIndustrialCost?: unknown;
  openBook?: unknown;
};

type OpenBookLite = {
  executive?: {
    totalMaterialCost?: unknown;
    totalHH?: unknown;
    totalHM?: unknown;
    totalIndustrialCost?: unknown;
    pctMp?: unknown;
    pctHh?: unknown;
    pctHm?: unknown;
  };
  consolidatedMaterials?: unknown;
  explosionReconcilesMaterialTotal?: unknown;
};

type Props = {
  mode?: "summary" | "detailed";
  proposalNumber?: number | null;
  proposalTitle?: string | null;
  proposalId?: string | null;
  items: ProposalItem[];
  totals: Pick<
    Proposal,
    | "totalGrossValue"
    | "totalDiscount"
    | "totalNetValue"
    | "totalTaxes"
    | "totalCommission"
    | "totalFreight"
    | "totalMarginValue"
    | "totalMarginPerc"
  >;
  onOpenDetailed?: () => void;
};

type LineMetrics = {
  productId: string;
  qty: number;
  mpUnit: number | null;
  hhUnit: number | null;
  hmUnit: number | null;
  baseUnit: number | null;
  baseTotal: number | null;
  mpTotal: number | null;
  hhTotal: number | null;
  hmTotal: number | null;
  warning: string | null;
  openBook: OpenBookLite | null;
};

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "primary" | "green" | "amber" | "red";
}) {
  const ring =
    tone === "primary"
      ? "border-primary/30 bg-primary/5"
      : tone === "green"
        ? "border-green-500/25 bg-green-500/5"
        : tone === "amber"
          ? "border-amber-500/25 bg-amber-500/5"
          : tone === "red"
            ? "border-red-500/25 bg-red-500/5"
            : "border-border bg-card";

  return (
    <div className={cn("rounded-xl border p-3 flex flex-col gap-1 min-h-[90px]", ring)}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
        {label}
      </div>
      <p className="text-base font-black tabular-nums leading-tight">{value}</p>
      {sub ? <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p> : null}
    </div>
  );
}

function StackedBar({
  parts,
  total,
}: {
  parts: Array<{ key: string; label: string; value: number; className: string }>;
  total: number | null;
}) {
  if (!total || total <= 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Composição indisponível: total de referência não definido.</p>
      </div>
    );
  }

  const sanitized = parts.filter((p) => Number.isFinite(p.value) && p.value > 0);
  const sum = sanitized.reduce((acc, p) => acc + p.value, 0);
  const remaining = Math.max(0, total - sum);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold tracking-tight">Composição sobre o preço líquido</h4>
        <p className="text-xs text-muted-foreground tabular-nums">
          Base: {moneyOrDash(total)}
        </p>
      </div>
      <div className="h-3 rounded-full bg-muted overflow-hidden flex">
        {sanitized.map((p) => (
          <div
            key={p.key}
            className={cn("h-full", p.className)}
            style={{ width: `${Math.min(100, (p.value / total) * 100)}%` }}
            title={`${p.label}: ${moneyOrDash(p.value)} (${numOrDash((p.value / total) * 100, 1)}%)`}
          />
        ))}
        {remaining > 0.01 ? (
          <div
            className="h-full bg-slate-300/70 dark:bg-slate-700/40"
            style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }}
            title={`Outros/Não explicado: ${moneyOrDash(remaining)} (${numOrDash((remaining / total) * 100, 1)}%)`}
          />
        ) : null}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
        {sanitized.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-accent/20 px-3 py-2">
            <span className="font-semibold">{p.label}</span>
            <span className="tabular-nums text-muted-foreground">{numOrDash((p.value / total) * 100, 1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function openBookFromUnknown(openBook: unknown): OpenBookLite | null {
  if (!openBook || typeof openBook !== "object") return null;
  const ob = openBook as Record<string, unknown>;
  const executive = (ob.executive && typeof ob.executive === "object") ? (ob.executive as any) : undefined;
  return {
    executive: executive
      ? {
          totalMaterialCost: executive.totalMaterialCost,
          totalHH: executive.totalHH,
          totalHM: executive.totalHM,
          totalIndustrialCost: executive.totalIndustrialCost,
          pctMp: executive.pctMp,
          pctHh: executive.pctHh,
          pctHm: executive.pctHm,
        }
      : undefined,
    consolidatedMaterials: ob.consolidatedMaterials,
    explosionReconcilesMaterialTotal: ob.explosionReconcilesMaterialTotal,
  };
}

export function ProposalIndicatorsTab({
  mode = "summary",
  proposalNumber,
  proposalTitle,
  items,
  totals,
  onOpenDetailed,
}: Props) {
  const productIds = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      if (typeof it.productId === "string" && it.productId) s.add(it.productId);
    }
    return [...s.values()];
  }, [items]);

  const [analysisByProductId, setAnalysisByProductId] = useState<Record<string, CostAnalysisLite | { error: string; message?: string }>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<null | { title: string; productId: string; openBook: OpenBookLite | null }>(null);

  useEffect(() => {
    let cancelled = false;
    const missing = productIds.filter((id) => !(id in analysisByProductId));
    if (missing.length === 0) return;

    setLoading(true);
    setError(null);
    Promise.all(
      missing.map(async (id) => {
        try {
          const data = await fetchJsonOk<CostAnalysisLite>(`/api/products/${id}/cost-analysis`);
          return { id, data };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Erro ao calcular custo do item.";
          return { id, data: { error: "COST_ANALYSIS_FAILED", message: msg } as any };
        }
      })
    )
      .then((pairs) => {
        if (cancelled) return;
        setAnalysisByProductId((prev) => {
          const next = { ...prev };
          for (const p of pairs) next[p.id] = p.data as any;
          return next;
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar análises.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIds.join("|")]);

  const lineMetrics = useMemo<LineMetrics[]>(() => {
    return items.map((it) => {
      const qty = safeNum(it.quantity) ?? 0;
      const analysis = analysisByProductId[it.productId];
      const isError = analysis && typeof analysis === "object" && "error" in (analysis as any) && !(analysis as any).totalIndustrialCost;

      if (!analysis || isError) {
        return {
          productId: it.productId,
          qty,
          mpUnit: null,
          hhUnit: null,
          hmUnit: null,
          baseUnit: null,
          baseTotal: null,
          mpTotal: null,
          hhTotal: null,
          hmTotal: null,
          warning: isError ? (analysis as any).message ?? "Não foi possível calcular MP/HH/HM do item." : "Análise pendente.",
          openBook: null,
        };
      }

      const mpUnit = safeNum((analysis as any).totalMaterialCost);
      const hhUnit = safeNum((analysis as any).totalHH_Unit);
      const hmUnit = safeNum((analysis as any).totalHM_Unit);
      const industrialUnit = safeNum((analysis as any).totalIndustrialCost);
      const baseUnit = mpUnit != null && hhUnit != null && hmUnit != null ? mpUnit + hhUnit + hmUnit : null;

      // Divergência: custo unitário gravado na linha vs motor (cost-analysis).
      // Não “conserta” nada, apenas sinaliza e continua usando o motor para MP/HH/HM por transparência.
      const unitCostLine = safeNum(it.unitCost);
      const warn =
        unitCostLine != null && industrialUnit != null && Math.abs(unitCostLine - industrialUnit) > 0.02
          ? `Divergência: unitCost da proposta (${moneyOrDash(unitCostLine, 5)}) difere do motor (${moneyOrDash(industrialUnit, 5)}).`
          : null;

      const mpTotal = mpUnit != null ? mpUnit * qty : null;
      const hhTotal = hhUnit != null ? hhUnit * qty : null;
      const hmTotal = hmUnit != null ? hmUnit * qty : null;
      const baseTotal = baseUnit != null ? baseUnit * qty : null;
      const openBook = openBookFromUnknown((analysis as any).openBook);

      return {
        productId: it.productId,
        qty,
        mpUnit,
        hhUnit,
        hmUnit,
        baseUnit,
        baseTotal,
        mpTotal,
        hhTotal,
        hmTotal,
        warning: warn,
        openBook,
      };
    });
  }, [items, analysisByProductId]);

  const coverage = useMemo(() => {
    const total = lineMetrics.length;
    const ok = lineMetrics.filter((m) => m.baseTotal != null).length;
    return { total, ok };
  }, [lineMetrics]);

  const totalsByNature = useMemo(() => {
    let mp = 0;
    let hh = 0;
    let hm = 0;
    for (const m of lineMetrics) {
      if (m.mpTotal != null) mp += m.mpTotal;
      if (m.hhTotal != null) hh += m.hhTotal;
      if (m.hmTotal != null) hm += m.hmTotal;
    }
    return {
      mp: coverage.ok > 0 ? mp : null,
      hh: coverage.ok > 0 ? hh : null,
      hm: coverage.ok > 0 ? hm : null,
      base: coverage.ok > 0 ? mp + hh + hm : null,
    };
  }, [lineMetrics, coverage.ok]);

  const net = safeNum(totals.totalNetValue);
  const marginPerc = safeNum(totals.totalMarginPerc);

  const compositionParts = useMemo(() => {
    const mp = totalsByNature.mp ?? 0;
    const hh = totalsByNature.hh ?? 0;
    const hm = totalsByNature.hm ?? 0;
    const taxes = safeNum(totals.totalTaxes) ?? 0;
    const comm = safeNum(totals.totalCommission) ?? 0;
    const freight = safeNum(totals.totalFreight) ?? 0;
    const margin = safeNum(totals.totalMarginValue) ?? 0;
    return [
      { key: "mp", label: "MP", value: mp, className: "bg-blue-600/80" },
      { key: "hh", label: "HH", value: hh, className: "bg-emerald-600/80" },
      { key: "hm", label: "HM", value: hm, className: "bg-indigo-600/80" },
      { key: "tax", label: "Impostos", value: taxes, className: "bg-orange-600/80" },
      { key: "comm", label: "Comissão", value: comm, className: "bg-fuchsia-600/70" },
      { key: "freight", label: "Frete", value: freight, className: "bg-slate-700/70" },
      { key: "margin", label: "Margem", value: margin, className: "bg-green-600/80" },
    ];
  }, [totalsByNature, totals.totalTaxes, totals.totalCommission, totals.totalFreight, totals.totalMarginValue]);

  const consolidatedRawMaterials = useMemo(
    () => buildProposalMaterialConsolidation(items, lineMetrics),
    [items, lineMetrics]
  );

  const topMaterials = consolidatedRawMaterials.rows.slice(0, 5);
  const isDetailed = mode === "detailed";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card/40 p-6 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary/80">Indicadores da proposta</p>
            <h3 className="text-xl font-bold tracking-tight mt-1">
              {proposalNumber ? `Proposta #${proposalNumber}` : "Proposta (rascunho)"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {proposalTitle && String(proposalTitle).trim() ? proposalTitle : "Leitura executiva e analítica baseada no motor de custo CIU."}
            </p>
          </div>
          <div className="text-xs text-muted-foreground text-right space-y-2">
            <p>Custos MP/HH/HM por item: `GET /api/products/:id/cost-analysis`</p>
            {!isDetailed && onOpenDetailed ? (
              <button
                type="button"
                onClick={onOpenDetailed}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                <Expand className="h-4 w-4" />
                Ver análise detalhada
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive mt-4">
            {error}
          </div>
        ) : null}

        {(coverage.total > 0 && coverage.ok < coverage.total) || loading ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
            {loading ? <Loader2 className="h-4 w-4 mt-0.5 animate-spin" /> : <ShieldAlert className="h-4 w-4 mt-0.5" />}
            <div className="space-y-1">
              <p className="font-semibold">Cobertura de MP/HH/HM</p>
              <p className="text-xs text-muted-foreground">
                {loading
                  ? "Calculando análise de custo por item..."
                  : `Parcial: ${coverage.ok}/${coverage.total} itens com breakdown MP/HH/HM. Itens sem dados exibem “—”.`}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard icon={BarChart3} label="Preço total (líquido)" value={moneyOrDash(net)} tone="primary" />
        <KpiCard
          icon={Layers}
          label="Custo base (MP+HH+HM)"
          value={moneyOrDash(totalsByNature.base)}
          sub={coverage.ok < coverage.total ? `Parcial (${coverage.ok}/${coverage.total})` : undefined}
        />
        <KpiCard icon={Package} label="MP total" value={moneyOrDash(totalsByNature.mp)} sub={coverage.ok < coverage.total ? "Parcial" : undefined} />
        <KpiCard icon={Package} label="HH total" value={moneyOrDash(totalsByNature.hh)} sub={coverage.ok < coverage.total ? "Parcial" : undefined} />
        <KpiCard icon={Package} label="HM total" value={moneyOrDash(totalsByNature.hm)} sub={coverage.ok < coverage.total ? "Parcial" : undefined} />
        <KpiCard icon={AlertCircle} label="Impostos" value={moneyOrDash(totals.totalTaxes)} />
        <KpiCard icon={AlertCircle} label="Margem (R$)" value={moneyOrDash(totals.totalMarginValue)} tone={safeNum(totals.totalMarginValue) != null && safeNum(totals.totalMarginValue)! >= 0 ? "green" : "red"} />
        <KpiCard icon={AlertCircle} label="Margem (%)" value={marginPerc == null ? "—" : `${numOrDash(marginPerc, 2)}%`} />
      </div>

      <StackedBar parts={compositionParts} total={net} />

      {!isDetailed ? (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-accent/30 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold tracking-tight">Matérias-primas mais relevantes</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Visão resumida da consolidação real por `materialId`. Abra o detalhamento para rastreabilidade por item.
              </p>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {consolidatedRawMaterials.rows.length} material(is) consolidado(s)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-accent/20 border-b border-border">
                  <th className="p-3 font-semibold">Matéria-prima</th>
                  <th className="p-3 font-semibold">Código</th>
                  <th className="p-3 font-semibold text-right">Qtd total</th>
                  <th className="p-3 font-semibold text-right">Valor total</th>
                  <th className="p-3 font-semibold text-right">% MP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topMaterials.map((row) => (
                  <tr key={row.materialId} className="hover:bg-accent/10 transition-colors">
                    <td className="p-3">
                      <p className="font-medium text-foreground">{row.description}</p>
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">{row.code ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums">{formatAdaptiveNumber(row.quantityTotal)}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">{formatAdaptiveCurrency(row.totalCost)}</td>
                    <td className="p-3 text-right tabular-nums">{row.pctOfMp == null ? "—" : `${formatAdaptiveNumber(row.pctOfMp)}%`}</td>
                  </tr>
                ))}
                {topMaterials.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-sm text-muted-foreground">
                      Não foi possível consolidar matérias-primas desta proposta com segurança a partir do open book disponível.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {consolidatedRawMaterials.rows.length > topMaterials.length ? (
            <div className="px-5 py-3 border-t border-border text-[11px] text-muted-foreground">
              Mostrando as 5 MPs mais relevantes. Use `Ver análise detalhada` para ver a consolidação completa e a rastreabilidade por item.
            </div>
          ) : null}
        </div>
      ) : null}

      {isDetailed ? (
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-accent/30 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold tracking-tight">Consolidação de matérias-primas</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Consolidado real por `materialId`, usando o open book do motor e somando a quantidade total consumida na proposta.
            </p>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Total MP consolidado: {moneyOrDash(consolidatedRawMaterials.totalMp)}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-accent/20 border-b border-border">
                <th className="p-3 font-semibold">Matéria-prima</th>
                <th className="p-3 font-semibold">Código</th>
                <th className="p-3 font-semibold">Unid.</th>
                <th className="p-3 font-semibold text-right">Qtd total</th>
                <th className="p-3 font-semibold text-right">Preço/kg</th>
                <th className="p-3 font-semibold text-right">Valor total</th>
                <th className="p-3 font-semibold text-right">% MP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {consolidatedRawMaterials.rows.map((row) => (
                <React.Fragment key={row.materialId}>
                  <tr className="hover:bg-accent/10 transition-colors align-top">
                    <td className="p-3">
                      <p className="font-medium text-foreground">{row.description}</p>
                      {row.missingPrice ? (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-200">
                          Preço efetivo indisponível para esta matéria-prima no open book desta proposta.
                        </p>
                      ) : null}
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">{row.code ?? "—"}</td>
                    <td className="p-3">{row.unit ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums">{formatAdaptiveNumber(row.quantityTotal)}</td>
                    <td className="p-3 text-right tabular-nums">{formatAdaptiveCurrency(row.unitCostEffective)}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">{formatAdaptiveCurrency(row.totalCost)}</td>
                    <td className="p-3 text-right tabular-nums">{row.pctOfMp == null ? "—" : `${formatAdaptiveNumber(row.pctOfMp)}%`}</td>
                  </tr>
                  {row.origins.length > 0 ? (
                    <tr className="bg-accent/5">
                      <td colSpan={7} className="px-3 pb-3 pt-0">
                        <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                            Origem na proposta
                          </p>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                            {row.origins.map((origin) => (
                              <div key={`${row.materialId}-${origin.itemIndex}-${origin.productId}`} className="rounded-lg border border-border bg-card px-3 py-2 text-[11px]">
                                <p className="font-semibold text-foreground">
                                  Item {String(origin.itemIndex + 1).padStart(2, "0")} · {origin.productName}
                                </p>
                                <p className="text-muted-foreground font-mono">
                                  {origin.productSku ?? origin.productId}
                                </p>
                                <p className="text-muted-foreground mt-1">
                                  Qtd proposta: <span className="font-semibold text-foreground">{formatAdaptiveNumber(origin.proposalQty)}</span>
                                  {" · "}
                                  Qtd material/un: <span className="font-semibold text-foreground">{formatAdaptiveNumber(origin.materialQty)}</span>
                                  {" · "}
                                  Qtd total: <span className="font-semibold text-foreground">{formatAdaptiveNumber(origin.quantityTotal)}</span>
                                  {" · "}
                                  Valor: <span className="font-semibold text-foreground">{formatAdaptiveCurrency(origin.totalCost)}</span>
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
              {consolidatedRawMaterials.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-sm text-muted-foreground">
                    Não foi possível consolidar matérias-primas desta proposta com segurança a partir do open book disponível.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}

      {isDetailed ? (
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-accent/30 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold tracking-tight">Detalhamento por item</h4>
            <p className="text-xs text-muted-foreground mt-1">
              MP/HH/HM vêm do motor de custo por produto. Impostos, margem e preço usam os campos da proposta.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-accent/20 border-b border-border">
                <th className="p-3 font-semibold">Item</th>
                <th className="p-3 font-semibold">Produto</th>
                <th className="p-3 font-semibold text-right">Qtd</th>
                <th className="p-3 font-semibold text-right">MP</th>
                <th className="p-3 font-semibold text-right">HH</th>
                <th className="p-3 font-semibold text-right">HM</th>
                <th className="p-3 font-semibold text-right">Custo base</th>
                <th className="p-3 font-semibold text-right">Impostos</th>
                <th className="p-3 font-semibold text-right">Margem</th>
                <th className="p-3 font-semibold text-right">Margem %</th>
                <th className="p-3 font-semibold text-right">Preço unit.</th>
                <th className="p-3 font-semibold text-right">Preço total</th>
                <th className="p-3 font-semibold text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it, idx) => {
                const qty = safeNum(it.quantity) ?? 0;
                const netLine = qty * (safeNum(it.negotiatedPrice) ?? 0) - (safeNum(it.discountValue) ?? 0);
                const mt = lineMetrics[idx];
                const showWarn = Boolean(mt?.warning);
                return (
                  <tr key={`${it.productId}-${idx}`} className="hover:bg-accent/10 transition-colors">
                    <td className="p-3 font-mono text-muted-foreground">{String(idx + 1).padStart(2, "0")}</td>
                    <td className="p-3">
                      <p className="font-medium text-foreground">{it.Product?.name ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{it.Product?.sku ?? it.productId}</p>
                      {showWarn ? (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-200">
                          {mt.warning}
                        </p>
                      ) : null}
                    </td>
                    <td className="p-3 text-right tabular-nums">{formatAdaptiveNumber(qty)}</td>
                    <td className="p-3 text-right tabular-nums">{moneyOrDash(mt.mpTotal)}</td>
                    <td className="p-3 text-right tabular-nums">{moneyOrDash(mt.hhTotal)}</td>
                    <td className="p-3 text-right tabular-nums">{moneyOrDash(mt.hmTotal)}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">{moneyOrDash(mt.baseTotal)}</td>
                    <td className="p-3 text-right tabular-nums">{moneyOrDash(it.taxesValue)}</td>
                    <td className="p-3 text-right tabular-nums">{moneyOrDash(it.marginValue)}</td>
                    <td className="p-3 text-right tabular-nums">{safeNum(it.marginPerc) == null ? "—" : `${formatAdaptiveNumber(it.marginPerc)}%`}</td>
                    <td className="p-3 text-right tabular-nums">{formatAdaptiveCurrency(it.negotiatedPrice)}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">{moneyOrDash(netLine)}</td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-xs"
                        onClick={() =>
                          setDrawer({
                            title: it.Product?.name ? `Detalhes — ${it.Product.name}` : "Detalhes do item",
                            productId: it.productId,
                            openBook: mt.openBook,
                          })
                        }
                      >
                        Detalhar
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-10 text-center text-sm text-muted-foreground">
                    Nenhum item na proposta. Os indicadores aparecerão quando houver itens.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}

      {isDetailed ? (
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-stretch justify-end" role="presentation">
            <motion.div
              initial={{ x: 420, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 420, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg bg-card border-l border-border shadow-2xl h-full flex flex-col"
              role="dialog"
              aria-modal="true"
            >
              <div className="p-4 border-b border-border flex items-center justify-between gap-3 bg-accent/30">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Drilldown</p>
                  <h3 className="text-base font-bold truncate">{drawer.title}</h3>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{drawer.productId}</p>
                </div>
                <button
                  type="button"
                  className="p-2 rounded-full hover:bg-accent transition-colors"
                  onClick={() => setDrawer(null)}
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {!drawer.openBook ? (
                  <div className="rounded-xl border border-border bg-accent/10 p-4 text-sm text-muted-foreground">
                    Detalhamento por componente/material ainda não está disponível para este item (open book ausente).
                  </div>
                ) : (
                  <>
                    {drawer.openBook.executive ? (
                      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Resumo (motor)</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">MP</span>
                            <span className="font-semibold tabular-nums">{formatAdaptiveCurrency(drawer.openBook.executive.totalMaterialCost)}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">HH</span>
                            <span className="font-semibold tabular-nums">{formatAdaptiveCurrency(drawer.openBook.executive.totalHH)}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">HM</span>
                            <span className="font-semibold tabular-nums">{formatAdaptiveCurrency(drawer.openBook.executive.totalHM)}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Base (MP+HH+HM)</span>
                            <span className="font-semibold tabular-nums">{formatAdaptiveCurrency(drawer.openBook.executive.totalIndustrialCost)}</span>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Percentuais: MP {formatAdaptiveNumber(drawer.openBook.executive.pctMp)}% · HH {formatAdaptiveNumber(drawer.openBook.executive.pctHh)}% · HM {formatAdaptiveNumber(drawer.openBook.executive.pctHm)}%
                        </p>
                      </div>
                    ) : null}

                    {Array.isArray(drawer.openBook.consolidatedMaterials) ? (
                      <div className="rounded-xl border border-border overflow-hidden">
                        <div className="px-4 py-3 border-b border-border bg-accent/30 flex items-center justify-between">
                          <h4 className="text-sm font-bold">Materiais consolidados (open book)</h4>
                          <span className="text-[10px] text-muted-foreground">
                            {drawer.openBook.explosionReconcilesMaterialTotal === true ? "Reconciliado" : "Não reconciliado"}
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-accent/20 border-b border-border">
                                <th className="p-3 font-semibold">Material</th>
                                <th className="p-3 font-semibold text-right">Custo</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {(drawer.openBook.consolidatedMaterials as any[]).slice(0, 30).map((row, i) => (
                                <tr key={i} className="hover:bg-accent/10">
                                  <td className="p-3">
                                    <p className="font-medium">{String((row as any).description ?? (row as any).code ?? "—")}</p>
                                  </td>
                                  <td className="p-3 text-right tabular-nums font-semibold">
                                    {formatAdaptiveCurrency((row as any).unitCostEffective ?? (row as any).unitCost ?? (row as any).totalCost)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="px-4 py-3 border-t border-border text-[10px] text-muted-foreground">
                          Mostrando até 30 itens (consolidação do open book por unidade).
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border bg-accent/10 p-4 text-sm text-muted-foreground">
                        Materiais consolidados indisponíveis (open book não retornou lista).
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      ) : null}
    </div>
  );
}

