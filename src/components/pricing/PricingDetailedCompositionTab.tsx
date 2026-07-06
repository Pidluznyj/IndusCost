import React from "react";
import { ChevronDown, Info } from "lucide-react";
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

function n(v: number | null | undefined): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function ExecSummaryCard({
  title,
  value,
  hint,
  emphasis,
}: {
  title: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5 flex flex-col justify-between min-h-[140px] shadow-sm",
        emphasis
          ? "border-primary/40 bg-gradient-to-br from-primary/12 to-primary/5"
          : "border-border bg-card"
      )}
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className={cn("text-2xl sm:text-[1.65rem] font-bold tabular-nums mt-2 tracking-tight", emphasis && "text-primary")}>
          {value}
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed mt-3">{hint}</p>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-bold tracking-tight text-foreground">{title}</h3>
      {subtitle ? <p className="text-xs text-muted-foreground mt-1">{subtitle}</p> : null}
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

function Collapsible({
  title,
  defaultOpen = false,
  children,
  variant = "default",
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  variant?: "default" | "muted";
}) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        "rounded-xl border group",
        variant === "muted" ? "border-border/80 bg-muted/20" : "border-border bg-card"
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-foreground hover:bg-accent/40 rounded-xl [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/60 px-4 py-3 text-sm">{children}</div>
    </details>
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

  const costProduce = b.baseCost.industrialCostCIU;
  const freightAmt = d.freight.amount;
  const taxAmt = d.taxes.amountOnSale;
  const commAmt = d.commission.amountOnSale;
  const otherAmt = d.otherVariables.amountOnSale;
  const marginAmt = b.margin.amountOnSale;
  const suggested = b.finalPrice.suggestedPrice ?? b.priceBridge.suggestedPrice;

  const bridgeRows = [
    { label: "Custo para produzir o produto", amount: costProduce },
    { label: "Frete considerado no preço", amount: freightAmt },
    { label: "Impostos sobre a venda", amount: taxAmt },
    { label: "Comissão de venda", amount: commAmt },
    { label: "Outras deduções", amount: otherAmt },
    { label: "Margem desejada", amount: marginAmt },
  ];

  const bridgeSum = bridgeRows.reduce((a, r) => a + n(r.amount), 0);
  const bridgeOk =
    suggested != null && Number.isFinite(suggested) && Number.isFinite(bridgeSum) && Math.abs(bridgeSum - suggested) < 0.02;

  const taxPct = d.taxes.percentageOnSale;
  const hasTaxPct = taxPct != null && Number.isFinite(taxPct) && taxPct > 0;

  const extrasSum = n(commAmt) + n(freightAmt) + n(otherAmt);
  const hasExtras = extrasSum > 1e-9;

  const lineTypeLabel = (t: string) =>
    t === "MATERIAL" ? "Material" : t === "COMPONENT" ? "Componente" : "—";

  const factorOnIndustrial = b.markup.priceOverIndustrialCost;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Composição detalhada do preço</h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Esta visão mostra, de forma simples, como o preço sugerido foi formado: primeiro o sistema identifica o custo
          para produzir, depois considera impostos e deduções da venda, aplica a margem desejada e calcula o preço
          necessário para a conta fechar.
        </p>
      </div>

      {/* 1. Resumo simples */}
      <section>
        <SectionTitle title="Resumo simples da formação de preço" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <ExecSummaryCard
            title="Custo para produzir"
            value={brl(costProduce)}
            hint="É quanto este produto custa para ser fabricado antes de impostos e margem. Inclui matéria-prima, mão de obra e máquina."
          />
          <ExecSummaryCard
            title="Impostos sobre a venda"
            value={`${pct(taxPct)} = ${brl(taxAmt)}`}
            hint="Esse valor sai do preço de venda e não fica para a empresa."
          />
          <ExecSummaryCard
            title="Margem desejada"
            value={`${pct(b.margin.targetPercentageOnSale)} = ${brl(marginAmt)}`}
            hint="É o valor planejado para resultado da venda após cobrir custo e deduções."
          />
          <ExecSummaryCard
            title="Preço sugerido"
            value={brl(suggested)}
            hint="Preço necessário para cobrir custos, impostos e atingir a margem definida."
            emphasis
          />
        </div>
      </section>

      {hasTaxPct ? (
        <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 dark:bg-sky-950/25 dark:border-sky-800/60 px-4 py-3 text-xs text-sky-950 dark:text-sky-100 flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />
          <p>
            <span className="font-semibold">Importante:</span> o imposto é calculado sobre o preço de venda, não sobre o
            custo. Por isso ele entra na formação do preço junto com a margem.
          </p>
        </div>
      ) : null}

      {/* 2. Como chegamos no preço */}
      <section>
        <SectionTitle title="Como chegamos no preço" subtitle="Veja a abertura simples do preço sugerido." />
        <div className="rounded-xl border border-border bg-muted/15 p-4 sm:p-5">
          <div className="space-y-2.5 text-sm">
            {bridgeRows.map((row, idx) => (
              <div key={row.label} className="flex justify-between gap-3 items-baseline">
                <span className="text-muted-foreground shrink">
                  {idx === 0 ? row.label : `+ ${row.label}`}
                </span>
                <span className="font-semibold tabular-nums text-right">{brl(row.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 pt-3 mt-1 border-t border-border font-bold text-base">
              <span>= Preço sugerido</span>
              <span className="tabular-nums text-primary">{brl(suggested)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            O preço sugerido é calculado para que, depois de pagar impostos e cobrir o custo do produto, ainda sobre a
            margem desejada.
          </p>
          {!bridgeOk ? (
            <p className="text-[10px] text-muted-foreground mt-2 flex items-start gap-1">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Pequenas diferenças de centavos podem aparecer por arredondamento; os valores seguem o cálculo oficial do
              sistema.
            </p>
          ) : null}
        </div>
      </section>

      {/* 3. O que esse preço significa */}
      <section>
        <SectionTitle title="O que esse preço significa?" />
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3 text-sm leading-relaxed">
          <p className="font-medium text-foreground">Vendendo por {brl(suggested)}:</p>
          <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
            <li>
              <span className="text-foreground font-medium">{brl(costProduce)}</span> cobre o custo de produção.
            </li>
            <li>
              <span className="text-foreground font-medium">{brl(taxAmt)}</span> vai para impostos.
            </li>
            <li>
              <span className="text-foreground font-medium">{brl(marginAmt)}</span> representa a margem planejada.
            </li>
          </ul>
          {hasExtras ? (
            <p className="text-muted-foreground pl-5 sm:pl-0 text-sm">
              Além disso, nesta simulação: <span className="font-medium text-foreground">{brl(commAmt)}</span> em comissão,{" "}
              <span className="font-medium text-foreground">{brl(freightAmt)}</span> em frete e{" "}
              <span className="font-medium text-foreground">{brl(otherAmt)}</span> em outras deduções.
            </p>
          ) : (
            <p className="text-sm text-foreground/90">
              Não há comissão, frete ou outras deduções consideradas nesta simulação (ou os valores são R$ 0,00).
            </p>
          )}
          <p className="text-foreground pt-1">
            Isso significa que a margem desejada é de{" "}
            <span className="font-semibold">{pct(b.margin.targetPercentageOnSale)}</span> sobre o preço de venda.
          </p>
        </div>
      </section>

      {/* 4. Composição do custo */}
      <section>
        <SectionTitle title="Do que é feito o custo do produto?" />
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
          <Row
            label="Matéria-prima"
            value={brl(b.baseCost.rawMaterialCost)}
            sub="Valor dos materiais e componentes consumidos para fabricar uma unidade."
          />
          <Row
            label="Mão de obra (HH)"
            value={brl(b.baseCost.laborCostHH)}
            sub="Custo da hora homem aplicado ao processo produtivo."
          />
          <Row
            label="Máquina (HM)"
            value={brl(b.baseCost.machineCostHM)}
            sub="Custo da hora máquina aplicado ao processo produtivo."
          />
          <Row
            label="Setup rateado"
            value={b.baseCost.setupCostAllocated != null && n(b.baseCost.setupCostAllocated) > 0 ? brl(b.baseCost.setupCostAllocated) : "Não aplicado"}
            sub={
              b.baseCost.setupCostAllocated != null && n(b.baseCost.setupCostAllocated) > 0
                ? "Parte do tempo de preparação rateada por unidade, quando informada no processo."
                : "Não considerado neste cálculo ou valor zerado."
            }
          />
          <p className="text-[11px] text-muted-foreground border-t border-border pt-3">
            Outros custos (CIF e OPEX) aparecem apenas na seção técnica abaixo; a base do preço usa o custo industrial
            acima.
          </p>
          <div className="rounded-lg bg-primary/5 border border-primary/15 px-4 py-3">
            <Row
              label="Total para produzir"
              value={brl(b.baseCost.industrialCostCIU)}
              sub="Soma dos custos usados como base para formar o preço (antes de impostos e margem)."
            />
          </div>
        </div>
      </section>

      {/* 5. Deduções sobre a venda */}
      <section>
        <SectionTitle title="Deduções da venda" subtitle="O que reduz o resultado sobre o preço praticado." />
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-1">
          <Row
            label={`Impostos (${pct(d.taxes.percentageOnSale)})`}
            value={brl(d.taxes.amountOnSale)}
            sub="Percentual aplicado sobre o preço de venda."
          />
          <Row
            label={`Comissão (${pct(d.commission.percentageOnSale)})`}
            value={brl(d.commission.amountOnSale)}
            sub="Comissão comercial considerada na simulação."
          />
          <Row label="Frete" value={brl(d.freight.amount)} sub="Frete considerado diretamente no preço, quando aplicável." />
          <Row
            label={`Outras deduções (${pct(d.otherVariables.percentageOnSale)})`}
            value={brl(d.otherVariables.amountOnSale)}
            sub="Outros percentuais que reduzem o resultado da venda, conforme premissa."
          />
        </div>
        <div className="mt-4 rounded-xl border border-dashed border-border/80 bg-muted/10 p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">Parte do preço destinada a impostos, deduções e margem</p>
          <p>
            {d.totalRatesOnSale != null && Number.isFinite(d.totalRatesOnSale) ? (
              <>
                Somando impostos, comissão, outras deduções percentuais e margem desejada,{" "}
                <span className="font-semibold text-foreground">{pct(d.totalRatesOnSale)}</span> do preço de venda está
                comprometido com esses itens. O restante precisa cobrir o custo para produzir e o frete considerado.
              </>
            ) : (
              "Não informado — não foi possível exibir o percentual total comprometido."
            )}
          </p>
          {d.totalVariableOnSale != null && Number.isFinite(d.totalVariableOnSale) ? (
            <p className="text-xs mt-2">
              Em valores: <span className="font-medium text-foreground">{brl(d.totalVariableOnSale)}</span> corresponde à
              soma das parcelas sobre o preço (impostos, comissão, outras deduções e margem desejada).
            </p>
          ) : null}
        </div>
      </section>

      {/* 6. Margem e fator */}
      <section>
        <SectionTitle title="Margem e fator de formação" subtitle="Como o custo se relaciona com o preço final." />
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
          <Row
            label="Margem desejada"
            value={`${pct(b.margin.targetPercentageOnSale)} → ${brl(b.margin.amountOnSale)}`}
            sub="Planejada sobre o preço de venda."
          />
          <Row
            label="Fator de formação do preço (preço ÷ custo de produção)"
            value={factorOnIndustrial != null ? `${formatNumber(factorOnIndustrial, 4)}×` : "Não informado"}
            sub="O fator mostra quantas vezes o custo de produção precisa ser multiplicado para chegar ao preço sugerido, considerando impostos, deduções e margem."
          />
          {factorOnIndustrial != null && Number.isFinite(factorOnIndustrial) ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Para este produto, o custo de produção foi multiplicado por aproximadamente{" "}
              <span className="font-semibold text-foreground">{formatNumber(factorOnIndustrial, 4)}</span> para chegar ao
              preço sugerido.
            </p>
          ) : null}
          <Collapsible title="Ver fórmula técnica" variant="muted">
            <p className="text-xs font-mono text-muted-foreground leading-relaxed break-words">
              PV = (CIU + frete fixo) ÷ (1 − impostos% − comissão% − outros% − margem%)
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">
              Os percentuais são sempre sobre o preço de venda (PV), exceto o frete fixo, que entra no numerador junto com
              o custo industrial (CIU).
            </p>
          </Collapsible>
          <Collapsible title="Ver detalhes de margem de contribuição e operacional" variant="muted">
            <Row label="Margem de contribuição" value={brl(b.finalPrice.contributionMargin)} />
            <Row label="Margem operacional" value={brl(b.finalPrice.operationalMargin)} />
          </Collapsible>
        </div>
      </section>

      {/* 7. Detalhes técnicos */}
      <section>
        <SectionTitle title="Detalhes técnicos do cálculo" subtitle="Para auditoria e equipe técnica." />
        <Collapsible title="Abrir detalhes técnicos do cálculo" defaultOpen={false}>
          <div className="space-y-4 text-xs text-muted-foreground">
            <p>{b.methodologyShortNote}</p>
            <div className="rounded-lg border border-border/80 p-3 space-y-1 bg-background/50">
              <p>
                <span className="font-semibold text-foreground">CIU (custo industrial unitário):</span>{" "}
                {brl(b.baseCost.industrialCostCIU)} — MP + HH + HM.
              </p>
              <p>
                <span className="font-semibold text-foreground">CIF (referência):</span> {brl(b.baseCost.cifPerUnit)}
              </p>
              <p>
                <span className="font-semibold text-foreground">OPEX (referência):</span> {brl(b.baseCost.opexPerUnit)}
              </p>
              <p>
                <span className="font-semibold text-foreground">Custo gerencial (CIU + OPEX):</span>{" "}
                {brl(b.baseCost.managerialCostTotal)}
              </p>
            </div>
            <div className="rounded-lg border border-border/80 p-3 space-y-1 bg-background/50">
              <p>
                <span className="font-semibold text-foreground">Divisor:</span>{" "}
                {b.markup.divisor != null ? formatNumber(b.markup.divisor, 6) : "Não informado"}
              </p>
              <p>
                <span className="font-semibold text-foreground">Fator sobre (custo + frete):</span>{" "}
                {b.markup.factorOnCostPlusFreight != null ? `${formatNumber(b.markup.factorOnCostPlusFreight, 4)}×` : "Não informado"}
              </p>
              <p className="italic">{b.markup.formulaText}</p>
            </div>
            <p>
              <span className="font-semibold text-foreground">Regra tributária:</span> {txt(d.taxes.ruleName, "Não informado")}{" "}
              <span className="opacity-70">({txt(d.taxes.source, "")})</span>
            </p>
            <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2">
              <p className="font-semibold text-foreground text-xs">Textos técnicos de apoio (HH / HM / margem / markup)</p>
              <p>{b.helpTexts.hh}</p>
              <p>{b.helpTexts.hm}</p>
              <p>{b.helpTexts.margin}</p>
              <p>{b.helpTexts.markup}</p>
            </div>

            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-foreground mb-2">
                Detalhamento da matéria-prima / componentes
              </h4>
              {!raw || raw.length === 0 ? (
                <p className="text-sm py-3">
                  Não há detalhamento consolidado de matéria-prima para exibir. Quando a explosão de MP estiver disponível,
                  a tabela será preenchida automaticamente.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-[11px] min-w-[640px]">
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
                          <td className="p-2 text-right tabular-nums">
                            {r.quantityPerUnit != null ? formatNumber(r.quantityPerUnit, 4) : "—"}
                          </td>
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
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-foreground mb-2">
                Memória de cálculo de transformação
              </h4>
              {!tm || tm.length === 0 ? (
                <p className="text-sm py-3">
                  Não encontrado no cálculo — sem roteiro ou processo padrão detalhado nesta resposta.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-[10px] min-w-[960px]">
                    <thead className="bg-muted/80">
                      <tr>
                        <th className="p-2 font-semibold">Operação</th>
                        <th className="p-2 font-semibold">Origem</th>
                        <th className="p-2 font-semibold text-right">Ciclo (s)</th>
                        <th className="p-2 font-semibold text-right">Cav.</th>
                        <th className="p-2 font-semibold text-right">Efic. %</th>
                        <th className="p-2 font-semibold text-right">Peças/h</th>
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
                          <td className="p-2 max-w-[160px]">{txt(row.sourceLabel, txt(row.source))}</td>
                          <td className="p-2 text-right tabular-nums">
                            {row.cycleTimeSeconds != null ? formatNumber(row.cycleTimeSeconds, 2) : "—"}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {row.cavities != null ? formatNumber(row.cavities, 2) : "—"}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {row.efficiencyExpectedPct != null ? formatNumber(row.efficiencyExpectedPct, 2) : "—"}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {row.netPartsPerHour != null ? formatNumber(row.netPartsPerHour, 4) : "—"}
                          </td>
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
                    <div className="p-3 text-[10px] border-t border-border space-y-1">
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
        </Collapsible>
      </section>
    </div>
  );
}
