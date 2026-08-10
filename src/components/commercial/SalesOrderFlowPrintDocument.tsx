import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  SALES_ORDER_REPORT_PRINT_FOOTER_NOTE,
} from "@/src/lib/sales/salesOrderReportPrintMeta";
import type { SalesOrderFlowKanbanColumnView } from "@/src/components/commercial/SalesOrderFlowKanbanBoard";

export function SalesOrderFlowPrintDocument({
  columns,
  branding,
  generatedAt,
  valuesVisible,
}: {
  columns: readonly SalesOrderFlowKanbanColumnView[];
  branding: BrandingSettingsDTO;
  generatedAt: string;
  valuesVisible: boolean;
}) {
  const totalOrders = columns.reduce((acc, col) => acc + (col.cards?.length || 0), 0);

  return (
    <div id="sales-orders-print-root">
      <div className="sales-orders-print-document">
        <header className="sales-orders-print-cover-header" style={{ marginBottom: '2rem' }}>
          <h1 className="sales-orders-print-cover-title">
            Kanban — Fluxo de Pedidos
          </h1>
          <p className="sales-orders-print-cover-subtitle">
            Exportação do funil operacional
          </p>
        </header>

        <section className="sales-orders-print-section sales-orders-print-section--detail">
          <h2 className="sales-orders-print-section-title">
            Detalhamento Analítico ({formatFinanceInteger(totalOrders)} pedidos)
          </h2>

          {columns.length === 0 || totalOrders === 0 ? (
            <p className="sales-orders-print-empty">
              Nenhum pedido encontrado no fluxo atual.
            </p>
          ) : (
            columns.map((column) => {
              if (column.cards.length === 0) return null;
              
              return (
                <div key={column.stage} style={{ marginBottom: '2rem', pageBreakInside: 'avoid' }}>
                  <h3 style={{ 
                    fontSize: '14px', 
                    fontWeight: 600, 
                    color: '#334155', 
                    marginBottom: '0.5rem',
                    borderBottom: '2px solid #e2e8f0',
                    paddingBottom: '0.25rem'
                  }}>
                    {column.label} ({column.cards.length} pedidos)
                  </h3>
                  
                  <table className="sales-orders-print-data-table">
                    <thead>
                      <tr>
                        <th className="col-order">Pedido</th>
                        <th className="col-client">Cliente</th>
                        <th className="col-date">Entrega</th>
                        <th className="col-money">Valor</th>
                        <th className="col-client" style={{ width: '25%' }}>Aqui porque</th>
                        <th className="col-client" style={{ width: '25%' }}>Para sair</th>
                      </tr>
                    </thead>
                    <tbody>
                      {column.cards.map((card) => (
                        <tr key={card.orderId}>
                          <td className="col-order">
                            <span className="sales-orders-print-order-code">
                              {card.orderCode}
                            </span>
                            {card.isOverdue && (
                              <span style={{ 
                                display: 'inline-block', 
                                marginLeft: '4px',
                                color: '#b91c1c', 
                                fontSize: '9px',
                                fontWeight: 'bold' 
                              }}>
                                (ATRASADO)
                              </span>
                            )}
                          </td>
                          <td className="col-client">
                            <span className="sales-orders-print-client-text">
                              {displayFinanceText(card.customerName || "Não informado")}
                            </span>
                          </td>
                          <td className="col-date">
                            {card.promisedDeliveryAt ? formatFinanceDate(card.promisedDeliveryAt) : "—"}
                          </td>
                          <td className="col-money">
                            {valuesVisible ? (card.orderValue != null ? formatFinanceCurrency(card.orderValue) : "—") : "Oculto"}
                          </td>
                          <td className="col-client">
                            <span style={{ fontSize: '10px', color: '#475569' }}>
                              {card.stayReason}
                            </span>
                          </td>
                          <td className="col-client">
                            <span style={{ fontSize: '10px', color: '#0369a1' }}>
                              {card.missingToLeave?.trim() || card.nextAction?.trim() || "Sem ação definida"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </section>

        <footer className="sales-orders-print-footer" style={{ marginTop: '3rem' }}>
          <p>{SALES_ORDER_REPORT_PRINT_FOOTER_NOTE}</p>
          <p>{formatFinanceDateTime(generatedAt)}</p>
        </footer>
      </div>
    </div>
  );
}
