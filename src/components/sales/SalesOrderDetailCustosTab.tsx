/**
 * Aba Custos — detalhe do Pedido de Venda.
 * Discrimina MP, HH, HM, demais industriais e impostos (motor industrial oficial).
 */
import React from "react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
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

function CostRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number | null | undefined;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-b border-[#F3F4F6] py-2 last:border-0",
        emphasize && "border-[#E5E7EB] pt-3"
      )}
    >
      <span
        className={cn(
          "text-[12px] text-[#4B5563]",
          emphasize && "font-semibold text-[#111827]"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums text-[12px] text-[#111827]",
          emphasize && "text-[13px] font-bold"
        )}
      >
        {money(value)}
      </span>
    </div>
  );
}

export function SalesOrderDetailCustosTab({
  industrialResult,
  className,
}: Props): JSX.Element {
  const row = industrialResult.row;

  return (
    <div
      className={cn("so-detail-view flex flex-col gap-3", className)}
      data-testid="sales-order-detail-custos-tab"
    >
      <section className="so-detail-section rounded-xl border border-[#E5E7EB] bg-white p-3 sm:p-4">
        <h2 className="so-detail-section-title mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#1e3a8a]">
          Todos os custos envolvidos
        </h2>
        <p className="mb-3 text-[11px] text-[#6b7280]">
          Discriminação de matéria-prima (MP), mão de obra (HH), máquina (HM),
          demais custos industriais e impostos — mesma base do Relatório de
          Resultado Industrial (custo publicado vigente na data do pedido; impostos
          com NF real + estimado no saldo não faturado).
        </p>

        {!industrialResult.available || !row ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            {industrialResult.warnings[0] ??
              "Custos industriais indisponíveis para este pedido."}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#6b7280]">
                Custo industrial
              </h3>
              <CostRow label="Matéria-prima (MP)" value={row.materialCost} />
              <CostRow label="Mão de obra (HH)" value={row.laborHourCost} />
              <CostRow label="Máquina (HM)" value={row.machineHourCost} />
              <CostRow
                label="Demais custos industriais"
                value={row.otherIndustrialCost}
              />
              <CostRow
                label="Total custo industrial"
                value={row.totalIndustrialCost}
                emphasize
              />
            </div>
            <div>
              <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#6b7280]">
                Impostos
              </h3>
              <CostRow label="ICMS" value={row.icms} />
              <CostRow label="IPI" value={row.ipi} />
              <CostRow label="PIS" value={row.pis} />
              <CostRow label="COFINS" value={row.cofins} />
              <CostRow label="ICMS-ST" value={row.icmsSt} />
              <CostRow label="DIFAL" value={row.difal} />
              <CostRow label="FCP" value={row.fcp} />
              <CostRow label="Outros impostos" value={row.otherTaxes} />
              <CostRow label="Total impostos" value={row.totalTaxes} emphasize />
            </div>
          </div>
        )}

        {row ? (
          <dl className="mt-3 grid gap-1 border-t border-[#F3F4F6] pt-3 text-[11px] text-[#6b7280] sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold text-[#374151]">Valor comercial: </dt>
              <dd className="inline tabular-nums">{money(row.orderCommercialValue)}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-[#374151]">Fonte do custo: </dt>
              <dd className="inline">
                {row.costSourceStatusLabel}
                {row.costTableVersionLabel ? ` · ${row.costTableVersionLabel}` : ""}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold text-[#374151]">Fonte do imposto: </dt>
              <dd className="inline">{row.taxSourceLabel}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-[#374151]">Data-base do custo: </dt>
              <dd className="inline">{row.costBaseDate ?? "—"}</dd>
            </div>
          </dl>
        ) : null}

        {industrialResult.warnings.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[11px] text-[#92400E]">
            {industrialResult.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
