/**
 * LIKE SERASA › "C · Comportamento de pagamento": como a empresa paga e toma crédito no mercado, mês a mês,
 * segundo a Boa Vista. Os números ficam na escala do provedor (o retorno não documenta a unidade); a tela só os
 * organiza: o que cada indicador quer dizer, o último mês em destaque, a série de 12 meses num gráfico pequeno e a
 * tendência. Atrasos viram um resumo (ou uma tabela, só quando houve atraso).
 */
import React from "react";
import { CheckCircle2, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { BoaVistaMonthlyPoint, BoaVistaSections } from "@/src/lib/boaVistaDefineLimite/parse";
import { cn } from "@/src/lib/utils";

type Behavior = BoaVistaSections["financialBehavior"];
type Revenue = BoaVistaSections["revenue"];

/** Número do provedor ("2.601", "0,9", "100") ou null quando o mês não veio. */
export function providerNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw === "—" || raw === "-") return null;
  const normalized = /,\d+$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const monthLabel = (period: string | null | undefined) => (period ? period.toLowerCase().replace(/^(\w)/, (c) => c.toUpperCase()) : "?");

/** Tendência: média dos 3 últimos meses com dado contra a dos 3 anteriores (±5% = estável). */
export function trendOf(points: BoaVistaMonthlyPoint[]): "up" | "down" | "flat" | null {
  const values = points.map((p) => providerNumber(p.value)).filter((n): n is number => n != null);
  if (values.length < 4) return null;
  const last = values.slice(-3);
  const prev = values.slice(-6, -3);
  if (prev.length === 0) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = avg(prev);
  const b = avg(last);
  if (a === 0 && b === 0) return "flat";
  const delta = a === 0 ? 1 : (b - a) / Math.abs(a);
  return Math.abs(delta) <= 0.05 ? "flat" : delta > 0 ? "up" : "down";
}

