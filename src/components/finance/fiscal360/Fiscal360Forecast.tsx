import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { FISCAL360_TAX_LABELS, addFiscal360Months, fiscal360CompanyLabel } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { buildFiscal360Query, formatFiscal360DateTime, formatFiscal360Month, postFiscal360, type Fiscal360Capabilities, type Fiscal360UiFilters } from "@/src/lib/finance/fiscal360/fiscal360Client";
import { summarizeFiscal360Forecast, type ForecastAssumptions, type ForecastRow } from "@/src/lib/finance/fiscal360/fiscal360Forecast";
import type { Fiscal360ForecastEffects, Fiscal360ForecastResponse, Fiscal360ForecastRowDto } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { Badge, ButtonLike, Callout, DataTable, ErrorState, KpiCard, KpiGrid, LoadingState, Section, money, pct } from "./Fiscal360Shared";
import { useFiscal360Resource } from "./useFiscal360Resource";

const DEFAULT_ASSUMPTIONS: ForecastAssumptions = { revenueGrowthPct: 0, revenueShiftPct: 0, ratioPercentile: "MEDIAN", purchasesShiftPct: 0, paymentLagMonths: null, horizonMonths: 6 };

function delta(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return "—";
  const d = a - b;
  return `${d >= 0 ? "+" : "−"} ${money(Math.abs(d))}`;
}

function Effects({ effects, base, label }: { effects: Fiscal360ForecastEffects | null; base: Fiscal360ForecastEffects | null; label: string }) {
  if (!effects) return null;
  return (
    <KpiGrid testId="fiscal360-forecast-effects">
      <KpiCard label="Tributos devidos no horizonte" value={money(effects.taxesDue)} hint={base ? `vs. Base: ${delta(effects.taxesDue, base.taxesDue)}` : label} />
      <KpiCard label="Desembolso de caixa" value={money(effects.cashOut)} hint={base ? `vs. Base: ${delta(effects.cashOut, base.cashOut)}` : "Pelo mês de pagamento"} />
      <KpiCard
        label="Carga sobre faturamento projetado"
        value={effects.taxBurdenPct == null ? "Dados insuficientes" : pct(effects.taxBurdenPct, 2)}
        hint={`Efeito na margem/lucro: ${base?.taxBurdenPct != null && effects.taxBurdenPct != null ? `${(effects.taxBurdenPct - base.taxBurdenPct).toFixed(2)} p.p.` : "—"} · receita ${money(effects.revenue)}`}
      />
      <KpiCard label="Capital de giro (defasagem)" value={money(effects.workingCapitalFromLag)} hint={`Tributo do horizonte pago depois dele · atrasos no desembolso: ${money(effects.arrears)} · ${effects.unavailableCount} projeção(ões) indisponível(is)`} tone={effects.unavailableCount > 0 ? "warn" : undefined} />
    </KpiGrid>
  );
}

function ForecastTable({ rows }: { rows: Fiscal360ForecastRowDto[] }) {
  return (
    <DataTable
      testId="fiscal360-forecast-table"
      rows={rows}
      rowKey={(r) => `${r.companyCnpj}|${r.month}|${r.taxType}|${r.kind}`}
      empty="Sem projeções persistidas para o filtro."
      columns={[
        { key: "m", header: "Competência", render: (r) => formatFiscal360Month(r.month) },
        { key: "c", header: "Empresa", render: (r) => fiscal360CompanyLabel(r.companyCnpj) },
        { key: "t", header: "Tributo", render: (r) => FISCAL360_TAX_LABELS[r.taxType] ?? r.taxType },
        { key: "k", header: "Natureza", render: (r) => <Badge tone={r.kind === "DETERMINISTIC" ? "info" : "neutral"}>{r.kind === "DETERMINISTIC" ? "Determinística" : "Estimada"}</Badge> },
        {
          key: "v",
          header: "Valor",
          align: "right",
          render: (r) =>
            r.availability === "UNAVAILABLE" ? (
              <span className="text-[11px] text-[#B45309]" title={r.unavailableReason ?? undefined}>
                Projeção indisponível
              </span>
            ) : (
              <>
                <b>{money(r.amount)}</b>
                {r.kind === "ESTIMATED" && r.lowAmount != null && r.highAmount != null ? (
                  <>
                    <br />
                    <span className="text-[10px] text-[#6B7280]">
                      {money(r.lowAmount)} – {money(r.highAmount)}
                    </span>
                  </>
                ) : null}
              </>
            ),
        },
        { key: "cash", header: "Desembolso", render: (r) => formatFiscal360Month(r.cashMonth) },
        { key: "meth", header: "Metodologia", render: (r) => <span className="text-[10px] text-[#4B5563]">{r.availability === "UNAVAILABLE" ? r.unavailableReason : r.methodology}</span> },
      ]}
    />
  );
}

