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
  PEDIDO_ANTIGO_SEM_EVOLUCAO: "Pedido antigo sem evolução",
  QUANTIDADE_EXCEDENTE_DOCUMENTO: "Qtd. excedente",
  PRODUTO_FORA_DO_PEDIDO: "Produto fora",
};

const FINANCIAL_STATUS_LABEL: Record<string, string> = {
  FIN_RECEBIDO: "Já recebido",
  FIN_CR_ABERTO: "CR aberto",
  FIN_FATURADO_SEM_CR: "Faturado sem CR",
  FIN_SEM_CR: "Sem CR",
};

const OPERATIONAL_STATUS_LABEL: Record<string, string> = {
  OP_TOTALMENTE_ATENDIDO: "Totalmente atendido",
  OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE: "Totalmente atendido (com excedente)",
  OP_PARCIALMENTE_ATENDIDO: "Parcialmente atendido",
  OP_NAO_ATENDIDO: "Não atendido",
  OP_DOCUMENTO_SEM_ITEMIZACAO: "Documento sem itemização",
  OP_VINCULO_APENAS_CABECALHO: "Vínculo só de cabeçalho",
};

function financialStatusLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return FINANCIAL_STATUS_LABEL[code] ?? intelligenceAccordionTitle(code) ?? code;
}

function operationalStatusLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return OPERATIONAL_STATUS_LABEL[code] ?? code;
}

function yesNo(v: boolean): string {
  return v ? "Sim" : "Não";
}

