import React from "react";
import { AlertTriangle } from "lucide-react";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE } from "@/src/lib/financeAccountsReceivableDashboard.js";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";
import { CustomerIntelligenceTabKpiGrid } from "@/src/components/crm/customer-intelligence/CustomerIntelligenceTabKpiGrid";

function formatOptionalCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatCurrency(value);
}

function formatOptionalNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatNumber(value);
}

function TitleTable({
  title,
  headers,
  rows,
  emptyMessage,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  emptyMessage: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
      <h2 className="text-sm font-bold mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <table className="w-full text-sm border-collapse min-w-[24rem]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              {headers.map((h) => (
                <th key={h} className="py-2 pr-3 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-border/60 last:border-0">
                {row.map((cell, cidx) => (
                  <td key={cidx} className="py-2 pr-3 whitespace-nowrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function CustomerIntelligenceFinancialTab({ report }: { report: CustomerIntelligenceReport }) {
  const financial = report.financial;

  if (!financial.linkedByCnpj) {
    return (
      <div className="customer-intelligence-tab-panel rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <p className="font-semibold">Financeiro não vinculado</p>
        <p className="text-sm text-muted-foreground mt-2">
          {financial.dataQuality.warnings[0] ??
            "CNPJ do cliente ausente ou inválido — não foi possível cruzar com Contas a Receber."}
        </p>
      </div>
    );
  }

  const overdueAgingTotal = financial.agingBuckets
    .filter((b) => b.key.startsWith("overdue"))
    .reduce((acc, b) => acc + b.amount, 0);

  return (
    <div className="customer-intelligence-tab-panel space-y-5">
      <section className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p>
          Financeiro usa a base oficial de Contas a Receber.{" "}
          {FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE}
        </p>
      </section>

      {financial.riskAlert ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4 flex gap-2 items-start">
          <AlertTriangle className="h-5 w-5 text-red-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-900">Alerta de risco financeiro</p>
            <p className="text-sm text-red-800 mt-1">{financial.riskAlert}</p>
          </div>
        </section>
      ) : null}

      <CustomerIntelligenceTabKpiGrid
        ariaLabel="Indicadores financeiros"
        items={[
          {
            label: "Total a receber",
            value: formatOptionalCurrency(financial.receivableOpenAmount),
          },
          { label: "Valor vencido", value: formatOptionalCurrency(financial.overdueAmount) },
          { label: "Valor a vencer", value: formatOptionalCurrency(financial.upcomingAmount) },
          {
            label: "Títulos em aberto",
            value: formatOptionalNumber(financial.openTitlesCount),
          },
          {
            label: "Títulos vencidos",
            value: formatOptionalNumber(financial.overdueTitlesCount),
          },
          {
            label: "Maior atraso",
            value:
              financial.maxDaysOverdue != null && financial.maxDaysOverdue > 0
                ? `${financial.maxDaysOverdue} dias`
                : "—",
          },
          {
            label: "Média de atraso",
            value:
              financial.averageDaysOverdue != null
                ? `${financial.averageDaysOverdue.toFixed(1)} dias`
                : "—",
          },
          { label: "Próximo vencimento", value: financial.nextDueDate ?? "—" },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold mb-3">Aging de vencidos e carteira</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {financial.agingBuckets.map((bucket) => (
            <div
              key={bucket.key}
              className="rounded-lg border border-border/60 px-3 py-2 text-sm"
            >
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                {bucket.label}
              </p>
              <p className="font-bold mt-0.5">{formatCurrency(bucket.amount)}</p>
              <p className="text-xs text-muted-foreground">{bucket.count} título(s)</p>
            </div>
          ))}
        </div>
        {financial.overdueAmount != null && financial.overdueAmount > 0 ? (
          <p className="text-xs text-muted-foreground mt-3">
            Soma aging vencido: {formatCurrency(overdueAgingTotal)} · Total vencido:{" "}
            {formatCurrency(financial.overdueAmount)}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <TitleTable
          title="Títulos em aberto"
          headers={["ID", "Vencimento", "Saldo", "NF", "Status"]}
          emptyMessage="Nenhum título em aberto na base gerencial."
          rows={financial.openTitles.map((t) => [
            String(t.externalId),
            t.dueDate ? t.dueDate.slice(0, 10) : "—",
            formatCurrency(t.balanceReceivable),
            t.sourceInvoiceNumber ?? (t.isForecast ? "Previsão" : "—"),
            t.status,
          ])}
        />
        <TitleTable
          title="Títulos vencidos"
          headers={["ID", "Vencimento", "Saldo", "Dias atraso", "NF"]}
          emptyMessage="Nenhum título vencido na visão gerencial."
          rows={financial.overdueTitles.map((t) => [
            String(t.externalId),
            t.dueDate ? t.dueDate.slice(0, 10) : "—",
            formatCurrency(t.balanceReceivable),
            String(t.daysOverdue),
            t.sourceInvoiceNumber ?? "—",
          ])}
        />
      </div>

      {financial.paymentHistory.length > 0 ? (
        <TitleTable
          title="Histórico de pagamento (recebidos)"
          headers={["ID", "Vencimento", "Liquidação", "Recebido"]}
          emptyMessage=""
          rows={financial.paymentHistory.map((p) => [
            String(p.externalId),
            p.dueDate ?? "—",
            p.settlementDate ? p.settlementDate.slice(0, 10) : "—",
            formatCurrency(p.amountReceived),
          ])}
        />
      ) : null}

      {financial.dataQuality.warnings.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm">
          <p className="font-semibold text-amber-950">Qualidade dos dados financeiros</p>
          <ul className="list-disc pl-5 mt-2 text-amber-900 space-y-1">
            {financial.dataQuality.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
