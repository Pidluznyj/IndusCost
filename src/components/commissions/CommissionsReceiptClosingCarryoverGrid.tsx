import React from "react";
import { CheckSquare, MinusCircle, PlusCircle } from "lucide-react";
import { CommissionsTableScroll } from "@/src/components/commissions/commissionsUi";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { formatInstallmentLabel } from "@/src/lib/commissions/commissionReceiptInstallment.shared";
import { formatReceiptClosingCanonicalSellerDisplay } from "@/src/lib/commissions/commissionReceiptSeller";
import { formatCommissionYearMonthLabel } from "@/src/lib/commissions/commissionCoverageCutover";
import {
  RECEIPT_CLOSING_CARRYOVER_HELP,
  formatCarryoverOrigin,
  type ReceiptClosingCarryoverRow,
  type ReceiptClosingCarryoverSection,
  type ReceiptClosingCarryoverSummary,
} from "@/src/lib/commissions/commissionReceiptCoverage.shared";
import { cn } from "@/src/lib/utils";

export const RECEIPT_CLOSING_CARRYOVER_GRID_TEST_ID = "commissions-receipt-closing-carryover-grid";

const TH = "px-2 py-2 align-bottom leading-tight";
const TD = "px-2 py-2";
const FIT = "w-px";
const MONEY = "text-right whitespace-nowrap tabular-nums";

function formatCivilDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
}

/**
 * Grid "Pendências de períodos anteriores" do fechamento (prévia).
 *
 * Só exibe e seleciona: os valores vêm do backend e, ao incluir, a prévia é
 * recalculada no servidor (o navegador manda apenas IDs de recebimento).
 */
