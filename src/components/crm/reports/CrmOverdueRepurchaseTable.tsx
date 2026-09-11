import React from "react";
import { cn } from "@/src/lib/utils";
import {
  formatCrmReportsAverageDays,
  formatCrmReportsDate,
  formatCrmReportsDateTime,
  formatCrmReportsInteger,
  formatCrmReportsMoney,
} from "@/src/lib/commercial/crmReportsFormat";
import {
  CRM_REPORTS_OVERDUE_SEVERITY_LABELS,
  CRM_REPORTS_OVERDUE_SORT_LABELS,
} from "@/src/lib/commercial/crmReportsLabels";
import { crmReportsChipFromRow, type CrmReportsCustomerChip } from "@/src/lib/commercial/crmReportsUiState";
import type { CrmReportsExportFormatChoice } from "@/src/lib/commercial/crmReportsClient";
import {
  CRM_REPORTS_OVERDUE_SEVERITIES,
  CRM_REPORTS_OVERDUE_SORTS,
  type CrmReportsOverdueRow,
  type CrmReportsOverdueSeverity,
  type CrmReportsOverdueSort,
  type CrmReportsPage,
} from "@/src/lib/commercial/crmReportsTypes";
import {
  CRM_REPORTS_TD,
  CRM_REPORTS_TD_NUM,
  CRM_REPORTS_TH,
  CRM_REPORTS_TH_RIGHT,
  CrmCadenceConfidenceBadge,
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
  type CrmReportsRowActionHandlers,
} from "./CrmReportsShared";

export type CrmOverdueRepurchaseTableProps = {
  page: CrmReportsPage<CrmReportsOverdueRow>;
  refreshing: boolean;
  filtered: boolean;
  severity: CrmReportsOverdueSeverity;
  sort: CrmReportsOverdueSort;
  onSeverityChange: (severity: CrmReportsOverdueSeverity) => void;
  onSortChange: (sort: CrmReportsOverdueSort) => void;
  checked: ReadonlyMap<string, CrmReportsCustomerChip>;
  onToggleChecked: (chip: CrmReportsCustomerChip) => void;
  onToggleManyChecked: (chips: CrmReportsCustomerChip[], on: boolean) => void;
  onPageChange: (offset: number) => void;
  actions: CrmReportsRowActionHandlers;
  exporting: CrmReportsExportFormatChoice | null;
  onExport: (format: CrmReportsExportFormatChoice) => void;
};

const COLUMN_COUNT = 16;

function OverdueControls({
  severity,
  sort,
  onSeverityChange,
  onSortChange,
  disabled,
}: Pick<CrmOverdueRepurchaseTableProps, "severity" | "sort" | "onSeverityChange" | "onSortChange"> & {
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1.5" role="group" aria-label="Recorte da lista">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recorte</span>
        {CRM_REPORTS_OVERDUE_SEVERITIES.map((value) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={severity === value}
            onClick={() => onSeverityChange(value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
              severity === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {CRM_REPORTS_OVERDUE_SEVERITY_LABELS[value]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ordenar</span>
        <select
          value={sort}
          disabled={disabled}
          onChange={(e) => onSortChange(e.target.value as CrmReportsOverdueSort)}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {CRM_REPORTS_OVERDUE_SORTS.map((value) => (
            <option key={value} value={value}>
              {CRM_REPORTS_OVERDUE_SORT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Lista 3 — passaram da data esperada de recompra (motor), com relacionamento. */
export function CrmOverdueRepurchaseTable({
  page,
  refreshing,
  filtered,
  severity,
  sort,
  onSeverityChange,
  onSortChange,
  checked,
  onToggleChecked,
  onToggleManyChecked,
  onPageChange,
  actions,
  exporting,
  onExport,
}: CrmOverdueRepurchaseTableProps) {
  return (
    <CrmReportsListShell
      id="crm-reports-list-overdue"
      title="Atrasados para recompra"
      description="Clientes que passaram da data esperada de recompra. Contato e follow-up vêm das atividades comerciais (não criam compra)."
      total={page.total}
      refreshing={refreshing}
      toolbar={<CrmReportsExportButtons busy={exporting} disabled={page.total === 0} onExport={onExport} />}
      controls={
        <OverdueControls
          severity={severity}
          sort={sort}
          onSeverityChange={onSeverityChange}
          onSortChange={onSortChange}
          disabled={refreshing}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1760px] text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20">
              <th className={cn(CRM_REPORTS_TH, "w-10")}>
                <CrmReportsPageCheckbox
                  page={page}
                  chipOf={crmReportsChipFromRow}
                  checked={checked}
                  onToggleMany={onToggleManyChecked}
                />
              </th>
              <th className={CRM_REPORTS_TH}>Cliente</th>
              <th className={CRM_REPORTS_TH}>Responsável</th>
              <th className={CRM_REPORTS_TH}>Vendedor último pedido</th>
              <th className={CRM_REPORTS_TH}>Última compra</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Ciclo médio</th>
              <th className={CRM_REPORTS_TH}>Deveria ter comprado em</th>
              <th className={CRM_REPORTS_TH}>Atraso</th>
              <th className={CRM_REPORTS_TH}>Confiança</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Compras 12m</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Venda 12m</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Ticket médio</th>
              <th className={CRM_REPORTS_TH}>Último contato</th>
              <th className={CRM_REPORTS_TH}>Próximo follow-up</th>
              <th className={CRM_REPORTS_TH}>Follow-up atrasado</th>
              <th className={CRM_REPORTS_TH}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {page.returned === 0 ? (
              <CrmReportsEmptyRows colSpan={COLUMN_COUNT} filtered={filtered || severity !== "ALL"} />
            ) : (
              page.rows.map((row) => {
                const chip = crmReportsChipFromRow(row);
                const isChecked = checked.has(row.customerId);
                return (
                  <tr
                    key={row.customerId}
                    className={cn("border-b border-border/40 last:border-0", isChecked && "bg-primary/5")}
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
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmReportsAverageDays(row.averageRepurchaseDays)}</td>
                    <td className={cn(CRM_REPORTS_TD, "whitespace-nowrap tabular-nums")}>
                      {formatCrmReportsDate(row.expectedRepurchaseDate)}
                    </td>
                    <td className={CRM_REPORTS_TD}>
                      <CrmRepurchaseStatusBadge status={row.repurchaseStatus} deltaDays={row.overdueDays} />
                    </td>
                    <td className={CRM_REPORTS_TD}>
                      <CrmCadenceConfidenceBadge confidence={row.cadenceConfidence} />
                    </td>
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmReportsInteger(row.orders12m)}</td>
                    <td className={cn(CRM_REPORTS_TD_NUM, "font-semibold text-foreground")}>
                      {formatCrmReportsMoney(row.purchaseValue12m)}
                    </td>
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmReportsMoney(row.averageTicket12m)}</td>
                    <td className={cn(CRM_REPORTS_TD, "whitespace-nowrap tabular-nums")}>
                      {row.lastContactAt ? (
                        formatCrmReportsDateTime(row.lastContactAt)
                      ) : (
                        <span className="text-muted-foreground">Sem contato</span>
                      )}
                    </td>
                    <td className={cn(CRM_REPORTS_TD, "whitespace-nowrap tabular-nums")}>
                      {formatCrmReportsDateTime(row.nextFollowUpAt)}
                    </td>
                    <td className={CRM_REPORTS_TD}>
                      {row.hasOverdueFollowUp ? (
                        <span className="whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                          Sim · atrasado
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Não</span>
                      )}
                    </td>
                    <td className={CRM_REPORTS_TD}>
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
