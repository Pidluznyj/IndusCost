import React from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { FISCAL360_TAX_LABELS, fiscal360CompanyLabel } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { buildFiscal360Query, formatFiscal360DateTime, formatFiscal360Month, type Fiscal360UiFilters } from "@/src/lib/finance/fiscal360/fiscal360Client";
import type { Fiscal360Overview as OverviewData } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { Badge, Callout, DataTable, ErrorState, KpiCard, KpiGrid, LoadingState, Meter, Section, money, pct } from "./Fiscal360Shared";
import { useFiscal360Resource } from "./useFiscal360Resource";

const BURDEN_LABEL = {
  OK: "Conciliado",
  NOT_RECONCILED: "Não conciliado",
  INSUFFICIENT_DATA: "Dados insuficientes",
} as const;

export function Fiscal360Overview({ filters, refreshKey, onNavigate }: { filters: Fiscal360UiFilters; refreshKey: number; onNavigate: (area: string, extra?: Record<string, string>) => void }) {
  const { data, loading, error } = useFiscal360Resource<OverviewData>("overview", buildFiscal360Query(filters), refreshKey);
  if (error) return <ErrorState message={error} />;
  if (!data) return loading ? <LoadingState /> : null;
  const k = data.kpis;
  const paidLabel = filters.basis === "CASH" ? "pela data do pagamento" : "pela competência";
  const burden =
    k.cashBurdenState === "INSUFFICIENT_DATA" ? (
      <span className="text-[#6B7280]">Dados insuficientes</span>
    ) : (
      <span className="inline-flex items-center gap-1">
        {pct(k.cashBurdenPct, 2)} {k.cashBurdenState === "NOT_RECONCILED" ? <Badge tone="warn">Não conciliado</Badge> : null}
      </span>
    );
  return (
    <div className="space-y-4" data-testid="fiscal360-overview">
      {data.notes.length ? (
        <Callout tone={data.kpis.paymentFactCount === 0 && data.kpis.documentCount === 0 ? "warn" : "info"}>
          <ul className="list-disc space-y-0.5 pl-4">
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <KpiGrid testId="fiscal360-kpis-payments">
        <KpiCard label="Impostos efetivamente pagos" value={money(k.paid)} hint={`Contados uma vez, ${paidLabel}`} source="Guias + AP (baixa) — FiscalPaymentFact" testId="fiscal360-kpi-paid" />
        <KpiCard label="Pagamentos comprovados" value={money(k.paidProven)} hint="Comprovante anexado ou conciliação bancária" tone="good" source="FiscalPaymentProof / Tesouraria" />
        <KpiCard label="Baixas sem comprovação" value={money(k.paidUnproven + k.paidDeclared)} hint={`AP ${money(k.paidUnproven)} · declarado ${money(k.paidDeclared)}`} tone={k.paidUnproven + k.paidDeclared > 0 ? "warn" : undefined} source="NomusAccountsPayable / guia" />
        <KpiCard label="Em revisão (fora do total)" value={money(k.reviewAmount)} hint="Possível duplicidade ou vínculo duplicado" tone={k.reviewAmount > 0 ? "danger" : undefined} source="Conciliação da partição" />
      </KpiGrid>

      <KpiGrid testId="fiscal360-kpis-obligations">
        <KpiCard label="Tributos apurados" value={money(k.assessed)} hint={`Créditos ${money(k.credits)} · retenções ${money(k.retentions)}`} source="FiscalApurationLine (camada B)" />
        <KpiCard label="Tributos devidos" value={money(k.obligationDue)} hint={`Devido na apuração: ${money(k.apurationDue)}`} source="Guias e títulos tributários" />
        <KpiCard label="Saldo a pagar" value={money(k.openBalance)} hint="Obrigações em aberto da competência" tone={k.openBalance > 0 ? "warn" : undefined} source="FiscalPaymentFact.openBalance" />
        <KpiCard label="Obrigações vencidas" value={money(k.overdueAmount)} hint={`${k.overdueCount} obrigação(ões) com vencimento passado`} tone={k.overdueAmount > 0 ? "danger" : undefined} source="Vencimento × hoje" />
      </KpiGrid>

      <KpiGrid testId="fiscal360-kpis-documents">
        <KpiCard label="Tributos documentais destacados" value={money(k.highlighted)} hint={`Mercado ${money(k.highlightedMarket)} · interno ${money(k.highlightedIntercompany)} · outros ${money(k.highlightedOther)}`} source="XML NF-e (camada A) — não é imposto pago" />
        <KpiCard label="Faturamento externo (oficial)" value={money(k.officialRevenue)} hint={`Intercompany eliminado: ${money(k.intercompanyRevenue)}`} source="fiscalNfeWhereSql (mesma regra da DRE)" />
        <KpiCard label="Carga tributária efetiva de caixa" value={burden} hint={`Pago ÷ faturamento externo · ${BURDEN_LABEL[k.cashBurdenState]}`} source="FiscalMonthlySnapshot" testId="fiscal360-kpi-burden" />
        <KpiCard
          label="Pendências de classificação"
          value={k.pendingClassificationCount.toLocaleString("pt-BR")}
          hint={`${money(k.pendingClassificationAmount)} em títulos AP com indício tributário`}
          tone={k.pendingClassificationCount > 0 ? "warn" : undefined}
          source="Classificador AP versionado"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Tributos ao longo do período" subtitle={`Destacado (documental), apurado, devido e pago ${paidLabel}`} testId="fiscal360-monthly-chart">
          {data.monthly.every((m) => !m.highlighted && !m.assessed && !m.obligationDue && !m.paid) ? (
            <p className="py-8 text-center text-[12px] text-[#6B7280]">Sem valores materializados no período.</p>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly.map((m) => ({ ...m, label: formatFiscal360Month(m.month) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF2F7" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatFinanceCurrencyCompact(v)} width={64} />
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="highlighted" name="Destacado" fill="#CBD5E1" />
                  <Bar dataKey="assessed" name="Apurado" fill="#93C5FD" />
                  <Bar dataKey="obligationDue" name="Devido" fill="#3B82F6" />
                  <Bar dataKey="paid" name="Pago" fill="#1E3A8A" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>
        <Section title="Qualidade da conciliação" subtitle={`${k.reconciliationItems} checagem(ns) na seleção`} testId="fiscal360-quality">
          <div className="space-y-3">
            <Meter label="Checagens conciliadas" value={k.reconciledPct} tone={k.reconciledPct != null && k.reconciledPct >= 95 ? "good" : "warn"} />
            <Meter label="Pago com comprovação" value={k.paid > 0 ? (k.paidProven / k.paid) * 100 : null} tone="good" />
            <Meter label="Documentos sem XML processado" value={k.documentCount > 0 ? (k.missingXmlCount / k.documentCount) * 100 : null} tone="danger" />
            <div className="flex flex-wrap gap-2 text-[11px]">
              <Badge tone={k.openIssues > 0 ? "warn" : "good"}>{k.openIssues} pendência(s) de qualidade</Badge>
              <Badge tone="neutral">{k.paymentFactCount} obrigação(ões)</Badge>
              <Badge tone="neutral">{k.documentCount.toLocaleString("pt-BR")} documento(s)</Badge>
            </div>
            <Callout>Ausência de guia não significa imposto zero: indicadores sem base mostram “Dados insuficientes”.</Callout>
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Por tributo" testId="fiscal360-by-tax">
          <DataTable
            rows={data.byTax}
            rowKey={(r) => r.taxType}
            onRowClick={(r) => onNavigate("payments", { taxType: r.taxType })}
            columns={[
              { key: "t", header: "Tributo", render: (r) => <b>{FISCAL360_TAX_LABELS[r.taxType] ?? r.taxType}</b> },
              { key: "h", header: "Destacado", align: "right", render: (r) => money(r.highlighted) },
              { key: "a", header: "Apurado", align: "right", render: (r) => money(r.assessed) },
              { key: "d", header: "Devido", align: "right", render: (r) => money(r.due) },
              { key: "p", header: "Pago", align: "right", render: (r) => <b>{money(r.paid)}</b> },
              { key: "o", header: "Saldo", align: "right", render: (r) => money(r.open) },
            ]}
          />
        </Section>
        <Section title="Por empresa (obrigações preservadas por CNPJ)" testId="fiscal360-by-company">
          <DataTable
            rows={data.byCompany}
            rowKey={(r) => r.companyCnpj}
            columns={[
              { key: "c", header: "Empresa", render: (r) => <b>{fiscal360CompanyLabel(r.companyCnpj)}</b> },
              { key: "r", header: "Faturamento externo", align: "right", render: (r) => money(r.officialRevenue) },
              { key: "d", header: "Devido", align: "right", render: (r) => money(r.due) },
              { key: "p", header: "Pago", align: "right", render: (r) => <b>{money(r.paid)}</b> },
              { key: "o", header: "Saldo", align: "right", render: (r) => money(r.open) },
            ]}
          />
        </Section>
      </div>

      <p className="text-[11px] text-[#6B7280]" data-testid="fiscal360-freshness">
        Última materialização: {formatFiscal360DateTime(data.freshness.lastSnapshotAt)} · última execução {data.freshness.lastRunStatus ?? "—"} em {formatFiscal360DateTime(data.freshness.lastRunAt)} · fila: {data.freshness.pendingJobs} pendente(s), {data.freshness.failedJobs} com erro
        {data.freshness.lagMinutes != null && data.freshness.pendingJobs > 0 ? ` · defasagem ${data.freshness.lagMinutes} min` : ""}
      </p>
    </div>
  );
}
