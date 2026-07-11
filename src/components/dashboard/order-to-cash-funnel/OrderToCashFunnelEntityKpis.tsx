import React from "react";
import { Filter } from "lucide-react";
import { MetricHelpTooltip } from "@/src/components/finance/portfolio-reconciliation/PortfolioIntelligenceHelpPopover";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import type {
  OrderToCashCustomerSummaryDto,
  OrderToCashSellerSummaryDto,
} from "@/src/lib/sales/salesOrderToCashFunnelClient";
import { ORDER_TO_CASH_ENTITY_KPI_HELP } from "@/src/lib/sales/salesOrderToCashFunnelUiCopy";
import { cn } from "@/src/lib/utils";

type Props = {
  sellers: OrderToCashSellerSummaryDto[];
  customers: OrderToCashCustomerSummaryDto[];
  activeSellerName?: string;
  activeSellerId?: string;
  activeCustomerName?: string;
  activeCustomerId?: string;
  onFilterSeller: (row: OrderToCashSellerSummaryDto) => void;
  onFilterCustomer: (row: OrderToCashCustomerSummaryDto) => void;
};

function HeaderCell({ label, explainKey }: { label: string; explainKey: string }) {
  const explanation = ORDER_TO_CASH_ENTITY_KPI_HELP[explainKey] ?? null;
  return (
    <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
      <span className="inline-flex items-center gap-1">
        {label}
        <MetricHelpTooltip
          title={label}
          explanation={explanation}
          missingExplanation={!explanation}
        />
      </span>
    </th>
  );
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatFinancePercent(v);
}

function bottleneckTone(stage: string | null | undefined): "red" | "amber" | "green" | "blue" {
  if (!stage) return "green";
  if (
    stage === "BLOQUEADO_REVISAO" ||
    stage === "SEM_EVIDENCIA" ||
    stage === "PEDIDO_ATRASADO_SEM_DOCUMENTO"
  ) {
    return "red";
  }
  if (
    stage === "PEDIDO_PROXIMO_ATENCAO" ||
    stage === "PEDIDO_PARCIALMENTE_ATENDIDO" ||
    stage === "NF_SEM_CR" ||
    stage === "DOCUMENTO_SEM_NF" ||
    stage === "CR_ABERTO"
  ) {
    return "amber";
  }
  if (stage === "RECEBIDO" || stage === "PEDIDO_FUTURO_SAUDAVEL") return "green";
  return "blue";
}

const TONE_ROW: Record<string, string> = {
  red: "bg-[#FEF3F2]/60",
  amber: "bg-[#FFFAEB]/50",
  green: "bg-[#ECFDF3]/40",
  blue: "bg-[#EFF8FF]/40",
};

const TONE_PILL: Record<string, string> = {
  red: "bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]",
  amber: "bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]",
  green: "bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]",
  blue: "bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]",
};

/**
 * KPIs por vendedor e por cliente — Funil Pedido → Caixa.
 * Consome sellerSummary/customerSummary da API (sem comissões).
 */
