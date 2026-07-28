/**
 * Painel de listagem — transferências internas.
 */

import React from "react";
import type {
  TreasuryFinancialAccountDto,
  TreasuryTransferDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_TRANSFER_STATUS_LABELS,
  type TreasuryTransfersFilterState,
} from "@/src/lib/treasury/treasuryTransfersUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

function accountLabel(
  accounts: TreasuryFinancialAccountDto[],
  id: string
): string {
  const acc = accounts.find((a) => a.id === id);
  return acc ? `${acc.code} — ${acc.name}` : id.slice(0, 8);
}

function formatMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function TreasuryTransfersPanel(props: {
  items: TreasuryTransferDto[];
  accounts: TreasuryFinancialAccountDto[];
  filters: TreasuryTransfersFilterState;
  canManage: boolean;
  onFiltersChange: (next: TreasuryTransfersFilterState) => void;
  onCreate: () => void;
  onSchedule: (row: TreasuryTransferDto) => void;
  onSend: (row: TreasuryTransferDto) => void;
  onReceive: (row: TreasuryTransferDto) => void;
  onReconcile: (row: TreasuryTransferDto) => void;
  onCancel: (row: TreasuryTransferDto) => void;
}) {
  const {
    items,
    accounts,
    filters,
    canManage,
    onFiltersChange,
    onCreate,
    onSchedule,
    onSend,
    onReceive,
    onReconcile,
    onCancel,
  } = props;

  return (
    <div className="space-y-4" data-testid="treasury-transfers-panel">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Status</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={filters.status}
            onChange={(e) =>
              onFiltersChange({ ...filters, status: e.target.value })
            }
          >
            <option value="">Todos</option>
            {Object.entries(TREASURY_TRANSFER_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Empresa</span>
          <input
            className={financeModuleFilterFieldClass()}
            value={filters.companyCode}
            onChange={(e) =>
              onFiltersChange({ ...filters, companyCode: e.target.value })
            }
            placeholder="companyCode"
          />
        </label>
        {canManage ? (
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            onClick={onCreate}
          >
            Nova transferência
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Origem</th>
              <th className="px-3 py-2 font-medium">Destino</th>
              <th className="px-3 py-2 font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Trânsito</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2">{row.civilDate}</td>
                <td className="px-3 py-2">
                  {accountLabel(accounts, row.fromAccountId)}
                </td>
                <td className="px-3 py-2">
                  {accountLabel(accounts, row.toAccountId)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {formatMoney(row.amount)}
                </td>
                <td className="px-3 py-2">
                  {TREASURY_TRANSFER_STATUS_LABELS[row.status]}
                </td>
                <td className="px-3 py-2">
                  {row.fundsInTransit ? "Em trânsito" : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {canManage && row.status === "FORECAST" ? (
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => onSchedule(row)}
                      >
                        Programar
                      </button>
                    ) : null}
                    {canManage &&
                    (row.status === "FORECAST" || row.status === "SCHEDULED") ? (
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => onSend(row)}
                      >
                        Enviar
                      </button>
                    ) : null}
                    {canManage && row.status === "SENT" ? (
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => onReceive(row)}
                      >
                        Receber
                      </button>
                    ) : null}
                    {canManage && row.status === "RECEIVED" ? (
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => onReconcile(row)}
                      >
                        Conciliar
                      </button>
                    ) : null}
                    {canManage &&
                    row.status !== "CANCELLED" &&
                    row.status !== "RECONCILED" ? (
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                        onClick={() => onCancel(row)}
                      >
                        Cancelar
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