export function CommissionsReceiptClosingCarryoverGrid({
  section,
  rows,
  summary,
  checkedKeys,
  canInclude,
  busy,
  onToggleRow,
  onSelectEligible,
  onIncludeChecked,
  onIncludeRow,
  onRemoveRow,
}: {
  section: ReceiptClosingCarryoverSection;
  /** Linhas já filtradas (ex.: vendedor selecionado na tabela "Por vendedor"). */
  rows: ReceiptClosingCarryoverRow[];
  summary: ReceiptClosingCarryoverSummary;
  checkedKeys: ReadonlySet<string>;
  canInclude: boolean;
  busy: boolean;
  onToggleRow: (row: ReceiptClosingCarryoverRow) => void;
  onSelectEligible: () => void;
  onIncludeChecked: () => void;
  onIncludeRow: (row: ReceiptClosingCarryoverRow) => void;
  onRemoveRow: (row: ReceiptClosingCarryoverRow) => void;
}) {
  const checkedCount = rows.filter((row) => !row.selected && checkedKeys.has(row.rowKey)).length;
  const selectableCount = rows.filter((row) => row.includable && !row.selected).length;
  const pendingImports = section.legacyImportStatus.filter((item) => !item.imported);
  return (
    <section className="space-y-2" data-testid={RECEIPT_CLOSING_CARRYOVER_GRID_TEST_ID}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Pendências de períodos anteriores
          </h4>
          <p className="text-xs text-muted-foreground" data-testid="commissions-receipt-closing-carryover-help">
            {RECEIPT_CLOSING_CARRYOVER_HELP}
          </p>
        </div>
        {canInclude ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${financeBiButtonOutlineClass} inline-flex items-center`}
              onClick={onSelectEligible}
              disabled={busy || selectableCount === 0}
              data-testid="commissions-receipt-closing-carryover-select-eligible"
            >
              <CheckSquare className="mr-2 h-4 w-4" />
              Selecionar elegíveis
            </button>
            <button
              type="button"
              className="inline-flex items-center rounded-lg bg-[#111827] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f2937] disabled:opacity-50"
              onClick={onIncludeChecked}
              disabled={busy || checkedCount === 0}
              data-testid="commissions-receipt-closing-carryover-include-selected"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Incluir selecionados{checkedCount > 0 ? ` (${checkedCount})` : ""}
            </button>
          </div>
        ) : null}
      </div>

      <div
        className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border bg-muted/20 px-3 py-2 text-xs"
        data-testid="commissions-receipt-closing-carryover-summary"
      >
        <span>
          Elegíveis: <strong>{summary.eligibleCount}</strong>
        </span>
        <span>
          Recebido: <strong>{formatFinanceCurrency(summary.eligibleReceivedAmount)}</strong>
        </span>
        <span>
          Base: <strong>{formatFinanceCurrency(summary.eligibleCommissionableBase)}</strong>
        </span>
        <span>
          Comissão potencial: <strong>{formatFinanceCurrency(summary.eligibleCommissionAmount)}</strong>
        </span>
        <span>
          Incluídas: <strong>{summary.selectedCount}</strong> (
          {formatFinanceCurrency(summary.selectedCommissionAmount)})
        </span>
        <span className={summary.ambiguousCount > 0 ? "font-semibold text-amber-800" : undefined}>
          Ambíguos: <strong>{summary.ambiguousCount}</strong>
        </span>
        {summary.legacyAwaitingImportCount > 0 ? (
          <span className="font-semibold text-amber-800">
            Aguardando cobertura Nomus: {summary.legacyAwaitingImportCount}
          </span>
        ) : null}
      </div>

      {pendingImports.length > 0 ? (
        <p className="text-xs text-amber-800" data-testid="commissions-receipt-closing-carryover-import-status">
          Cobertura do Nomus ainda não importada para{" "}
          {pendingImports.map((item) => formatCommissionYearMonthLabel(item)).join(", ")} — recebimentos
          dessas competências ficam bloqueados até a importação (podem ter sido pagos no Nomus).
        </p>
      ) : null}

      {section.selectionErrors.length > 0 ? (
        <ul
          className="list-disc space-y-0.5 pl-5 text-xs text-red-700"
          data-testid="commissions-receipt-closing-carryover-selection-errors"
        >
          {section.selectionErrors.map((item) => (
            <li key={item.receiptExternalId}>
              Recebimento {item.receiptExternalId}: {item.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma pendência para o filtro atual.</p>
      ) : (
        <CommissionsTableScroll tableClassName="text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className={cn(TH, FIT)}>
                <span className="sr-only">Selecionar</span>
              </th>
              <th className={cn(TH, FIT)}>Competência</th>
              <th className={cn(TH, FIT)}>NF</th>
              <th className={cn(TH, FIT)}>CR</th>
              <th className={cn(TH, FIT)}>Pedido</th>
              <th className={cn(TH, "min-w-[8rem]")}>Cliente</th>
              <th className={cn(TH, "min-w-[7.5rem]")}>Vendedor</th>
              <th className={cn(TH, FIT, "text-center")}>Parcela</th>
              <th className={cn(TH, FIT)}>Recebido em</th>
              <th className={cn(TH, FIT, "text-right")}>Valor real</th>
              <th className={cn(TH, FIT, "text-right")}>Base comissão</th>
              <th className={cn(TH, FIT, "text-right")}>Comissão</th>
              <th className={cn(TH, FIT)}>Origem</th>
              <th className={cn(TH, "min-w-[10rem]")}>Situação</th>
              <th className={cn(TH, FIT)}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const checked = row.selected || checkedKeys.has(row.rowKey);
              return (
                <tr
                  key={row.rowKey}
                  className={cn("border-b", row.selected ? "bg-emerald-50" : undefined)}
                  data-testid={`commissions-receipt-closing-carryover-row-${row.rowKey}`}
                  data-selected={row.selected ? "true" : "false"}
                  data-includable={row.includable ? "true" : "false"}
                >
                  <td className={cn(TD, "text-center")}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[#E5E7EB]"
                      checked={checked}
                      disabled={!canInclude || busy || !row.includable || row.selected}
                      onChange={() => onToggleRow(row)}
                      aria-label={`Selecionar CR ${row.receivableExternalId}`}
                    />
                  </td>
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                    {formatCommissionYearMonthLabel({ year: row.naturalYear, month: row.naturalMonth })}
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>{row.nfeNumber ?? "—"}</td>
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{row.receivableExternalId}</td>
                  <td className={cn(TD, "whitespace-nowrap")}>{row.orderCode ?? "—"}</td>
                  <td className={TD}>{row.customerName ?? "—"}</td>
                  <td className={TD}>{formatReceiptClosingCanonicalSellerDisplay(row)}</td>
                  <td className={cn(TD, "whitespace-nowrap text-center tabular-nums")}>
                    {formatInstallmentLabel(row.installmentNumber, row.installmentTotal)}
                  </td>
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{formatCivilDate(row.receiptDate)}</td>
                  <td
                    className={cn(TD, MONEY)}
                    title={
                      row.receivableOriginalAmount != null
                        ? `Valor recebido nos eventos pendentes (original do CR: ${formatFinanceCurrency(row.receivableOriginalAmount)})`
                        : "Valor recebido nos eventos pendentes"
                    }
                  >
                    {formatFinanceCurrency(row.receivedAmount)}
                  </td>
                  <td className={cn(TD, MONEY)}>{formatFinanceCurrency(row.commissionableBaseAmount)}</td>
                  <td className={cn(TD, MONEY, "font-semibold")}>{formatFinanceCurrency(row.commissionAmount)}</td>
                  <td className={TD}>{formatCarryoverOrigin(row.origin)}</td>
                  <td className={TD}>
                    <span className="block">{row.situation}</span>
                    {row.blockedReason ? (
                      <span
                        className="block text-amber-800"
                        data-testid="commissions-receipt-closing-carryover-blocked"
                      >
                        {row.blockedReason}
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    {!canInclude ? (
                      "—"
                    ) : row.selected ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-2 py-1 text-xs font-medium text-[#374151] hover:bg-muted/40 disabled:opacity-50"
                        onClick={() => onRemoveRow(row)}
                        disabled={busy}
                        data-testid="commissions-receipt-closing-carryover-remove-row"
                      >
                        <MinusCircle className="h-3 w-3" />
                        Remover
                      </button>
                    ) : row.includable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-left text-xs font-semibold leading-tight text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                        onClick={() => onIncludeRow(row)}
                        disabled={busy}
                        data-testid="commissions-receipt-closing-carryover-include-row"
                      >
                        <PlusCircle className="h-3 w-3 shrink-0" />
                        Incluir neste fechamento
                      </button>
                    ) : (
                      <span className="text-muted-foreground">Bloqueada</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </CommissionsTableScroll>
      )}
    </section>
  );
}