export function Fiscal360Forecast({ filters, refreshKey, caps }: { filters: Fiscal360UiFilters; refreshKey: number; caps: Fiscal360Capabilities }) {
  const [scenarioId, setScenarioId] = useState<string>("");
  const [custom, setCustom] = useState(false);
  const [assumptions, setAssumptions] = useState<ForecastAssumptions>(DEFAULT_ASSUMPTIONS);
  const [preview, setPreview] = useState<ForecastRow[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const query = useMemo(() => buildFiscal360Query(filters, { scenarioId }), [filters, scenarioId]);
  const { data, loading, error, reload } = useFiscal360Resource<Fiscal360ForecastResponse>("forecast", query, refreshKey);

  useEffect(() => {
    if (!custom) return;
    const handle = setTimeout(() => {
      setPreviewError(null);
      postFiscal360<{ rows: ForecastRow[] }>("forecast/preview", { assumptions })
        .then((res) => setPreview(res.rows))
        .catch((e: unknown) => setPreviewError(e instanceof Error ? e.message : "Falha na simulação."));
    }, 350);
    return () => clearTimeout(handle);
  }, [custom, assumptions]);

  const horizon = useMemo(() => {
    const ref = new Date().toISOString().slice(0, 7);
    return Array.from({ length: custom ? assumptions.horizonMonths : data?.selected?.horizonMonths ?? 6 }, (_, i) => addFiscal360Months(ref, i));
  }, [custom, assumptions.horizonMonths, data?.selected?.horizonMonths]);

  const companyFilter = filters.company && filters.company !== "group" ? filters.company : null;
  const previewRows = (preview ?? []).filter((r) => (!companyFilter || r.companyCnpj === companyFilter) && (!filters.taxType || r.taxType === filters.taxType));
  const rows: Fiscal360ForecastRowDto[] = custom ? previewRows : data?.rows ?? [];
  const effects = custom ? summarizeFiscal360Forecast(previewRows, horizon) : data?.effects ?? null;
  const chart = horizon.map((m) => {
    const inMonth = rows.filter((r) => r.month === m && r.availability === "AVAILABLE");
    return {
      label: formatFiscal360Month(m),
      deterministic: inMonth.filter((r) => r.kind === "DETERMINISTIC").reduce((s, r) => s + (r.amount ?? 0), 0),
      estimated: inMonth.filter((r) => r.kind === "ESTIMATED").reduce((s, r) => s + (r.amount ?? 0), 0),
    };
  });

  async function save() {
    setSaving(true);
    setSaved(null);
    try {
      await postFiscal360("forecast/scenarios", { name, assumptions });
      setSaved("Cenário salvo com premissas e versão da metodologia. Dados oficiais não são alterados.");
      setName("");
      reload();
    } catch (e) {
      setSaved(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  const slider = (key: keyof ForecastAssumptions, label: string, min: number, max: number, step: number, suffix: string) => (
    <label className="block text-[11px] font-semibold text-[#374151]">
      <span className="flex justify-between">
        {label}
        <b className="tabular-nums">
          {String(assumptions[key] ?? "—")}
          {suffix}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(assumptions[key] ?? 0)}
        onChange={(e) => setAssumptions((a) => ({ ...a, [key]: Number(e.target.value) }))}
        className="w-full accent-[#1e3a8a]"
        aria-label={label}
      />
    </label>
  );

  if (error) return <ErrorState message={error} />;
  if (!data) return loading ? <LoadingState /> : null;
  const select = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";
  return (
    <div className="space-y-4" data-testid="fiscal360-forecast">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-semibold text-[#374151]">
          Cenário
          <select
            className={`${select} block`}
            value={custom ? "__custom" : data.selected?.id ?? ""}
            onChange={(e) => {
              if (e.target.value === "__custom") setCustom(true);
              else {
                setCustom(false);
                setScenarioId(e.target.value);
              }
            }}
            data-testid="fiscal360-forecast-scenario"
          >
            {data.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.kind === "CUSTOM" ? ` (por ${s.createdByName ?? "usuário"})` : ""}
              </option>
            ))}
            <option value="__custom">Personalizado (simular)</option>
          </select>
        </label>
        {!custom && data.selected ? (
          <p className="text-[11px] text-[#6B7280]">
            {data.selected.description ?? ""} · calculado em {formatFiscal360DateTime(data.selected.computedAt)} · {data.selected.methodologyVersion}
            {data.stale ? <Badge tone="warn">aguardando recálculo pelo processamento</Badge> : null}
          </p>
        ) : null}
      </div>
      {data.scenarios.length === 0 && !custom ? <Callout tone="warn">Nenhuma projeção persistida ainda: o processamento fiscal gera os cenários Base, Conservador e Expansão após materializar os snapshots.</Callout> : null}

      <Effects effects={effects} base={data.baseEffects} label="Cenário selecionado" />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.4fr]">
        <Section title="Planejador tributário" subtitle="Premissas sobre agregados persistidos — não altera dados oficiais.">
          {custom ? (
            <div className="space-y-3" data-testid="fiscal360-forecast-planner">
              {slider("revenueGrowthPct", "Crescimento anual da receita externa", -20, 60, 1, "%")}
              {slider("revenueShiftPct", "Ajuste imediato da receita", -30, 30, 1, "%")}
              {slider("purchasesShiftPct", "Ajuste das compras creditáveis (parâmetros)", -30, 30, 1, "%")}
              {slider("horizonMonths", "Horizonte", 3, 18, 1, " meses")}
              <label className="block text-[11px] font-semibold text-[#374151]">
                Razão tributária histórica
                <select className={`${select} block w-full`} value={assumptions.ratioPercentile} onChange={(e) => setAssumptions((a) => ({ ...a, ratioPercentile: e.target.value as ForecastAssumptions["ratioPercentile"] }))}>
                  <option value="P25">Percentil 25 (menor carga)</option>
                  <option value="MEDIAN">Mediana</option>
                  <option value="P75">Percentil 75 (maior carga — prudente)</option>
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-[#374151]">
                Defasagem competência → pagamento
                <select
                  className={`${select} block w-full`}
                  value={assumptions.paymentLagMonths == null ? "" : String(assumptions.paymentLagMonths)}
                  onChange={(e) => setAssumptions((a) => ({ ...a, paymentLagMonths: e.target.value === "" ? null : Number(e.target.value) }))}
                >
                  <option value="">Histórica observada</option>
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n} mês(es)
                    </option>
                  ))}
                </select>
              </label>
              {previewError ? <ErrorState message={previewError} /> : null}
              <div className="flex flex-wrap items-end gap-2">
                <ButtonLike onClick={() => setAssumptions(DEFAULT_ASSUMPTIONS)}>Restaurar premissas</ButtonLike>
                {caps.assumptions ? (
                  <>
                    <input className={`${select} w-44`} placeholder="Nome do cenário" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do cenário" />
                    <ButtonLike variant="primary" disabled={saving || name.trim().length < 3} onClick={save} testId="fiscal360-forecast-save">
                      {saving ? "Salvando…" : "Salvar cenário"}
                    </ButtonLike>
                  </>
                ) : null}
              </div>
              {saved ? <Callout>{saved}</Callout> : null}
            </div>
          ) : (
            <div className="space-y-2 text-[12px] text-[#4B5563]">
              <p>Escolha “Personalizado” para alterar premissas e comparar efeitos sobre tributos, desembolso, margem, lucro, caixa e capital de giro.</p>
              <pre className="overflow-x-auto rounded-md bg-[#F9FAFB] p-2 text-[10px]">{JSON.stringify(data.selected?.assumptions ?? {}, null, 1)}</pre>
            </div>
          )}
        </Section>
        <Section title="Projeção por mês" subtitle="Determinística (guias/títulos conhecidos) separada da estimada (razão histórica por CNPJ e tributo).">
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF2F7" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatFinanceCurrencyCompact(v)} width={64} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="deterministic" stackId="a" name="Determinística" fill="#1E3A8A" />
                <Bar dataKey="estimated" stackId="a" name="Estimada" fill="#93C5FD" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>
      <Section title="Detalhe da projeção" subtitle="Valores persistidos com versão, data de cálculo e metodologia. Sem base suficiente → “projeção indisponível”.">
        <ForecastTable rows={rows} />
      </Section>
      <Callout>
        Reforma tributária (IBS/CBS/IS): valores documentais de 2026 são tratados como informativos. Nenhuma alíquota de transição é aplicada sem regra ativa versionada com fonte normativa e vigência — nunca retroativamente. Metodologia: {data.methodologyDoc}.
      </Callout>
    </div>
  );
}
