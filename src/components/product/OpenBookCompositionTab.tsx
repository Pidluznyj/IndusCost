import React, { useMemo, useState } from "react";
import { AlertCircle, Info } from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { simulateIndustrialCost } from "@/src/lib/openBookMaterialExplosion";

export type OpenBookPayload = {
  executive?: {
    totalIndustrialCost: number;
    totalMaterialCost: number;
    totalHH: number;
    totalHM: number;
    pctMp: number;
    pctHh: number;
    pctHm: number;
    denominatorIndustrial: number;
  };
  consolidatedMaterials?: Array<{
    materialId: string;
    code: string;
    description: string;
    unit: string;
    quantity: number;
    totalCost: number;
    unitCostEffective: number;
    pctOfIndustrial: number;
    pctOfMp: number;
  }>;
  cifOpexInformational?: {
    totalCIF_Unit: number;
    totalOPEX_Unit: number;
  };
  explosionReconcilesMaterialTotal?: boolean;
  explosionMaterialSum?: number;
  error?: string;
  message?: string | null;
};

type Props = {
  loading: boolean;
  costAnalysisPartial?: boolean;
  openBook: OpenBookPayload | null | undefined;
};

export function OpenBookCompositionTab({ loading, costAnalysisPartial, openBook }: Props) {
  const [incMp, setIncMp] = useState("0");
  const [incHh, setIncHh] = useState("0");
  const [incHm, setIncHm] = useState("0");

  const exec = openBook?.executive;
  const sim = useMemo(() => {
    if (!exec) return null;
    return simulateIndustrialCost(
      exec.totalMaterialCost,
      exec.totalHH,
      exec.totalHM,
      parseFloat(incMp.replace(",", ".")) || 0,
      parseFloat(incHh.replace(",", ".")) || 0,
      parseFloat(incHm.replace(",", ".")) || 0
    );
  }, [exec, incMp, incHh, incHm]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground text-sm">
        Carregando composição de custos…
      </div>
    );
  }

  if (openBook?.error) {
    return (
      <div
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        role="alert"
      >
        <p className="font-semibold">Composição de custos indisponível</p>
        <p className="text-xs mt-1 opacity-90">{openBook.message ?? openBook.error}</p>
      </div>
    );
  }

  if (!exec) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        Não foi possível montar a visão Open Book. Verifique se a análise de custo foi carregada.
      </p>
    );
  }

  const rows = openBook?.consolidatedMaterials ?? [];
  const okReconcile = openBook?.explosionReconcilesMaterialTotal !== false;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {costAnalysisPartial && (
        <div
          className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100"
          role="status"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Cálculo parcial — a explosão de MP reflete apenas ramos custeados.
          </div>
        </div>
      )}

      {/* BLOCO A — Resumo executivo */}
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Resumo executivo (MP + HH + HM)
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Custo total (CIU)" value={formatCurrency(exec.totalIndustrialCost)} emphasis />
          <SummaryCard label="Matéria-prima" value={formatCurrency(exec.totalMaterialCost)} sub={`${formatNumber(exec.pctMp, 2)}% do total`} />
          <SummaryCard label="Mão de obra (HH)" value={formatCurrency(exec.totalHH)} sub={`${formatNumber(exec.pctHh, 2)}% do total`} />
          <SummaryCard label="Máquina (HM)" value={formatCurrency(exec.totalHM)} sub={`${formatNumber(exec.pctHm, 2)}% do total`} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Percentuais: valor da natureza ÷ (MP + HH + HM). CIF e OPEX não entram neste total.
        </p>
      </div>

      {/* CIF / OPEX — informativo */}
      {openBook?.cifOpexInformational && (
        <div className="rounded-xl border border-dashed border-border bg-accent/15 px-4 py-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground/80">Referência (não somados ao CIU): </span>
          CIF {formatCurrency(Number(openBook.cifOpexInformational.totalCIF_Unit ?? 0))} · OPEX{" "}
          {formatCurrency(Number(openBook.cifOpexInformational.totalOPEX_Unit ?? 0))}
        </div>
      )}

      {!okReconcile && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
          Atenção: soma da explosão de MP ({formatCurrency(openBook?.explosionMaterialSum ?? 0)}) difere do total de MP do
          motor ({formatCurrency(exec.totalMaterialCost)}) além da tolerância — revisar arredondamentos ou cadastro.
        </div>
      )}

      {/* BLOCO C — Natureza (rápido) */}
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Composição por natureza
        </h4>
        <div className="space-y-2 max-w-xl">
          <NatureBar label="MP" pct={exec.pctMp} className="bg-blue-500/80" />
          <NatureBar label="HH" pct={exec.pctHh} className="bg-violet-500/80" />
          <NatureBar label="HM" pct={exec.pctHm} className="bg-emerald-600/80" />
        </div>
      </div>

      {/* BLOCO B — Explosão MP */}
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Explosão consolidada de matérias-primas
        </h4>
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-accent/50 border-b border-border">
                  <th className="p-3 font-bold">Código</th>
                  <th className="p-3 font-bold">Descrição</th>
                  <th className="p-3 font-bold">Un.</th>
                  <th className="p-3 font-bold text-right">Qtd no item</th>
                  <th className="p-3 font-bold text-right">Custo un.</th>
                  <th className="p-3 font-bold text-right">Total MP</th>
                  <th className="p-3 font-bold text-right">% CIU</th>
                  <th className="p-3 font-bold text-right">% MP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">
                      Nenhuma matéria-prima na estrutura (apenas conversão / componentes sem MP registrada).
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.materialId} className="hover:bg-accent/20">
                      <td className="p-3 font-mono font-medium">{r.code}</td>
                      <td className="p-3 max-w-[220px] truncate" title={r.description}>
                        {r.description}
                      </td>
                      <td className="p-3">{r.unit}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(r.quantity, 4)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(r.unitCostEffective)}</td>
                      <td className="p-3 text-right font-semibold tabular-nums">{formatCurrency(r.totalCost)}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(r.pctOfIndustrial, 2)}%</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(r.pctOfMp, 2)}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Simulador */}
      <div className="rounded-xl border border-border bg-accent/10 p-6 space-y-4">
        <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Simulador de reajuste (% sobre cada natureza)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted-foreground">Aumento MP (%)</span>
            <input
              type="text"
              inputMode="decimal"
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={incMp}
              onChange={(e) => setIncMp(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted-foreground">Aumento HH (%)</span>
            <input
              type="text"
              inputMode="decimal"
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={incHh}
              onChange={(e) => setIncHh(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted-foreground">Aumento HM (%)</span>
            <input
              type="text"
              inputMode="decimal"
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={incHm}
              onChange={(e) => setIncHm(e.target.value)}
            />
          </label>
        </div>
        {sim && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-t border-border pt-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Novo custo projetado (CIU)</p>
              <p className="text-2xl font-black text-primary">{formatCurrency(sim.newTotal)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Impacto</p>
              <p>
                Δ R$ <span className="font-mono font-semibold">{formatCurrency(sim.deltaAbs)}</span> (
                {formatNumber(sim.deltaPct, 2)}% sobre o CIU atual)
              </p>
              <p className="text-[11px] text-muted-foreground">
                Antes: {formatCurrency(sim.baseTotal)} · Depois: MP {formatCurrency(sim.newMp)} + HH{" "}
                {formatCurrency(sim.newHh)} + HM {formatCurrency(sim.newHm)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 flex flex-col gap-1 min-h-[88px]",
        emphasis ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-lg font-black tabular-nums leading-tight">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function NatureBar({ label, pct, className }: { label: string; pct: number; className: string }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-8 font-bold">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-accent overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", className)} style={{ width: `${w}%` }} />
      </div>
      <span className="w-14 text-right tabular-nums font-semibold">{formatNumber(pct, 2)}%</span>
    </div>
  );
}
