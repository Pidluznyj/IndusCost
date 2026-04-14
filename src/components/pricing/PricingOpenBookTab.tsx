import React, { useMemo, useState } from "react";
import { AlertCircle, Info } from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import {
  simulatePricingOpenBookSensitivity,
  type PricingOpenBookPayload,
  type PricingPremissas,
} from "@/src/lib/pricingOpenBook";

type Props = {
  openBook: PricingOpenBookPayload | null | undefined;
  premissas: PricingPremissas;
};

export function PricingOpenBookTab({ openBook, premissas }: Props) {
  const [incMp, setIncMp] = useState("0");
  const [incHh, setIncHh] = useState("0");
  const [incHm, setIncHm] = useState("0");
  const executive = openBook?.executive;
  const rows = openBook?.consolidatedMaterials ?? [];

  const sim = useMemo(() => {
    if (!executive) return null;
    return simulatePricingOpenBookSensitivity(
      executive,
      premissas,
      parseFloat(incMp.replace(",", ".")) || 0,
      parseFloat(incHh.replace(",", ".")) || 0,
      parseFloat(incHm.replace(",", ".")) || 0
    );
  }, [executive, premissas, incMp, incHh, incHm]);

  if (openBook?.error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        <p className="font-semibold">Composição do preço indisponível</p>
        <p className="text-xs mt-1">{openBook.message ?? openBook.error}</p>
      </div>
    );
  }

  if (!executive) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        Sem dados suficientes para montar a composição do preço.
      </p>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Resumo executivo (base MP + HH + HM)
        </h4>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Custo Base Total" value={formatCurrency(executive.totalIndustrialCost, 5)} emphasis />
          <KpiCard
            label="Matéria-prima (MP)"
            value={formatCurrency(executive.totalMaterialCost, 5)}
            sub={`${formatNumber(executive.pctMp, 2)}%`}
          />
          <KpiCard
            label="Mão de obra (HH)"
            value={formatCurrency(executive.totalHH, 5)}
            sub={`${formatNumber(executive.pctHh, 2)}%`}
          />
          <KpiCard
            label="Máquina (HM)"
            value={formatCurrency(executive.totalHM, 5)}
            sub={`${formatNumber(executive.pctHm, 2)}%`}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Percentuais calculados sobre MP + HH + HM. CIF/OPEX ficam apenas como referência.
        </p>
      </div>

      <div className="space-y-2 max-w-xl">
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Composição percentual
        </h4>
        <NatureBar label="MP" pct={executive.pctMp} className="bg-blue-500/80" />
        <NatureBar label="HH" pct={executive.pctHh} className="bg-violet-500/80" />
        <NatureBar label="HM" pct={executive.pctHm} className="bg-emerald-500/80" />
      </div>

      <div>
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Detalhamento consolidado de matérias-primas
        </h4>
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-accent/40 border-b border-border">
                <tr>
                  <th className="p-3 font-bold">Código</th>
                  <th className="p-3 font-bold">Descrição</th>
                  <th className="p-3 font-bold">Un.</th>
                  <th className="p-3 font-bold text-right">Qtd total</th>
                  <th className="p-3 font-bold text-right">Custo un.</th>
                  <th className="p-3 font-bold text-right">Custo total MP</th>
                  <th className="p-3 font-bold text-right">% Custo base</th>
                  <th className="p-3 font-bold text-right">% Total MP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">
                      Nenhuma matéria-prima consolidada para este item.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.materialId} className="hover:bg-accent/20">
                      <td className="p-3 font-mono">{r.code}</td>
                      <td className="p-3">{r.description}</td>
                      <td className="p-3">{r.unit}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(r.quantity, 5)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(r.unitCostEffective, 5)}</td>
                      <td className="p-3 text-right font-semibold tabular-nums">{formatCurrency(r.totalCost, 5)}</td>
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

      {openBook?.cifOpexInformational && (
        <div className="rounded-xl border border-dashed border-border bg-accent/10 p-3 text-[11px] text-muted-foreground">
          Referência adicional (fora do custo base principal): CIF{" "}
          {formatCurrency(Number(openBook.cifOpexInformational.totalCIF_Unit ?? 0), 5)} · OPEX{" "}
          {formatCurrency(Number(openBook.cifOpexInformational.totalOPEX_Unit ?? 0), 5)}
        </div>
      )}

      {openBook?.explosionReconcilesMaterialTotal === false && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-[11px] text-amber-900 dark:text-amber-100 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          Soma da explosão de MP diverge do total de MP do motor além da tolerância.
        </div>
      )}

      <div className="rounded-2xl border border-border bg-accent/10 p-5 space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Sensibilidade no preço (impacto por natureza)
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <LabeledPercentInput label="Aumento MP (%)" value={incMp} onChange={setIncMp} />
          <LabeledPercentInput label="Aumento HH (%)" value={incHh} onChange={setIncHh} />
          <LabeledPercentInput label="Aumento HM (%)" value={incHm} onChange={setIncHm} />
        </div>
        {sim && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-t border-border pt-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Custo base projetado</p>
              <p className="text-xl font-black text-primary">{formatCurrency(sim.newTotal, 5)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Impacto custo: {formatCurrency(sim.deltaAbs, 5)} ({formatNumber(sim.deltaPct, 2)}%)
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Preço sugerido projetado</p>
              <p className="text-xl font-black text-primary">{formatCurrency(sim.suggestedPriceProjected, 5)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Impacto preço: {formatCurrency(sim.suggestedDeltaAbs, 5)} ({formatNumber(sim.suggestedDeltaPct, 2)}%)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
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
    <div className={cn("rounded-xl border p-4 bg-card", emphasis ? "border-primary/40 bg-primary/5" : "border-border")}>
      <p className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">{label}</p>
      <p className="text-lg font-black tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function NatureBar({ label, pct, className }: { label: string; pct: number; className: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 text-xs font-bold">{label}</span>
      <div className="h-2.5 flex-1 bg-accent rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", className)} style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs font-semibold w-14 text-right tabular-nums">{formatNumber(pct, 2)}%</span>
    </div>
  );
}

function LabeledPercentInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="font-semibold text-muted-foreground">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-2 rounded-lg border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}
