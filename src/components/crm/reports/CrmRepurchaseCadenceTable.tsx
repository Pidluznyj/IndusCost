import React from "react";
import { cn } from "@/src/lib/utils";
import {
  formatCrmReportsAverageDays,
  formatCrmReportsDate,
  formatCrmReportsInteger,
  formatCrmReportsMoney,
} from "@/src/lib/commercial/crmReportsFormat";
import { CRM_REPURCHASE_STATUS_LABELS, formatCrmRepurchaseDeviation } from "@/src/lib/commercial/crmReportsLabels";
import { crmReportsChipFromRow, type CrmReportsCustomerChip } from "@/src/lib/commercial/crmReportsUiState";
import type { CrmReportsExportFormatChoice } from "@/src/lib/commercial/crmReportsClient";
import type {
  CrmReportsCadenceRow,
  CrmReportsPage,
  CrmRepurchaseStatus,
} from "@/src/lib/commercial/crmReportsTypes";
import {
  CRM_REPORTS_HEAD_ROW,
  CRM_REPORTS_STICKY_ACTIONS,
  CRM_REPORTS_TD,
  CRM_REPORTS_TD_NUM,
  CRM_REPORTS_TH,
  CRM_REPORTS_TH_RIGHT,
  CrmCadenceConfidenceBadge,
  CrmReportsCustomerCell,
  CrmReportsEmptyRows,
  CrmReportsExportButtons,
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

/** Situações que existem nesta lista (clientes com ao menos uma compra). */
export const CRM_CADENCE_VIEW_STATUSES: readonly CrmRepurchaseStatus[] = [
  "DUE_SOON",
  "ON_TIME",
  "OVERDUE",
  "SEVERELY_OVERDUE",
  "INSUFFICIENT_HISTORY",
];

export type CrmRepurchaseCadenceTableProps = {
  page: CrmReportsPage<CrmReportsCadenceRow>;
  refreshing: boolean;
  filtered: boolean;
  statuses: readonly CrmRepurchaseStatus[];
  onStatusesChange: (statuses: CrmRepurchaseStatus[]) => void;
  checked: ReadonlyMap<string, CrmReportsCustomerChip>;
  onToggleChecked: (chip: CrmReportsCustomerChip) => void;
  onToggleManyChecked: (chips: CrmReportsCustomerChip[], on: boolean) => void;
  onPageChange: (offset: number) => void;
  actions: CrmReportsRowActionHandlers;
  exporting: CrmReportsExportFormatChoice | null;
  onExport: (format: CrmReportsExportFormatChoice) => void;
};

const COLUMN_COUNT = 12;

function StatusChips({
  statuses,
  onChange,
  disabled,
}: {
  statuses: readonly CrmRepurchaseStatus[];
  onChange: (statuses: CrmRepurchaseStatus[]) => void;
  disabled: boolean;
}) {
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
    );
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Situação na lista">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Situação</span>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={statuses.length === 0}
        onClick={() => onChange([])}
        className={chip(statuses.length === 0)}
      >
        Todas
      </button>
      {CRM_CADENCE_VIEW_STATUSES.map((status) => {
        const active = statuses.includes(status);
        return (
          <button
            key={status}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() =>
              onChange(active ? statuses.filter((s) => s !== status) : [...statuses, status])
            }
            className={chip(active)}
          >
            {CRM_REPURCHASE_STATUS_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}

/** Lista 2 — cadência de recompra do motor (últimas 6 ocasiões). */
export function CrmRepurchaseCadenceTable({
  page,
  refreshing,
  filtered,
  statuses,
  onStatusesChange,
  checked,
  onToggleChecked,
  onToggleManyChecked,
  onPageChange,
  actions,
  exporting,
  onExport,
}: CrmRepurchaseCadenceTableProps) {
  return (
    <CrmReportsListShell
      id="crm-reports-list-cadence"
      title="Ciclo de recompra"
      description="Tempo médio entre as últimas ocasiões de compra (até 6 dias distintos de Pedido de Venda). Com uma única compra não há previsão: “Sem cadência suficiente”."
      total={page.total}
      refreshing={refreshing}
      toolbar={<CrmReportsExportButtons busy={exporting} disabled={page.total === 0} onExport={onExport} />}
      controls={<StatusChips statuses={statuses} onChange={onStatusesChange} disabled={refreshing} />}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
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
              <th className={CRM_REPORTS_TH_RIGHT}>Compras/ocasiões analisadas</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Tempo médio de recompra</th>
              <th className={CRM_REPORTS_TH}>Última compra</th>
              <th className={CRM_REPORTS_TH}>Próxima compra esperada</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Desvio</th>
              <th className={CRM_REPORTS_TH}>Confiança</th>
              <th className={CRM_REPORTS_TH}>Situação</th>
              <th className={CRM_REPORTS_TH_RIGHT}>Venda 12m</th>
              <th className={cn(CRM_REPORTS_TH, CRM_REPORTS_STICKY_ACTIONS)}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {page.returned === 0 ? (
              <CrmReportsEmptyRows colSpan={COLUMN_COUNT} filtered={filtered || statuses.length > 0} />
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
                    <td className={CRM_REPORTS_TD_NUM}>
                      <span className="font-semibold text-foreground">{formatCrmReportsInteger(row.occasionsUsed)}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        de {formatCrmReportsInteger(row.totalOccasions)} no histórico
                      </span>
                    </td>
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmReportsAverageDays(row.averageRepurchaseDays)}</td>
                    <td className={cn(CRM_REPORTS_TD, "whitespace-nowrap tabular-nums")}>
                      {formatCrmReportsDate(row.lastPurchaseDate)}
                    </td>
                    <td className={cn(CRM_REPORTS_TD, "whitespace-nowrap tabular-nums")}>
                      {formatCrmReportsDate(row.expectedRepurchaseDate)}
                    </td>
                    <td className={CRM_REPORTS_TD_NUM}>{formatCrmRepurchaseDeviation(row.deltaDays)}</td>
                    <td className={CRM_REPORTS_TD}>
                      <CrmCadenceConfidenceBadge confidence={row.cadenceConfidence} />
                    </td>
                    <td className={CRM_REPORTS_TD}>
                      <CrmRepurchaseStatusBadge status={row.repurchaseStatus} deltaDays={row.deltaDays} />
                    </td>
                    <td className={cn(CRM_REPORTS_TD_NUM, "font-semibold text-foreground")}>
                      {formatCrmReportsMoney(row.purchaseValue12m)}
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
