import React from "react";
import { Info } from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import type { PricingUnitCalculationBreakdown } from "@/src/lib/pricingUnitCalculationBreakdown";

type Props = {
  breakdown: PricingUnitCalculationBreakdown | null | undefined;
};

function pct(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return "Não informado";
  return `${formatNumber(v, decimals)}%`;
}

function brl(v: number | null | undefined, decimals = 5): string {
  if (v == null || !Number.isFinite(v)) return "Não informado";
  return formatCurrency(v, decimals);
}

function txt(v: string | null | undefined, fallback = "Não informado"): string {
  if (v == null || String(v).trim() === "") return fallback;
  return String(v);
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", className)}>
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-3">{title}</h4>
      {children}
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-border/60 last:border-0">
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold text-right tabular-nums">{value}</span>
      </div>
      {sub ? <p className="text-[10px] text-muted-foreground leading-snug">{sub}</p> : null}
    </div>
  );
}

export function PricingDetailedCompositionTab({ breakdown }: Props) {
  if (!breakdown) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-950">
        <p className="font-semibold">Composição detalhada indisponível</p>
        <p className="text-xs mt-1">Não encontrado no cálculo — atualize o sistema ou refaça a simulação.</p>
      </div>
    );
  }

  const b = breakdown;
  const d = b.deductions;
  const raw = b.rawMaterials;
  const tm = b.transformationMemory;

  const bridgeSum = b.priceBridge.lines.reduce((a, l) => a + l.amount, 0);
  const bridgeOk =
    b.priceBridge.suggestedPrice != null &&
    Number.isFinite(bridgeSum) &&
    Math.abs(bridgeSum - b.priceBridge.suggestedPrice) < 0.02;

  const lineTypeLabel = (t: string) =>
    t === "MATERIAL" ? "Material" : t === "COMPONENT" ? "Componente" : "—";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Composição Detalhada do Preço</h3>
        <p className="text-xs text-muted-foreground mt-1">{b.methodologyShortNote}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Custo base (industrial)">
          <Row label="Matéria-prima (MP)" value={brl(b.baseCost.rawMaterialCost)} />
          <Row label="HH — mão de obra" value={brl(b.baseCost.laborCostHH)} sub={b.helpTexts.hh} />
          <Row label="HM — máquina" value={brl(b.baseCost.machineCostHM)} sub={b.helpTexts.hm} />
          <Row
            label="Setup rateado (soma das operações)"
            value={b.baseCost.setupCostAllocated != null ? brl(b.baseCost.setupCostAllocated) : "Não aplicado"}
          />
          <Row
            label="Subtotal transformação (HH + HM)"
            value={brl(b.baseCost.transformationSubtotalHHPlusHM)}
          />
          <Row label="Total CIU (MP + HH + HM)" value={brl(b.baseCost.industrialCostCIU)} />
          <Row label="CIF (informativo / hora)" value={brl(b.baseCost.cifPerUnit)} sub="Não embutido no CIU deste cálculo." />
          <Row label="OPEX (informativo / hora)" value={brl(b.baseCost.opexPerUnit)} />
          <Row label="Custo gerencial (CIU + OPEX)" value={brl(b.baseCost.managerialCostTotal)} />
        </Card>

        <Card title="Deduções sobre a venda">
          <Row
            label={`Impostos (${pct(d.taxes.percentageOnSale)})`}
            value={brl(d.taxes.amountOnSale)}
            sub={`Regra: ${txt(d.taxes.ruleName)} · ${d.taxes.source}`}
          />
          <Row label={`Comissão (${pct(d.commission.percentageOnSale)})`} value={brl(d.commission.amountOnSale)} />
          <Row label={`Outras variáveis (${pct(d.otherVariables.percentageOnSale)})`} value={brl(d.otherVariables.amountOnSale)} />
          <Row label="Frete de saída (fixo / unid.)" value={brl(d.freight.amount)} sub="Valor em R$ no numerador da fórmula." />
          <Row
            label="Soma das parcelas % sobre o preço + margem desejada"
            value={d.totalVariableOnSale != null ? brl(d.totalVariableOnSale) : "Não informado"}
            sub={`Soma das taxas sobre PV: ${pct(d.totalRatesOnSale)}`}
          />
        </Card>

        <Card title="Margem e markup">
          <Row
            label={`Margem desejada (${pct(b.margin.targetPercentageOnSale)}) sobre o preço`}
            value={brl(b.margin.amountOnSale)}
            sub={b.helpTexts.margin}
          />
          <Row
            label="Markup (preço ÷ CIU)"
            value={b.markup.priceOverIndustrialCost != null ? `${formatNumber(b.markup.priceOverIndustrialCost, 4)}×` : "Não informado"}
            sub={b.helpTexts.markup}
          />
          <Row
            label="Fator sobre (CIU + frete)"
            value={b.markup.factorOnCostPlusFreight != null ? `${formatNumber(b.markup.factorOnCostPlusFreight, 4)}×` : "Não informado"}
            sub={b.markup.formulaText}
          />
          <Row
            label="Divisor (1 − i − c − o − m)"
            value={b.markup.divisor != null ? formatNumber(b.markup.divisor, 6) : "Não informado"}
          />
        </Card>

        <Card title="Preço final">
          <Row label="Preço sugerido" value={brl(b.finalPrice.suggestedPrice)} />
          <Row label="Margem de contribuição" value={brl(b.finalPrice.contributionMargin)} />
          <Row label="Margem operacional" value={brl(b.finalPrice.operationalMargin)} />
        </Card>
      </div>

      <Card title="Como chegamos no preço (ponte auditável)" className="bg-primary/5 border-primary/20">
        <p className="text-xs text-muted-foreground mb-3">{b.priceBridge.explanation}</p>
        <div className="rounded-lg bg-background/80 border border-border p-3 space-y-2 font-mono text-xs">
          {b.priceBridge.lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink">{line.label}</span>
              <span className="tabular-nums font-semibold">{brl(line.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between gap-2 pt-2 border-t border-border font-bold text-sm">
            <span>= Preço sugerido</span>
            <span className="tabular-nums text-primary">{brl(b.priceBridge.suggestedPrice)}</span>
          </div>
        </div>
        {!bridgeOk ? (
          <p className="text-[10px] text-muted-foreground mt-2 flex items-start gap-1">
            <Info className="h-3.5 w-3.5 shrink-0" />
            A soma linear acima é a identidade do modelo divisor; pequenas diferenças podem aparecer por arredondamento.
          </p>
        ) : null}
      </Card>

      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
          Detalhamento da matéria-prima / componentes
        </h4>
        {!raw || raw.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4">
            Não há detalhamento consolidado de matéria-prima para exibir. Quando a explosão de MP estiver disponível, a
            tabela será preenchida automaticamente.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs min-w-[640px]">
              <thead className="bg-muted/80">
                <tr>
                  <th className="p-2 font-semibold">SKU</th>
                  <th className="p-2 font-semibold">Descrição</th>
                  <th className="p-2 font-semibold">Tipo</th>
                  <th className="p-2 font-semibold text-right">Qtd / unid.</th>
                  <th className="p-2 font-semibold">Un.</th>
                  <th className="p-2 font-semibold text-right">Custo unit.</th>
                  <th className="p-2 font-semibold text-right">Total</th>
                  <th className="p-2 font-semibold">Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {raw.map((r, i) => (
                  <tr key={`${r.sku ?? ""}-${i}`} className="hover:bg-accent/30">
                    <td className="p-2 font-mono">{txt(r.sku, "—")}</td>
                    <td className="p-2 max-w-[220px]">{txt(r.description)}</td>
                    <td className="p-2">{lineTypeLabel(r.lineType)}</td>
                    <td className="p-2 text-right tabular-nums">{r.quantityPerUnit != null ? formatNumber(r.quantityPerUnit, 4) : "—"}</td>
                    <td className="p-2">{txt(r.unit, "—")}</td>
                    <td className="p-2 text-right tabular-nums">{brl(r.unitCost)}</td>
                    <td className="p-2 text-right tabular-nums font-medium">{brl(r.lineTotalCost)}</td>
                    <td className="p-2 text-muted-foreground max-w-[180px]">{txt(r.originNote, "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
          Memória de cálculo de transformação
        </h4>
        {!tm || tm.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4">
            Não encontrado no cálculo — sem roteiro ou processo padrão detalhado nesta resposta.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-[11px] min-w-[960px]">
              <thead className="bg-muted/80">
                <tr>
                  <th className="p-2 font-semibold">Operação</th>
                  <th className="p-2 font-semibold">Origem</th>
                  <th className="p-2 font-semibold text-right">Ciclo (s)</th>
                  <th className="p-2 font-semibold text-right">Cav.</th>
                  <th className="p-2 font-semibold text-right">Efic. %</th>
                  <th className="p-2 font-semibold text-right">Pç/h</th>
                  <th className="p-2 font-semibold text-right">HH R$/h</th>
                  <th className="p-2 font-semibold text-right">HM R$/h</th>
                  <th className="p-2 font-semibold text-right">Cél. R$/h</th>
                  <th className="p-2 font-semibold text-right">HH un.</th>
                  <th className="p-2 font-semibold text-right">HM un.</th>
                  <th className="p-2 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tm.map((row, i) => (
                  <tr key={`${row.operation ?? i}`} className="align-top hover:bg-accent/30">
                    <td className="p-2 max-w-[200px]">{txt(row.operation)}</td>
                    <td className="p-2 max-w-[160px] text-muted-foreground">{txt(row.sourceLabel, txt(row.source))}</td>
                    <td className="p-2 text-right tabular-nums">{row.cycleTimeSeconds != null ? formatNumber(row.cycleTimeSeconds, 2) : "—"}</td>
                    <td className="p-2 text-right tabular-nums">{row.cavities != null ? formatNumber(row.cavities, 2) : "—"}</td>
                    <td className="p-2 text-right tabular-nums">{row.efficiencyExpectedPct != null ? formatNumber(row.efficiencyExpectedPct, 2) : "—"}</td>
                    <td className="p-2 text-right tabular-nums">{row.netPartsPerHour != null ? formatNumber(row.netPartsPerHour, 4) : "—"}</td>
                    <td className="p-2 text-right tabular-nums">{brl(row.hhCostPerHour)}</td>
                    <td className="p-2 text-right tabular-nums">{brl(row.machineHourCostPerHour)}</td>
                    <td className="p-2 text-right tabular-nums">{brl(row.cellCostPerHour)}</td>
                    <td className="p-2 text-right tabular-nums">{brl(row.unitLaborCost)}</td>
                    <td className="p-2 text-right tabular-nums">{brl(row.unitMachineCost)}</td>
                    <td className="p-2 text-right tabular-nums font-medium">{brl(row.unitTotalTransform)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tm.some((x) => x.friendlyHmNote) ? (
              <div className="p-3 text-[10px] text-muted-foreground border-t border-border space-y-1">
                {tm.map(
                  (row, i) =>
                    row.friendlyHmNote && (
                      <p key={`n-${i}`}>
                        <span className="font-semibold text-foreground">{txt(row.operation, "Op.")}: </span>
                        {row.friendlyHmNote}
                      </p>
                    )
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
