/**
 * Aba Resultado do pedido — detalhe executivo + explosão de matérias-primas.
 */
import React from "react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { formatExecutiveDecimal } from "@/src/lib/executiveDashboardFormatters";
import type { SalesOrderDetailIndustrialResultBlock } from "@/src/lib/sales-orders/salesOrderDetailIndustrialResult";
import { cn } from "@/src/lib/utils";

type Props = {
  industrialResult: SalesOrderDetailIndustrialResultBlock;
  className?: string;
};

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceCurrency(value);
}

export function SalesOrderDetailResultadoTab({
  industrialResult,
  className,
}: Props): JSX.Element {
  const row = industrialResult.row;
  const surplus = row?.industrialResult ?? null;
  const verdictTone =
    industrialResult.verdict === "POSITIVE"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : industrialResult.verdict === "NEGATIVE"
        ? "border-red-200 bg-red-50 text-red-900"
        : industrialResult.verdict === "ZERO"
          ? "border-slate-200 bg-slate-50 text-slate-800"
          : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div
      className={cn("so-detail-view flex flex-col gap-3", className)}
      data-testid="sales-order-detail-resultado-tab"
    >
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-3 sm:p-4">
        <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#1e3a8a]">
          Resultado do pedido detalhado
        </h2>
        <p className="mb-3 text-[11px] text-[#6b7280]">
          Valor comercial − impostos − custo industrial (MP + HH + HM + demais).
          Mostra se o pedido fecha positivo e quanto deveria sobrar depois dos
          custos industriais e dos impostos.
        </p>

        <div
          className={cn(
            "mb-3 rounded-lg border px-3 py-2 text-[13px] font-semibold",
            verdictTone
          )}
          data-testid="sales-order-detail-resultado-verdict"
        >
          {industrialResult.verdictLabel}
        </div>

        {surplus != null && industrialResult.verdict !== "INCOMPLETE" ? (
          <div
            className={cn(
              "mb-4 rounded-xl border px-4 py-3",
              surplus >= 0
                ? "border-emerald-300 bg-emerald-50"
                : "border-red-300 bg-red-50"
            )}
            data-testid="sales-order-detail-resultado-surplus"
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#6b7280]">
              {surplus >= 0
                ? "Quanto deve sobrar após custos e impostos"
                : "Quanto falta após custos e impostos"}
            </p>
            <p
              className={cn(
                "mt-1 text-[22px] font-bold tabular-nums",
                surplus >= 0 ? "text-emerald-800" : "text-red-800"
              )}
            >
              {money(Math.abs(surplus))}
            </p>
          </div>
        ) : null}

        <p className="mb-4 text-[12px] leading-relaxed text-[#374151]">
          {industrialResult.resultNarrative}
        </p>

        {row ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Valor comercial" value={money(row.orderCommercialValue)} />
            <MetricCard label="Total impostos" value={money(row.totalTaxes)} />
            <MetricCard
              label="Receita após impostos"
              value={money(row.revenueAfterTaxes)}
            />
            <MetricCard
              label="Custo industrial"
              value={money(row.totalIndustrialCost)}
            />
            <MetricCard
              label="Resultado industrial"
              value={money(row.industrialResult)}
              strong
            />
            <MetricCard
              label="Margem industrial %"
              value={
                row.industrialMarginPercent == null
                  ? "—"
                  : `${formatExecutiveDecimal(row.industrialMarginPercent)}%`
              }
            />
            <MetricCard label="MP (custo)" value={money(row.materialCost)} />
            <MetricCard
              label="HH + HM"
              value={money(
                (row.laborHourCost ?? 0) + (row.machineHourCost ?? 0)
              )}
            />
          </div>
        ) : (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            Resultado industrial indisponível.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-3 sm:p-4">
        <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#1e3a8a]">
          Matérias-primas do pedido
        </h2>
        <p className="mb-3 text-[11px] text-[#6b7280]">
          Quantidade total no pedido (BOM × qtd do item), preço unitário
          considerado no custo publicado e custo total. Consolidadas por material.
        </p>

        {industrialResult.materials.length === 0 ? (
          <p className="text-[12px] text-[#6b7280]">
            Nenhuma linha de MP encontrada no snapshot de custo publicado dos itens.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-full border-collapse text-left text-[11px]"
              data-testid="sales-order-detail-mp-table"
            >
              <thead>
                <tr className="border-b border-[#E5E7EB] text-[10px] uppercase tracking-wide text-[#6b7280]">
                  <th className="px-2 py-2 font-semibold">SKU</th>
                  <th className="px-2 py-2 font-semibold">Material</th>
                  <th className="px-2 py-2 font-semibold">Un.</th>
                  <th className="px-2 py-2 font-semibold text-right">Qtd no pedido</th>
                  <th className="px-2 py-2 font-semibold text-right">
                    Preço considerado
                  </th>
                  <th className="px-2 py-2 font-semibold text-right">Custo total</th>
                  <th className="px-2 py-2 font-semibold">Produto origem</th>
                </tr>
              </thead>
              <tbody>
                {industrialResult.materials.map((m) => (
                  <tr
                    key={m.materialKey}
                    className="border-b border-[#F3F4F6] text-[#111827]"
                  >
                    <td className="px-2 py-1.5 font-mono text-[10px]">
                      {m.sku ?? "—"}
                    </td>
                    <td className="px-2 py-1.5">{m.name}</td>
                    <td className="px-2 py-1.5">{m.unit ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatExecutiveDecimal(m.quantityInOrder)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {money(m.unitCostUsed)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                      {money(m.totalCost)}
                    </td>
                    <td className="px-2 py-1.5 text-[#6b7280]">
                      {m.sourceProductSku ?? m.sourceProductName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#F9FAFB] font-semibold text-[#111827]">
                  <td className="px-2 py-2" colSpan={5}>
                    Total MP (linhas)
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {money(industrialResult.materialsTotalCost)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {industrialResult.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[11px] text-[#92400E]">
          {industrialResult.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 tabular-nums text-[13px] text-[#111827]",
          strong && "text-[15px] font-bold"
        )}
      >
        {value}
      </p>
    </div>
  );
}
