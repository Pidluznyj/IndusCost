import "./sales-order-detail-view.css";

import React from "react";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { salesOrderBillingStatusBadgeClass } from "@/src/lib/sales/salesOrderListBillingStatus";
import type {
  SalesOrderDetailPayload,
  SalesOrderDetailItem,
  SalesOrderDetailAlert,
} from "@/src/lib/sales-orders/salesOrderDetailClient";
import { cn } from "@/src/lib/utils";

type Props = {
  payload: SalesOrderDetailPayload;
  className?: string;
};

/**
 * Componente compartilhado de visualização do detalhe do Pedido de Venda.
 * Usado por:
 *   - Modal `SalesOrderDetailDialog` (visão executiva grande)
 *   - Impressão/PDF (mesma composição via `window.print()`)
 *
 * Não faz fetch — recebe o DTO oficial pronto.
 */
export function SalesOrderDetailView({ payload, className }: Props): JSX.Element {
  const { header, summary, items, invoices, stockDocuments, financial, pricingMargin, alerts } =
    payload;

  return (
    <div
      className={cn("so-detail-view", className)}
      data-testid="sales-order-detail-view"
    >
      {/* 1 — Cabeçalho institucional/comercial */}
      <section
        className="so-detail-section"
        data-testid="sales-order-detail-header"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="so-detail-section-subtitle">
              Pedido de Venda Nomus · {header.customerName}
              {header.issueDate ? ` · ${formatFinanceDate(header.issueDate)}` : ""}
            </p>
            <h2 className="text-lg font-bold text-[#0f172a]">
              Detalhe do Pedido — {payload.orderCode}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "so-detail-badge",
                salesOrderBillingStatusBadgeClass(header.billingStatus)
                  .replace("so-billing-badge", "so-detail-badge")
                  .replace("--not-invoiced", "--not-invoiced")
              )}
              data-testid="sales-order-detail-billing-status"
            >
              {header.billingStatusLabel}
            </span>
            <span className="so-detail-badge so-detail-badge--muted">
              {header.statusLabel}
            </span>
          </div>
        </div>

        <div className="so-detail-header-grid mt-3">
          <HeaderField label="Cliente" value={displayFinanceText(header.customerName)} />
          <HeaderField label="CNPJ" value={header.customerCnpj ?? "—"} />
          <HeaderField label="Empresa" value={header.companyName ?? "—"} />
          <HeaderField label="Vendedor do pedido" value={header.sellerName} />
          <HeaderField
            label="Responsável comercial"
            value={header.commercialResponsibleName ?? "—"}
          />
          <HeaderField
            label="Responsável operacional"
            value={header.operationalResponsibleName ?? "—"}
          />
          <HeaderField
            label="Data de emissão"
            value={header.issueDate ? formatFinanceDate(header.issueDate) : "—"}
          />
          <HeaderField
            label="Data de entrega"
            value={
              header.expectedDeliveryDate
                ? formatFinanceDate(header.expectedDeliveryDate)
                : "—"
            }
          />
          <HeaderField label="ID Nomus" value={header.externalSalesOrderCode ?? "—"} />
          <HeaderField
            label="Condição de pagamento"
            value={header.paymentConditionLabel}
          />
          <HeaderField label="Forma de pagamento" value={header.paymentMethodLabel} />
          <HeaderField
            label="Frete"
            value={header.freightCondition ?? "—"}
          />
        </div>
      </section>

      {/* 2 — Cards de resumo */}
      <section className="so-detail-section" data-testid="sales-order-detail-summary">
        <h3 className="so-detail-section-title">Resumo executivo</h3>
        <div className="so-detail-kpi-grid">
          <Kpi label="Valor pedido" value={formatFinanceCurrency(summary.originalValue)} />
          <Kpi
            label="Valor ativo"
            value={formatFinanceCurrency(summary.activeValue)}
            tone="positive"
          />
          <Kpi
            label="Valor cancelado"
            value={formatFinanceCurrency(summary.canceledValue)}
            tone={summary.canceledValue > 0.009 ? "risk" : "muted"}
          />
          <Kpi
            label="Valor faturado"
            value={formatFinanceCurrency(summary.invoicedValue)}
            tone={summary.invoicedValue > 0.009 ? "info" : "muted"}
          />
          <Kpi
            label="Saldo pendente"
            value={formatFinanceCurrency(summary.pendingBalance)}
            tone={summary.pendingBalance > 0.009 ? "warning" : "muted"}
          />
          <Kpi
            label="Itens (ativos/canc.)"
            value={`${formatFinanceInteger(summary.activeItemsCount)} / ${formatFinanceInteger(summary.canceledItemsCount)}`}
          />
          <Kpi
            label="Margem R$"
            value={
              summary.marginValue != null
                ? formatFinanceCurrency(summary.marginValue)
                : "—"
            }
            tone={(summary.marginValue ?? 0) < 0 ? "risk" : "positive"}
          />
          <Kpi
            label="Margem %"
            value={
              summary.marginPercent != null
                ? `${summary.marginPercent.toLocaleString("pt-BR", {
                    maximumFractionDigits: 2,
                  })}%`
                : "—"
            }
          />
          <Kpi
            label="Status faturamento"
            value={header.billingStatusLabel}
            tone={
              header.billingStatus === "INVOICED"
                ? "positive"
                : header.billingStatus === "CANCELED"
                  ? "risk"
                  : header.billingStatus === "PARTIALLY_INVOICED"
                    ? "warning"
                    : "muted"
            }
          />
          <Kpi
            label="Última NF"
            value={summary.lastNfeDate ? formatFinanceDate(summary.lastNfeDate) : "—"}
          />
        </div>
      </section>

      {/* 3 — Itens do pedido */}
      <section className="so-detail-section" data-testid="sales-order-detail-items">
        <h3 className="so-detail-section-title">Itens do pedido</h3>
        {items.length === 0 ? (
          <div className="so-detail-empty">Nenhum item encontrado.</div>
        ) : (
          <div className="so-detail-scroll">
            <table
              className="so-detail-table"
              data-testid="sales-order-detail-items-table"
            >
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th>Descrição</th>
                  <th>Un.</th>
                  <th className="so-detail-num">Qtd pedida</th>
                  <th className="so-detail-num">Qtd atendida</th>
                  <th className="so-detail-num">Qtd pendente</th>
                  <th className="so-detail-num">Qtd cancelada</th>
                  <th>Status</th>
                  <th className="so-detail-num">Preço unit.</th>
                  <th className="so-detail-num">Valor total</th>
                  <th className="so-detail-num">Valor ativo</th>
                  <th className="so-detail-num">Custo unit.</th>
                  <th className="so-detail-num">Margem R$</th>
                  <th className="so-detail-num">Margem %</th>
                  <th>Entrega</th>
                  <th>NF/documento</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <ItemRow key={item.salesOrderItemId} item={item} index={index + 1} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="so-detail-num">
                    {formatFinanceInteger(summary.itemsCount)}
                  </td>
                  <td colSpan={5} />
                  <td className="so-detail-money">
                    {formatFinanceCurrency(summary.originalValue)}
                  </td>
                  <td className="so-detail-money">
                    {formatFinanceCurrency(summary.originalValue)}
                  </td>
                  <td className="so-detail-money">
                    {formatFinanceCurrency(summary.activeValue)}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* 4 — Faturamento / NF */}
      <section className="so-detail-section" data-testid="sales-order-detail-invoices">
        <h3 className="so-detail-section-title">Faturamento</h3>
        <p className="so-detail-section-subtitle">
          NF emitida: <strong>{summary.hasInvoice ? "Sim" : "Não"}</strong>
          {summary.hasInvoice
            ? ` · ${formatFinanceInteger(summary.nfeCount)} NF-e vinculada(s)`
            : ""}
        </p>
        {invoices.length === 0 ? (
          <div className="so-detail-empty">
            Este pedido ainda não possui NF vinculada.
          </div>
        ) : (
          <div className="so-detail-scroll">
            <table className="so-detail-table">
              <thead>
                <tr>
                  <th>NF-e</th>
                  <th>Série</th>
                  <th>Emissão</th>
                  <th>Processamento</th>
                  <th className="so-detail-num">Valor NF</th>
                  <th className="so-detail-num">Valor atribuído ao pedido</th>
                  <th>Documento saída</th>
                  <th>Chave</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((nf) => (
                  <tr key={nf.nfeExternalId}>
                    <td className="font-semibold">{nf.numero ?? nf.nfeExternalId}</td>
                    <td>{nf.serie ?? "—"}</td>
                    <td>{nf.dataEmissao ? formatFinanceDate(nf.dataEmissao) : "—"}</td>
                    <td>
                      {nf.dataProcessamento ? formatFinanceDate(nf.dataProcessamento) : "—"}
                    </td>
                    <td className="so-detail-money">
                      {formatFinanceCurrency(nf.valorTotal ?? nf.valorLiquido ?? 0)}
                    </td>
                    <td className="so-detail-money">
                      {formatFinanceCurrency(nf.allocatedValueToOrder)}
                    </td>
                    <td>
                      {nf.linkedStockDocumentExternalIds.length > 0
                        ? nf.linkedStockDocumentExternalIds.join(", ")
                        : "—"}
                    </td>
                    <td className="text-[10px] text-[#6b7280]">
                      {nf.chave ? `${nf.chave.slice(0, 14)}…` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {stockDocuments.length > 0 ? (
          <>
            <h4
              className="so-detail-section-title mt-3"
              style={{ fontSize: 10, color: "#334155" }}
            >
              Documentos de saída vinculados
            </h4>
            <div className="so-detail-scroll">
              <table className="so-detail-table">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Data</th>
                    <th className="so-detail-num">Valor doc.</th>
                    <th className="so-detail-num">Alocado ao pedido</th>
                    <th>NF vinculada</th>
                    <th>Sinal</th>
                  </tr>
                </thead>
                <tbody>
                  {stockDocuments.map((doc) => (
                    <tr key={doc.stockDocumentExternalId}>
                      <td className="font-semibold">
                        {doc.numero ?? doc.stockDocumentExternalId}
                      </td>
                      <td>{doc.dataDocumento ? formatFinanceDate(doc.dataDocumento) : "—"}</td>
                      <td className="so-detail-money">
                        {formatFinanceCurrency(doc.valorTotal ?? 0)}
                      </td>
                      <td className="so-detail-money">
                        {formatFinanceCurrency(doc.allocatedValueToOrder)}
                      </td>
                      <td>{doc.idNfe ?? "—"}</td>
                      <td>
                        {doc.hasExcess ? (
                          <span className="so-detail-badge so-detail-badge--warning">
                            Excedente
                          </span>
                        ) : doc.hasOutside ? (
                          <span className="so-detail-badge so-detail-badge--risk">
                            Produto fora
                          </span>
                        ) : (
                          <span className="so-detail-badge so-detail-badge--muted">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {/* 5 — Financeiro (CR real + planejado) */}
      <section className="so-detail-section" data-testid="sales-order-detail-financial">
        <h3 className="so-detail-section-title">Financeiro</h3>
        <p className="so-detail-section-subtitle">
          Contas a Receber oficial + Recebíveis planejados pelo pedido. CR real prevalece.
        </p>
        <div className="so-detail-kpi-grid" style={{ marginBottom: 8 }}>
          <Kpi
            label="CR real total"
            value={formatFinanceCurrency(financial.totals.totalAmount)}
            tone={financial.totals.totalAmount > 0.009 ? "positive" : "muted"}
          />
          <Kpi
            label="CR aberto"
            value={formatFinanceCurrency(financial.totals.openAmount)}
            tone={financial.totals.openAmount > 0.009 ? "warning" : "muted"}
          />
          <Kpi
            label="CR recebido"
            value={formatFinanceCurrency(financial.totals.receivedAmount)}
            tone={financial.totals.receivedAmount > 0.009 ? "positive" : "muted"}
          />
          <Kpi
            label="Planejado pelo pedido"
            value={formatFinanceCurrency(financial.plannedTotals.totalExpected)}
            tone={financial.plannedTotals.totalExpected > 0.009 ? "info" : "muted"}
          />
          <Kpi
            label="Próximo vencimento"
            value={
              (financial.totals.nextDueDate || financial.plannedTotals.nextDueDate) &&
              formatFinanceDate(
                financial.totals.nextDueDate ?? financial.plannedTotals.nextDueDate ?? ""
              )
            }
          />
        </div>

        {financial.realReceivables.length === 0 &&
        financial.plannedReceivables.length === 0 ? (
          <div className="so-detail-empty">
            Sem CR real e sem recebível planejado para este pedido.
          </div>
        ) : (
          <div className="so-detail-scroll">
            <table className="so-detail-table">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Referência</th>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th className="so-detail-num">Valor</th>
                  <th className="so-detail-num">Aberto</th>
                  <th className="so-detail-num">Recebido</th>
                  <th>Status</th>
                  <th>NF emitida</th>
                </tr>
              </thead>
              <tbody>
                {financial.realReceivables.map((cr) => (
                  <tr key={`real-${cr.receivableExternalId}`}>
                    <td>
                      <span className="so-detail-badge so-detail-badge--invoiced">CR real</span>
                    </td>
                    <td className="font-semibold">{cr.searchReference}</td>
                    <td>
                      {cr.installmentNumber != null && cr.totalInstallments != null
                        ? `${cr.installmentNumber}/${cr.totalInstallments}`
                        : cr.installmentNumber != null
                          ? String(cr.installmentNumber)
                          : "—"}
                    </td>
                    <td>{cr.dueDate ? formatFinanceDate(cr.dueDate) : "—"}</td>
                    <td className="so-detail-money">
                      {formatFinanceCurrency(cr.amountReceivable ?? 0)}
                    </td>
                    <td className="so-detail-money">
                      {formatFinanceCurrency(cr.balanceReceivable ?? 0)}
                    </td>
                    <td className="so-detail-money so-detail-money--positive">
                      {formatFinanceCurrency(cr.amountReceived ?? 0)}
                    </td>
                    <td>
                      <span
                        className={cn(
                          "so-detail-badge",
                          cr.status === "RECEIVED"
                            ? "so-detail-badge--invoiced"
                            : cr.status === "OVERDUE"
                              ? "so-detail-badge--risk"
                              : cr.status === "PARTIALLY_RECEIVED"
                                ? "so-detail-badge--info"
                                : "so-detail-badge--warning"
                        )}
                      >
                        {formatReceivableStatus(cr.status)}
                      </span>
                    </td>
                    <td>{cr.sourceInvoiceNumber ? "Sim" : "—"}</td>
                  </tr>
                ))}
                {financial.plannedReceivables.map((p) => (
                  <tr key={`planned-${p.key}`}>
                    <td>
                      <span className="so-detail-badge so-detail-badge--info">
                        Planejado pelo pedido
                      </span>
                    </td>
                    <td className="font-semibold">{p.reference}</td>
                    <td>{`${p.installmentNumber}/${p.totalInstallments}`}</td>
                    <td>{p.dueDate ? formatFinanceDate(p.dueDate) : "—"}</td>
                    <td className="so-detail-money">
                      {formatFinanceCurrency(p.expectedAmount)}
                    </td>
                    <td className="so-detail-money">
                      {formatFinanceCurrency(p.openAmount)}
                    </td>
                    <td className="so-detail-money">{formatFinanceCurrency(0)}</td>
                    <td>
                      <span
                        className={cn(
                          "so-detail-badge",
                          p.statusLabel === "Vencido"
                            ? "so-detail-badge--risk"
                            : p.statusLabel === "Vence hoje"
                              ? "so-detail-badge--warning"
                              : "so-detail-badge--info"
                        )}
                      >
                        {p.statusLabel}
                      </span>
                    </td>
                    <td>Não</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 6 — Margem, preço e custo */}
      <section className="so-detail-section" data-testid="sales-order-detail-pricing-margin">
        <h3 className="so-detail-section-title">Margem, preço e custo</h3>
        <p className="so-detail-section-subtitle">
          Fonte: {pricingMargin.source}
        </p>
        <div className="so-detail-kpi-grid">
          <Kpi label="Valor vendido" value={formatFinanceCurrency(pricingMargin.valueSold)} />
          <Kpi
            label="Valor ativo"
            value={formatFinanceCurrency(pricingMargin.valueActive)}
            tone="positive"
          />
          <Kpi
            label="Custo total"
            value={
              pricingMargin.totalCost != null
                ? formatFinanceCurrency(pricingMargin.totalCost)
                : "—"
            }
          />
          <Kpi
            label="Margem R$"
            value={
              pricingMargin.marginValue != null
                ? formatFinanceCurrency(pricingMargin.marginValue)
                : "—"
            }
            tone={(pricingMargin.marginValue ?? 0) < 0 ? "risk" : "positive"}
          />
          <Kpi
            label="Margem %"
            value={
              pricingMargin.marginPercent != null
                ? `${pricingMargin.marginPercent.toLocaleString("pt-BR", {
                    maximumFractionDigits: 2,
                  })}%`
                : "—"
            }
          />
          <Kpi
            label="Itens sem margem"
            value={formatFinanceInteger(pricingMargin.itemsWithoutMargin)}
            tone={pricingMargin.itemsWithoutMargin > 0 ? "warning" : "muted"}
          />
          <Kpi
            label="Itens ignorados"
            value={formatFinanceInteger(pricingMargin.itemsIgnored)}
          />
          <Kpi
            label="Δ pedido × tabela"
            value={
              pricingMargin.priceTableDiff != null
                ? formatFinanceCurrency(pricingMargin.priceTableDiff)
                : "—"
            }
          />
          <Kpi
            label="Δ pedido × documento"
            value={
              pricingMargin.orderVsDocumentDiff != null
                ? formatFinanceCurrency(pricingMargin.orderVsDocumentDiff)
                : "—"
            }
          />
        </div>
      </section>

      {/* 7 — Alertas */}
      <section className="so-detail-section" data-testid="sales-order-detail-alerts">
        <h3 className="so-detail-section-title">
          Alertas e divergências ({alerts.length})
        </h3>
        {alerts.length === 0 ? (
          <div className="so-detail-empty">
            Nenhuma divergência oficial identificada para este pedido.
          </div>
        ) : (
          <div className="so-detail-alert-list">
            {alerts.map((alert, idx) => (
              <AlertCard key={`${alert.code}-${idx}`} alert={alert} />
            ))}
          </div>
        )}
      </section>

      {/* 8 — Observações */}
      {header.notes ? (
        <section className="so-detail-section" data-testid="sales-order-detail-notes">
          <h3 className="so-detail-section-title">Observações</h3>
          <p className="text-[12px] whitespace-pre-wrap text-[#334155]">{header.notes}</p>
        </section>
      ) : null}

      {/* Rodapé técnico */}
      <p className="text-[10px] text-[#6b7280] text-center mt-1">
        Documento gerado pelo IndusCost · {formatFinanceDateTime(payload.generatedAt)} · Origem:
        Pedido de Venda Nomus
      </p>
    </div>
  );
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div className="so-detail-header-field">
      <p className="so-detail-header-label">{label}</p>
      <p className="so-detail-header-value">{value}</p>
    </div>
  );
}

type KpiTone = "muted" | "positive" | "warning" | "risk" | "info";

function Kpi({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string | null | undefined;
  tone?: KpiTone;
}) {
  const cls =
    tone === "positive"
      ? "so-detail-kpi--positive"
      : tone === "warning"
        ? "so-detail-kpi--warning"
        : tone === "risk"
          ? "so-detail-kpi--risk"
          : tone === "info"
            ? "so-detail-kpi--info"
            : "";
  return (
    <div className={cn("so-detail-kpi", cls)}>
      <p className="so-detail-kpi-label">{label}</p>
      <p className="so-detail-kpi-value">{value ?? "—"}</p>
    </div>
  );
}

function ItemRow({
  item,
  index,
}: {
  item: SalesOrderDetailItem;
  index: number;
}): JSX.Element {
  const statusBadge = item.isCanceled
    ? "so-detail-badge--canceled"
    : item.isCut
      ? "so-detail-badge--warning"
      : item.isStale
        ? "so-detail-badge--muted"
        : item.statusNormalized === "FULFILLED"
          ? "so-detail-badge--invoiced"
          : "so-detail-badge--info";
  const marginTone = (item.marginValue ?? 0) < 0 ? "so-detail-money--risk" : "";
  return (
    <tr>
      <td className="so-detail-num">{item.itemSequence ?? index}</td>
      <td className="font-mono text-[10px]">{item.sku}</td>
      <td className="max-w-[220px] truncate" title={item.productName}>
        {item.productName}
      </td>
      <td>{item.unit ?? "—"}</td>
      <td className="so-detail-num">
        {item.quantityOrdered.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
      </td>
      <td className="so-detail-num">
        {item.quantityFulfilled.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
      </td>
      <td className="so-detail-num">
        {item.quantityPending.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
      </td>
      <td className="so-detail-num">
        {item.quantityCanceled.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
      </td>
      <td>
        <span className={cn("so-detail-badge", statusBadge)}>{item.statusLabel}</span>
      </td>
      <td className="so-detail-money">{formatFinanceCurrency(item.unitPrice)}</td>
      <td className="so-detail-money">{formatFinanceCurrency(item.totalValue)}</td>
      <td className="so-detail-money">{formatFinanceCurrency(item.activeValue)}</td>
      <td className="so-detail-money">
        {item.unitCost != null ? formatFinanceCurrency(item.unitCost) : "—"}
      </td>
      <td className={cn("so-detail-money", marginTone)}>
        {item.marginValue != null ? formatFinanceCurrency(item.marginValue) : "—"}
      </td>
      <td className="so-detail-num">
        {item.marginPercent != null
          ? `${item.marginPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
          : "—"}
      </td>
      <td>
        {item.expectedDeliveryDate ? formatFinanceDate(item.expectedDeliveryDate) : "—"}
      </td>
      <td className="text-[10px]">
        {item.linkedNfes.length > 0
          ? item.linkedNfes
              .map((n) => n.nfeNumber ?? n.nfeExternalId)
              .filter(Boolean)
              .join(", ")
          : "—"}
      </td>
    </tr>
  );
}

function AlertCard({ alert }: { alert: SalesOrderDetailAlert }): JSX.Element {
  const severity =
    alert.severity === "critical"
      ? "so-detail-alert--critical"
      : alert.severity === "warning" || alert.severity === "high"
        ? "so-detail-alert--warning"
        : "so-detail-alert--info";
  return (
    <div className={cn("so-detail-alert", severity)}>
      <p className="so-detail-alert-code">
        {alert.code} · {alert.severity}
      </p>
      <p className="so-detail-alert-title">{alert.title}</p>
      <p className="so-detail-alert-description">{alert.description}</p>
      {alert.action ? (
        <p className="text-[10px] text-[#475569]">
          <strong>Ação sugerida:</strong> {alert.action}
        </p>
      ) : null}
      {alert.financialImpact != null && alert.financialImpact !== 0 ? (
        <p className="text-[10px] text-[#475569]">
          <strong>Impacto financeiro:</strong>{" "}
          {formatFinanceCurrency(alert.financialImpact)}
        </p>
      ) : null}
    </div>
  );
}

function formatReceivableStatus(status: string): string {
  switch (status) {
    case "RECEIVED":
      return "Recebido";
    case "PARTIALLY_RECEIVED":
      return "Parcial";
    case "OVERDUE":
      return "Vencido";
    case "OPEN":
      return "Em aberto";
    default:
      return status;
  }
}
