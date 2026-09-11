import React from "react";
import { cn } from "@/src/lib/utils";
import {
  formatCrmReportsAverageDays,
  formatCrmReportsDate,
  formatCrmReportsDays,
  formatCrmReportsInteger,
  formatCrmReportsMoney,
} from "@/src/lib/commercial/crmReportsFormat";
import { crmReportsChipFromRow, type CrmReportsCustomerChip } from "@/src/lib/commercial/crmReportsUiState";
import type { CrmReportsExportFormatChoice } from "@/src/lib/commercial/crmReportsClient";
import type { CrmReportsPage, CrmReportsRecent60dRow } from "@/src/lib/commercial/crmReportsTypes";
import {
  CRM_REPORTS_HEAD_ROW,
  CRM_REPORTS_STICKY_ACTIONS,
  CRM_REPORTS_TD,
  CRM_REPORTS_TD_NUM,
  CRM_REPORTS_TH,
  CRM_REPORTS_TH_RIGHT,
  CrmReportsCustomerCell,
  CrmReportsEmptyRows,
  CrmReportsExportButtons,
  CrmReportsLastOrderSellerCell,
  CrmReportsListShell,
  CrmReportsOwnerCell,
  CrmReportsPageCheckbox,
  CrmReportsPagination,
  CrmReportsRowActions,
  CrmReportsRowCheckbox,
  CrmRepurchaseStatusBadge,
  crmReportsBodyRowClass,
  type CrmReportsRowActionHandlers,
} from "./CrmReportsShared";

export type CrmRecentCustomersTableProps = {
  page: CrmReportsPage<CrmReportsRecent60dRow>;
  refreshing: boolean;
  filtered: boolean;
  checked: ReadonlyMap<string, CrmReportsCustomerChip>;
  onToggleChecked: (chip: CrmReportsCustomerChip) => void;
  onToggleManyChecked: (chips: CrmReportsCustomerChip[], on: boolean) => void;
  onPageChange: (offset: number) => void;
  actions: CrmReportsRowActionHandlers;
  exporting: CrmReportsExportFormatChoice | null;
  onExport: (format: CrmReportsExportFormatChoice) => void;
};

const COLUMN_COUNT = 13;

/** Lista 1 — última compra (Pedido de Venda) nos últimos 60 dias. */
export function CrmRecentCustomersTable({
  page,
  refreshing,
  filtered,
  checked,
  onToggleChecked,
  onToggleManyChecked,
  onPageChange,
  actions,
  exporting,
  onExport,
}: CrmRecentCustomersTableProps) {
  return (
    <CrmReportsListShell
      id="crm-reports-list-recent"
      title="Compraram nos últimos 60 dias"
      description="Clientes cuja última compra (emissão do Pedido de Venda) caiu nos últimos 60 dias. Mais recentes primeiro."
      total={page.total}
      refreshing={refreshing}
      toolbar={<CrmReportsExportButtons busy={exporting} disabled={page.total === 0} onExport={onExport} />}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className={CRM_REPORTS_HEAD_ROW}>
              <th className={cn(CRM_REPORTS_TH, "w-10")}>
                <CrmReportsPageCheckbox
                  page={page}
                  chipOf={crmReportsChipFromRow}
                  checked={checked}
                  onToggleMany={onToggleManyChecked}
                />
              </th>
              <th className={CRM_REPORTS_TH}>Cliente</th>
              <th className={CRM_REPORTS_TH}>Responsável Comercial</th>
              <th className={CRM_REPORTS_TH}>Vendedor do último pedido</th>
              <th className={CRM_REPORTS_TH}>Última compra</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Dias sem comprar</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Pedidos 60d</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Venda 60d</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Ticket médio</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Tempo médio de recompra</th>
              <th className={CRM_REPORTS_TH}>Próxima compra esperada</th>
              <th className={CRM_REPORTS_TH}>Situação</th>
              <th className={cn(CRM_REPORTS_TH, CRM_REPORTS_STICKY_ACTIONS)}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {page.returned === 0 ? (
              <CrmReportsEmptyRows colSpan={COLUMN_COUNT} filtered={filtered} />
            ) : (
              page.rows.map((row) => {
                const chip = crmReportsChipFromRow(row);
                const isChecked = checked.has(row.customerId);
                return (
                  <tr
                    key={row.customerId}
                    className={crmReportsBodyRowClass(isChecked)}
                  >
                    <td className={CRM_REPORTS_TD}>
                      <CrmReportsRowCheckbox
                        checked={isChecked}
                        label={`Marcar ${row.displayName}`}
                        onChange={() => onToggleChecked(chip)}
                      />
                    </td>
                    <td className={CRM_REPORTS_TD}>
                      <CrmReportsCustomerCell row={row} canOpenCustomer360={actions.canOpenCustomer360} />
                    </td>
                    <td className={CRM_REPORTS_TD}>
                      <CrmReportsOwnerCell name={row.commercialOwnerName} />
                    </td>
                    <td className={CRM_REPORTS_TD}>
                      <CrmReportsLastOrderSellerCell row={row} />
                    </td>
                    <td className={cn(CRM_REPORTS_TD, "whitespace-nowrap tabular-nums")}>
                      {formatCrmReportsDate(row.lastPurchaseDate)}
                    </td>
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmReportsDays(row.daysSinceLastPurchase)}</td>
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmReportsInteger(row.orders60d)}</td>
                    <td className={cn(CRM_REPORTS_TD_NUM, "font-semibold text-foreground")}>
                      {formatCrmReportsMoney(row.purchaseValue60d)}
                    </td>
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmReportsMoney(row.averageTicket60d)}</td>
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmReportsAverageDays(row.averageRepurchaseDays)}</td>
                    <td className={cn(CRM_REPORTS_TD, "whitespace-nowrap tabular-nums")}>
                      {formatCrmReportsDate(row.expectedRepurchaseDate)}
                    </td>
                    <td className={CRM_REPORTS_TD}>
                      <CrmRepurchaseStatusBadge status={row.repurchaseStatus} deltaDays={row.deltaDays} />
                    </td>
                    <td className={cn(CRM_REPORTS_TD, CRM_REPORTS_STICKY_ACTIONS)}>
                      <CrmReportsRowActions row={row} actions={actions} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <CrmReportsPagination page={page} disabled={refreshing} onChange={onPageChange} />
    </CrmReportsListShell>
  );
}
