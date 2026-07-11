import React, { useMemo, useState } from "react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioIntelligenceOrderRow } from "@/src/lib/financePortfolioReconciliationClient";
import { cn } from "@/src/lib/utils";
import { financeModuleFilterFieldClass } from "@/src/lib/financeModuleUiStandards";
import {
  confidenceDisplay,
  intelligenceAccordionTitle,
} from "@/src/lib/finance/portfolioIntelligenceUiCopy";

const TAG_LABEL: Record<string, string> = {
  DIVERGENCIA_TECNICA: "Divergência",
  NF_SEM_DOCUMENTO: "NF sem doc.",
  DOCUMENTO_SEM_CR: "Doc. sem CR",
  NF_CABECALHO_MAIOR_PEDIDO: "NF > pedido",
  DIVERGENCIA_PRECO: "Div. preço",
  SEM_CONDICAO_PAGAMENTO: "Sem cond. pag.",
  VINCULO_INCOMPLETO: "Vínculo incompleto",
  PEDIDO_ANTIGO_SEM_EVOLUCAO: "Pedido antigo",
  QUANTIDADE_EXCEDENTE_DOCUMENTO: "Qtd. excedente",
  PRODUTO_FORA_DO_PEDIDO: "Produto fora",
};

const FINANCIAL_STATUS_LABEL: Record<string, string> = {
  FIN_RECEBIDO: "Recebido",
  FIN_CR_ABERTO: "CR aberto",
  FIN_FATURADO_SEM_CR: "Faturado sem CR",
  FIN_SEM_CR: "Sem CR",
};

const OPERATIONAL_STATUS_LABEL: Record<string, string> = {
  OP_TOTALMENTE_ATENDIDO: "Totalmente atendido",
  OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE: "Atendido com excedente",
  OP_PARCIALMENTE_ATENDIDO: "Parcialmente atendido",
  OP_NAO_ATENDIDO: "Não atendido",
  OP_DOCUMENTO_SEM_ITEMIZACAO: "Doc. sem itemização",
  OP_VINCULO_APENAS_CABECALHO: "Vínculo só cabeçalho",
};

function financialStatusLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return FINANCIAL_STATUS_LABEL[code] ?? intelligenceAccordionTitle(code) ?? code;
}

function operationalStatusLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return OPERATIONAL_STATUS_LABEL[code] ?? code;
}

function rowBorderClass(row: PortfolioIntelligenceOrderRow): string {
  switch (row.statusPrincipal) {
    case "RECEBIDO":
    case "CR_ABERTO":
    case "FATURADO_SEM_CR":
      return "border-l-[4px] border-l-[#ABEFC6]";
    case "CARTEIRA_FUTURA_PROVAVEL":
      return "border-l-[4px] border-l-[#B2DDFF]";
    case "CARTEIRA_PRESENTE_ATENCAO":
      return "border-l-[4px] border-l-[#FEDF89]";
    case "CARTEIRA_VENCIDA_BLOQUEADA":
      return "border-l-[4px] border-l-[#FECDCA]";
    default:
      return "border-l-[4px] border-l-[#D0D5DD]";
  }
}

type Props = {
  rows: PortfolioIntelligenceOrderRow[];
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onOpenOrder?: (salesOrderId: string) => void;
};

/**
 * Grid de pedidos do drilldown de maturidade (somente formatação).
 */