export function OrderToCashFunnelEntityKpis({
  sellers,
  customers,
  activeSellerName = "",
  activeSellerId = "",
  activeCustomerName = "",
  activeCustomerId = "",
  onFilterSeller,
  onFilterCustomer,
}: Props) {
  return (
    <div className="space-y-6" data-testid="otc-entity-kpis">
      <section className="space-y-2" data-testid="otc-seller-kpis" aria-label="KPIs por vendedor">
        <div>
          <h3 className="text-sm font-semibold text-[#101828]">Por vendedor</h3>
          <p className="text-[11px] text-[#667085]">
            Vendedor comercial do pedido (SalesOrder/Nomus). Sem comissão. Clique em Filtrar para
            restringir a tela.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#EAECF0] bg-white shadow-sm">
          <table className="min-w-full text-[12px] text-[#344054]">
            <thead className="border-b border-[#EAECF0] bg-[#F9FAFB]">
              <tr>
                <HeaderCell label="Vendedor" explainKey="sellerName" />
                <HeaderCell label="Valor total" explainKey="valorTotal" />
                <HeaderCell label="Em risco" explainKey="valorEmRisco" />
                <HeaderCell label="Pedido → CR" explainKey="taxaPedidoParaCr" />
                <HeaderCell label="Recebido" explainKey="valorRecebido" />
                <HeaderCell label="Confiança" explainKey="confiancaMedia" />
                <HeaderCell label="Gargalo" explainKey="principalGargalo" />
                <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase text-[#667085]">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody>
              {sellers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-[#667085]">
                    Nenhum vendedor no recorte.
                  </td>
                </tr>
              ) : (
                sellers.map((row) => {
                  const tone = bottleneckTone(row.principalGargalo);
                  const active =
                    (activeSellerId &&
                      row.sellerId != null &&
                      activeSellerId === row.sellerId) ||
                    (activeSellerName.trim() !== "" &&
                      activeSellerName.trim().toLowerCase() ===
                        row.sellerName.trim().toLowerCase());
                  return (
                    <tr
                      key={row.sellerId ?? row.sellerName}
                      className={cn(
                        "border-b border-[#F2F4F7] last:border-0",
                        TONE_ROW[tone],
                        active && "ring-1 ring-inset ring-sky-300"
                      )}
                      data-testid={`otc-seller-row-${row.sellerId ?? "na"}`}
                    >
                      <td className="px-2 py-2.5 font-medium text-[#101828]">
                        <div>{row.sellerName}</div>
                        <div className="text-[10px] font-normal text-[#667085]">
                          {formatFinanceInteger(row.orderCount)} pedido(s)
                        </div>
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {formatFinanceCurrency(row.valorTotal)}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {formatFinanceCurrency(row.valorEmRisco)}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {formatPct(row.taxaPedidoParaCr)}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {formatFinanceCurrency(row.valorRecebido)}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {row.confiancaMedia != null
                          ? `${formatFinanceInteger(row.confiancaMedia)}`
                          : "—"}
                      </td>
                      <td className="px-2 py-2.5">
                        <span
                          className={cn(
                            "inline-flex max-w-[160px] rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                            TONE_PILL[tone]
                          )}
                          title={row.acaoRecomendada}
                        >
                          {row.principalGargaloLabel ?? "Sem gargalo"}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-[#EAECF0] bg-white px-2 py-1 text-[11px] font-semibold text-[#344054] hover:bg-[#F9FAFB]"
                          data-testid="otc-filter-by-seller"
                          onClick={() => onFilterSeller(row)}
                        >
                          <Filter className="h-3 w-3" />
                          Filtrar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="space-y-2"
        data-testid="otc-customer-kpis"
        aria-label="KPIs por cliente"
      >
        <div>
          <h3 className="text-sm font-semibold text-[#101828]">Por cliente</h3>
          <p className="text-[11px] text-[#667085]">
            Cliente do pedido de venda. Clique em Filtrar para restringir a tela.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#EAECF0] bg-white shadow-sm">
          <table className="min-w-full text-[12px] text-[#344054]">
            <thead className="border-b border-[#EAECF0] bg-[#F9FAFB]">
              <tr>
                <HeaderCell label="Cliente" explainKey="customerName" />
                <HeaderCell label="Valor total" explainKey="valorTotal" />
                <HeaderCell label="Em risco" explainKey="valorEmRisco" />
                <HeaderCell label="Pedido → CR" explainKey="taxaPedidoParaCr" />
                <HeaderCell label="Recebido" explainKey="valorRecebido" />
                <HeaderCell label="Confiança" explainKey="confiancaMedia" />
                <HeaderCell label="Gargalo" explainKey="principalGargalo" />
                <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase text-[#667085]">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-[#667085]">
                    Nenhum cliente no recorte.
                  </td>
                </tr>
              ) : (
                customers.map((row) => {
                  const tone = bottleneckTone(row.principalGargalo);
                  const active =
                    (activeCustomerId &&
                      row.customerId != null &&
                      activeCustomerId === row.customerId) ||
                    (activeCustomerName.trim() !== "" &&
                      activeCustomerName.trim().toLowerCase() ===
                        row.customerName.trim().toLowerCase());
                  return (
                    <tr
                      key={row.customerId ?? row.customerName}
                      className={cn(
                        "border-b border-[#F2F4F7] last:border-0",
                        TONE_ROW[tone],
                        active && "ring-1 ring-inset ring-sky-300"
                      )}
                      data-testid={`otc-customer-row-${row.customerId ?? "na"}`}
                    >
                      <td className="px-2 py-2.5 font-medium text-[#101828]">
                        <div>{row.customerName}</div>
                        <div className="text-[10px] font-normal text-[#667085]">
                          {formatFinanceInteger(row.orderCount)} pedido(s)
                          {row.pedidosAntigosCount > 0
                            ? ` · ${formatFinanceInteger(row.pedidosAntigosCount)} antigo(s)`
                            : ""}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {formatFinanceCurrency(row.valorTotal)}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {formatFinanceCurrency(row.valorEmRisco)}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {formatPct(row.taxaPedidoParaCr)}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {formatFinanceCurrency(row.valorRecebido)}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums">
                        {row.confiancaMedia != null
                          ? `${formatFinanceInteger(row.confiancaMedia)}`
                          : "—"}
                      </td>
                      <td className="px-2 py-2.5">
                        <span
                          className={cn(
                            "inline-flex max-w-[160px] rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                            TONE_PILL[tone]
                          )}
                          title={row.acaoRecomendada}
                        >
                          {row.principalGargaloLabel ?? "Sem gargalo"}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-[#EAECF0] bg-white px-2 py-1 text-[11px] font-semibold text-[#344054] hover:bg-[#F9FAFB]"
                          data-testid="otc-filter-by-customer"
                          onClick={() => onFilterCustomer(row)}
                        >
                          <Filter className="h-3 w-3" />
                          Filtrar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