function daysSinceForecast(forecastDate: string | null): number | null {
  if (!forecastDate) return null;
  const [y, m, d] = forecastDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const forecast = new Date(y, m - 1, d);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((start.getTime() - forecast.getTime()) / 86_400_000);
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

  const showFulfillmentCols = useMemo(
    () =>
      rows.some(
        (r) =>
          r.financialStatus != null ||
          r.operationalStatus != null ||
          r.fulfillmentPercent != null ||
          r.excessQuantity != null ||
          r.valueOutsideOrder != null
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

      <p className="text-[10px] leading-relaxed text-muted-foreground" data-testid="portfolio-intelligence-tags-legend">
        Alertas podem aparecer junto do status e não o substituem. Em telas menores, deslize a
        tabela.
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          Nenhum pedido corresponde à busca.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60 -mx-1 px-1 sm:mx-0 sm:px-0">
          <table
            className={cn(
              "w-full border-collapse text-left text-xs",
              showFulfillmentCols ? "min-w-[980px] md:min-w-[1900px]" : "min-w-[980px] md:min-w-[1700px]"
            )}
          >
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2.5 py-2.5 font-semibold">Pedido</th>
                <th className="px-2.5 py-2.5 font-semibold">Cliente</th>
                <th className="px-2.5 py-2.5 font-semibold">Vendedor</th>
                <th className="px-2.5 py-2.5 font-semibold">Emissão</th>
                <th className="px-2.5 py-2.5 font-semibold">Prevista</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">Dias emissão</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">Dias previsão</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">Valor pedido</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">Valor CR</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">Recebido</th>
                <th className="px-2.5 py-2.5 font-semibold text-right">Aberto</th>
                <th className="px-2.5 py-2.5 font-semibold">Status</th>
                {showFulfillmentCols ? (
                  <>
                    <th className="px-2.5 py-2.5 font-semibold">Status financeiro</th>
                    <th className="px-2.5 py-2.5 font-semibold">Status operacional</th>
                  </>
                ) : null}
                <th className="px-2.5 py-2.5 font-semibold">Alertas</th>
                {showFulfillmentCols ? (
                  <>
                    <th className="px-2.5 py-2.5 font-semibold text-right">% atendimento</th>
                    <th className="px-2.5 py-2.5 font-semibold text-right">Excedente</th>
                    <th className="px-2.5 py-2.5 font-semibold text-right">Valor fora do pedido</th>
                  </>
                ) : null}
                <th className="px-2.5 py-2.5 font-semibold">Confiança</th>
                <th className="px-2.5 py-2.5 font-semibold">Motivo</th>
                <th className="px-2.5 py-2.5 font-semibold">Próximo passo</th>
                <th className="px-2.5 py-2.5 font-semibold">ID Nomus</th>
                <th className="px-2.5 py-2.5 font-semibold">Produto</th>
                <th className="px-2.5 py-2.5 font-semibold">NF</th>
                <th className="px-2.5 py-2.5 font-semibold">Doc. saída</th>
                <th className="px-2.5 py-2.5 font-semibold">CR</th>
                <th className="px-2.5 py-2.5 font-semibold">Baixa</th>
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
                      "border-t border-border/40 align-top",
                      canOpen && "cursor-pointer hover:bg-sky-50/40"
                    )}
                    onClick={() => {
                      if (row.salesOrderId && onOpenOrder) onOpenOrder(row.salesOrderId);
                    }}
                    data-testid="portfolio-intelligence-grid-row"
                  >
                    <td className="px-2.5 py-2.5 font-medium text-foreground">{row.orderCode}</td>
                    <td className="px-2.5 py-2.5">
                      <div className="max-w-[140px] truncate">{row.customerName ?? "—"}</div>
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div className="max-w-[120px] truncate">
                        {row.sellerName ?? "Não informado na importação"}
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums">{formatFinanceDate(row.issueDate)}</td>
                    <td className="px-2.5 py-2.5 tabular-nums">
                      {formatFinanceDate(row.forecastDate ?? row.expectedDeliveryDate)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {row.daysSinceIssue != null ? formatFinanceInteger(row.daysSinceIssue) : "—"}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {(() => {
                        const d = daysSinceForecast(row.forecastDate);
                        return d != null ? formatFinanceInteger(d) : "—";
                      })()}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {formatFinanceCurrency(row.orderValue)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {formatFinanceCurrency(row.receivableTotalValue)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {formatFinanceCurrency(row.receivedValue)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {formatFinanceCurrency(row.openReceivableValue)}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <span className="rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-medium">
                        {intelligenceAccordionTitle(row.statusPrincipal)}
                      </span>
                    </td>
                    {showFulfillmentCols ? (
                      <>
                        <td className="px-2.5 py-2.5 text-[10px]">
                          {financialStatusLabel(row.financialStatus)}
                        </td>
                        <td className="px-2.5 py-2.5 text-[10px]">
                          {operationalStatusLabel(row.operationalStatus)}
                        </td>
                      </>
                    ) : null}
                    <td className="px-2.5 py-2.5">
                      {tags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex max-w-[180px] flex-wrap gap-1">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded border border-orange-200/70 bg-orange-50/80 px-1 py-0.5 text-[9px] font-medium text-orange-950"
                              title={tag}
                            >
                              {TAG_LABEL[tag] ?? tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    {showFulfillmentCols ? (
                      <>
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
                        <td className="px-2.5 py-2.5 text-right tabular-nums">
                          {row.valueOutsideOrder != null
                            ? formatFinanceCurrency(row.valueOutsideOrder)
                            : "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="px-2.5 py-2.5">
                      <span
                        className={cn(
                          "inline-flex max-w-[9rem] flex-col rounded-md border px-1.5 py-0.5",
                          conf.className
                        )}
                        title={conf.hint}
                      >
                        <span className="text-[10px] font-semibold leading-tight">{conf.label}</span>
                        <span className="text-[9px] tabular-nums opacity-80">
                          {row.confidenceScore}
                        </span>
                      </span>
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div className="max-w-[220px] truncate text-muted-foreground" title={row.mainReason}>
                        {row.mainReason}
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div
                        className="max-w-[180px] truncate text-muted-foreground"
                        title={row.recommendedAction}
                      >
                        {row.recommendedAction}
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums">
                      {row.externalSalesOrderId != null ? row.externalSalesOrderId : "—"}
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums">
                      {row.productExternalIds[0] != null ? row.productExternalIds[0] : "—"}
                    </td>
                    <td className="px-2.5 py-2.5">{yesNo(row.evidenceFlags?.hasNfe)}</td>
                    <td className="px-2.5 py-2.5">{yesNo(row.evidenceFlags?.hasStockDocument)}</td>
                    <td className="px-2.5 py-2.5">{yesNo(row.evidenceFlags?.hasReceivable)}</td>
                    <td className="px-2.5 py-2.5">{yesNo(row.evidenceFlags?.hasReceived)}</td>
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