export function PortfolioIntelligenceOrdersGrid({
  rows,
  searchQuery = "",
  onSearchChange,
  onOpenOrder,
}: Props) {
  const [localSearch, setLocalSearch] = useState("");
  const q = (onSearchChange ? searchQuery : localSearch).trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.orderCode,
        r.customerName,
        r.sellerName,
        r.statusPrincipal,
        r.financialStatus,
        r.operationalStatus,
        r.mainReason,
        r.externalSalesOrderId != null ? String(r.externalSalesOrderId) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, q]);

  const showCrCols = useMemo(
    () =>
      rows.some(
        (r) =>
          (r.openReceivableValue ?? 0) > 0 ||
          (r.receivedValue ?? 0) > 0 ||
          (r.receivableTotalValue ?? 0) > 0
      ),
    [rows]
  );

  if (rows.length === 0) {
    return (
      <p
        className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground"
        data-testid="portfolio-intelligence-grid-empty"
      >
        Nenhum pedido neste status com o filtro atual.
      </p>
    );
  }

  return (
    <div className="space-y-2.5" data-testid="portfolio-intelligence-orders-grid">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className={cn(financeModuleFilterFieldClass(), "max-w-xs text-xs")}
          placeholder="Buscar pedido, cliente, vendedor…"
          value={onSearchChange ? searchQuery : localSearch}
          onChange={(e) =>
            onSearchChange ? onSearchChange(e.target.value) : setLocalSearch(e.target.value)
          }
          data-testid="portfolio-intelligence-grid-search"
        />
        <span className="text-[10px] text-muted-foreground">
          {filtered.length} de {rows.length} pedido(s)
        </span>
      </div>

      <p
        className="text-[10px] leading-relaxed text-muted-foreground"
        data-testid="portfolio-intelligence-tags-legend"
      >
        Alertas podem aparecer junto do status e não o substituem. Clique na linha para abrir o
        detalhe.
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          Nenhum pedido corresponde à busca.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EAECF0] -mx-1 px-1 sm:mx-0 sm:px-0">
          <table className="min-w-[1200px] w-full border-collapse bg-white text-left text-xs md:min-w-[1600px]">
            <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wide text-[#667085]">
              <tr>
                <th className="px-2.5 py-2.5 font-semibold">Pedido</th>
                <th className="px-2.5 py-2.5 font-semibold">Cliente</th>
                <th className="px-2.5 py-2.5 font-semibold">Vendedor</th>
                <th className="px-2.5 py-2.5 font-semibold">Emissão</th>
                <th className="px-2.5 py-2.5 font-semibold">Previsão entrega</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">Valor pedido</th>
                <th className="px-2.5 py-2.5 font-semibold">Status financeiro</th>
                <th className="px-2.5 py-2.5 font-semibold">Status operacional</th>
                <th className="px-2.5 py-2.5 font-semibold">Confiança</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">% atendimento</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">Excedente</th>
                <th className="px-2.5 py-2.5 font-semibold">Alertas</th>
                <th className="px-2.5 py-2.5 font-semibold">Ação recomendada</th>
                {showCrCols ? (
                  <>
                    <th className="px-2.5 py-2.5 font-semibold text-right">CR aberto</th>
                    <th className="px-2.5 py-2.5 font-semibold text-right">Recebido</th>
                  </>
                ) : null}
                <th className="px-2.5 py-2.5 font-semibold">Data prevista recebimento</th>
                <th className="px-2.5 py-2.5 font-semibold">Última evidência</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const canOpen = Boolean(row.salesOrderId && onOpenOrder);
                const conf = confidenceDisplay(row.confidenceLabel);
                const tags = row.tagsAlerta ?? [];
                return (
                  <tr
                    key={row.salesOrderId ?? row.orderCode}
                    className={cn(
                      "border-t border-[#EAECF0] bg-white align-top",
                      rowBorderClass(row),
                      canOpen && "cursor-pointer hover:bg-[#F9FAFB]"
                    )}
                    onClick={() => {
                      if (row.salesOrderId && onOpenOrder) onOpenOrder(row.salesOrderId);
                    }}
                    data-testid="portfolio-intelligence-grid-row"
                  >
                    <td className="px-2.5 py-2.5 font-semibold text-[#101828]">
                      {row.orderCode}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div className="max-w-[140px] truncate">{row.customerName ?? "—"}</div>
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div className="max-w-[120px] truncate">
                        {row.sellerName ?? "Não informado"}
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums">
                      {formatFinanceDate(row.issueDate)}
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums">
                      {formatFinanceDate(row.expectedDeliveryDate)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums font-semibold">
                      {formatFinanceCurrency(row.orderValue)}
                    </td>
                    <td className="px-2.5 py-2.5 text-[11px]">
                      {financialStatusLabel(row.financialStatus) !== "—"
                        ? financialStatusLabel(row.financialStatus)
                        : intelligenceAccordionTitle(row.statusPrincipal)}
                    </td>
                    <td className="px-2.5 py-2.5 text-[11px]">
                      {operationalStatusLabel(row.operationalStatus)}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <span
                        className={cn(
                          "inline-flex max-w-[9rem] flex-col rounded-md border px-1.5 py-0.5",
                          conf.className
                        )}
                        title={conf.hint}
                      >
                        <span className="text-[10px] font-semibold leading-tight">
                          {conf.label}
                        </span>
                        <span className="text-[9px] tabular-nums opacity-80">
                          {row.confidenceScore}
                        </span>
                      </span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {row.fulfillmentPercent != null
                        ? `${Math.min(100, Math.max(0, row.fulfillmentPercent)).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`
                        : "—"}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {row.excessQuantity != null
                        ? formatFinanceInteger(row.excessQuantity)
                        : "—"}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {tags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex max-w-[200px] flex-wrap gap-1">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded border border-[#FDBA74] bg-[#FFF6ED] px-1 py-0.5 text-[9px] font-semibold text-[#C2410C]"
                              title={tag}
                            >
                              {TAG_LABEL[tag] ?? tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div
                        className="max-w-[200px] truncate text-[#667085]"
                        title={row.recommendedAction}
                      >
                        {row.recommendedAction || "—"}
                      </div>
                    </td>
                    {showCrCols ? (
                      <>
                        <td className="px-2.5 py-2.5 text-right tabular-nums">
                          {formatFinanceCurrency(row.openReceivableValue)}
                        </td>
                        <td className="px-2.5 py-2.5 text-right tabular-nums">
                          {formatFinanceCurrency(row.receivedValue)}
                        </td>
                      </>
                    ) : null}
                    <td className="px-2.5 py-2.5 tabular-nums">
                      {formatFinanceDate(row.forecastDate ?? row.nextRelevantDate)}
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums">
                      {formatFinanceDate(row.updatedAt ?? row.nextRelevantDate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