function MiniBars({ points, testId }: { points: BoaVistaMonthlyPoint[]; testId?: string }) {
  const values = points.map((p) => providerNumber(p.value));
  const max = Math.max(0, ...values.filter((v): v is number => v != null));
  return (
    <div className="mt-2" data-testid={testId}>
      <div className="flex h-12 items-end gap-[3px]" role="img" aria-label={points.map((p, i) => `${monthLabel(p.period)}: ${fmt(values[i] ?? null)}`).join("; ")}>
        {points.map((point, i) => {
          const v = values[i];
          const height = v == null ? 0 : max > 0 ? Math.max(6, Math.round((v / max) * 100)) : 6;
          return (
            <div key={`${point.period}-${i}`} className="group relative flex h-full flex-1 items-end" title={`${monthLabel(point.period)}: ${fmt(v ?? null)}`}>
              {v == null ? (
                <div className="h-[3px] w-full rounded-sm bg-slate-200" />
              ) : (
                <div className={cn("w-full rounded-sm", i === points.length - 1 ? "bg-indigo-600" : "bg-indigo-300")} style={{ height: `${height}%` }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{monthLabel(points[0]?.period)}</span>
        <span>{monthLabel(points[points.length - 1]?.period)}</span>
      </div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: ReturnType<typeof trendOf> }) {
  if (!trend) return null;
  const meta = trend === "up" ? { Icon: TrendingUp, label: "subindo" } : trend === "down" ? { Icon: TrendingDown, label: "caindo" } : { Icon: Minus, label: "estável" };
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
      <meta.Icon className="h-3 w-3" aria-hidden /> {meta.label} nos últimos 3 meses
    </span>
  );
}

function IndicatorCard({
  title,
  meaning,
  points,
  total,
  testId,
}: {
  title: string;
  meaning: string;
  points: BoaVistaMonthlyPoint[];
  total?: string | null;
  testId: string;
}) {
  const withValue = points.filter((p) => providerNumber(p.value) != null);
  const latest = withValue[withValue.length - 1] ?? null;
  const values = withValue.map((p) => providerNumber(p.value)!);
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-3" data-testid={testId}>
      <p className="text-xs font-bold text-slate-800">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{meaning}</p>
      {points.length === 0 || !latest ? (
        <p className="mt-3 text-xs text-slate-500">Sem dados mensais neste retorno.</p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <p className="text-2xl font-black tabular-nums text-slate-900">{fmt(providerNumber(latest.value))}</p>
            <p className="text-[11px] text-slate-500">em {monthLabel(latest.period)}</p>
          </div>
          <MiniBars points={points} testId={`${testId}-bars`} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>
              12 meses: mín. {fmt(Math.min(...values))} · máx. {fmt(Math.max(...values))}
              {total ? ` · total ${total}` : ""}
            </span>
            <TrendBadge trend={trendOf(points)} />
          </div>
        </>
      )}
    </div>
  );
}

function LatePayments({ late }: { late: Behavior["latePayments"] }) {
  if (late.length === 0) return <p className="text-xs text-slate-500">Atrasos: informação indisponível neste retorno.</p>;
  const bands = late.filter((row) => !/m[ée]dia/i.test(row.description ?? ""));
  const average = late.find((row) => /m[ée]dia/i.test(row.description ?? ""));
  const months = (bands[0] ?? late[0])!.series.map((p) => p.period);
  const anyLate = bands.some((row) => row.series.some((p) => (providerNumber(p.value) ?? 0) > 0));
  const avgValues = (average?.series ?? []).map((p) => providerNumber(p.value)).filter((n): n is number => n != null);
  const avgMax = avgValues.length ? Math.max(...avgValues) : null;
  const bandName = (description: string | null) => (description ?? "faixa não informada").replace(/^PAGTO ATRASADO\s*-\s*/i, "").replace(/^(\d)/, "$1").toLowerCase();
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="like-serasa-late-payments">
      <p className="text-xs font-bold text-slate-800">Pagamentos com atraso</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">Pagamentos feitos depois do vencimento no mercado, separados por quantos dias de atraso.</p>
      {!anyLate ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900" data-testid="like-serasa-no-late">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          Nenhum pagamento em atraso registrado nos últimos 12 meses
          {avgMax != null ? <span className="font-normal text-emerald-800">· atraso médio {fmt(avgMax)} dia(s)</span> : null}
        </p>
      ) : (
        <div className="mt-2 overflow-auto">
          <table className="min-w-full text-[11px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3">Atraso</th>
                {months.map((m, i) => (
                  <th key={`${m}-${i}`} className="px-1 py-1 text-center font-semibold">{monthLabel(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...bands, ...(average ? [average] : [])].map((row, r) => (
                <tr key={r} className="border-t border-slate-100">
                  <td className="whitespace-nowrap py-1 pr-3 font-medium text-slate-700">{row === average ? "atraso médio (dias)" : bandName(row.description)}</td>
                  {row.series.map((p, i) => {
                    const v = providerNumber(p.value);
                    return (
                      <td key={i} className={cn("px-1 py-1 text-center tabular-nums", v != null && v > 0 ? "rounded bg-red-50 font-bold text-red-800" : "text-slate-400")}>
                        {v == null ? "·" : fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-400">“·” = mês sem informação. Valores na escala da Boa Vista.</p>
        </div>
      )}
    </div>
  );
}

function SupplierRelationship({ supplier }: { supplier: Behavior["supplierRelationship"] }) {
  if (!supplier) return null;
  const items = supplier.items.map((item) => ({ label: (item.period ?? "?").toLowerCase(), value: providerNumber(item.value) }));
  const max = Math.max(0, ...items.map((i) => i.value ?? 0));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="like-serasa-suppliers">
      <p className="text-xs font-bold text-slate-800">Tempo de relacionamento com fornecedores</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">Há quanto tempo a empresa compra dos fornecedores que informam à Boa Vista (quantidade por faixa de tempo).</p>
      {max === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Nenhum relacionamento com fornecedores informado pela Boa Vista.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-[11px]">
              <span className="w-28 shrink-0 text-slate-600">{item.label}</span>
              <span className="h-2 flex-1 rounded bg-slate-100">
                <span className="block h-2 rounded bg-indigo-400" style={{ width: `${max ? Math.round(((item.value ?? 0) / max) * 100) : 0}%` }} />
              </span>
              <span className="w-8 text-right tabular-nums text-slate-700">{fmt(item.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RevenueEstimate({ revenue, cents }: { revenue: Revenue; cents: (value: number | null) => string }) {
  const value = revenue.presumedCents != null ? cents(revenue.presumedCents) : revenue.range ?? revenue.annualLabel ?? revenue.presumedLabel;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="like-serasa-revenue">
      <p className="text-xs font-bold text-slate-800">Faturamento presumido</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">Estimativa externa da Boa Vista sobre o porte da empresa. Não é o faturamento realizado.</p>
      <p className="mt-3 text-lg font-extrabold text-slate-900">{value ? (revenue.presumedCents != null ? value : `Faixa ${value}`) : "Não informado"}</p>
      {revenue.referenceDate ? <p className="text-[11px] text-slate-500">Referência: {revenue.referenceDate}</p> : null}
      {revenue.message ? <p className="text-[11px] text-slate-500">{revenue.message}</p> : null}
    </div>
  );
}

export function FinancialBehaviorPanel({ sections, cents }: { sections: BoaVistaSections | null; cents: (value: number | null) => string }) {
  const behavior = sections?.financialBehavior;
  if (!sections || !behavior?.present) return <p className="mt-2 text-xs text-slate-500">Informação indisponível neste retorno.</p>;
  const creditTotal = providerNumber(behavior.creditObtained?.score ?? null);
  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs text-slate-600">
        Como esta empresa paga e toma crédito no mercado, mês a mês, segundo a Boa Vista. Os números estão na escala do provedor (o retorno não informa
        a unidade): compare a evolução e não o valor absoluto.
      </p>
      <div className="grid gap-3 lg:grid-cols-3">
        <IndicatorCard
          title="Pontualidade nos pagamentos"
          meaning="Índice de pagamentos feitos em dia no mercado: quanto maior, mais contas a empresa pagou no vencimento."
          points={behavior.punctualPayments?.series ?? []}
          testId="like-serasa-punctual"
        />
        <IndicatorCard
          title="Compromissos assumidos"
          meaning="Volume de contas a pagar que a empresa tinha no mercado em cada mês."
          points={behavior.commitments?.series ?? []}
          testId="like-serasa-commitments"
        />
        <IndicatorCard
          title="Crédito obtido"
          meaning="Volume de crédito que a empresa conseguiu no mercado em cada mês (compras a prazo, financiamentos)."
          points={behavior.creditObtained?.series ?? []}
          total={creditTotal != null ? fmt(creditTotal) : null}
          testId="like-serasa-credit-obtained"
        />
      </div>
      <LatePayments late={behavior.latePayments} />
      <div className="grid gap-3 lg:grid-cols-2">
        <SupplierRelationship supplier={behavior.supplierRelationship} />
        <RevenueEstimate revenue={sections.revenue} cents={cents} />
      </div>
    </div>
  );
}
