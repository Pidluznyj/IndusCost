import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  normalizeInventoryBalanceListRow,
  type InventoryBalanceListRow,
} from "@/src/components/inventory/inventoryBalancePresentation";
import {
  formatInventoryItemStatus,
  formatInventoryItemType,
} from "@/src/components/inventory/inventoryItemLabels";
import {
  normalizeInventoryBalancesResponse,
  normalizeInventoryItemRow,
  summarizeInventoryBalances,
  type InventoryItemBalanceSummary,
} from "@/src/components/inventory/inventoryItemPresentation";
import { normalizeInventoryMovementListResponse } from "@/src/components/inventory/inventoryMovementPresentation";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryMovementType,
  formatInventoryQuantity,
  InventoryEmptyState,
  InventoryOperationalStatusBadge,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryItemRow, InventoryMovementRow } from "@/src/types/inventory";

type Props = {
  itemId: string;
  onClose: () => void;
  onNewMovement: (itemId: string) => void;
  canCreateMovement: boolean;
};

function MetricTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

export function InventoryBalanceItemDetailSheet({
  itemId,
  onClose,
  onNewMovement,
  canCreateMovement,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<InventoryItemRow | null>(null);
  const [balanceRows, setBalanceRows] = useState<InventoryBalanceListRow[]>([]);
  const [summary, setSummary] = useState<InventoryItemBalanceSummary | null>(null);
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemRes, balanceRes, movementRes] = await Promise.all([
        fetchJsonOk<{ item: unknown }>(`/api/inventory/items/${itemId}`),
        fetchJsonOk<unknown>(`/api/inventory/balances?itemId=${itemId}&pageSize=200`),
        fetchJsonOk<unknown>(`/api/inventory/items/${itemId}/movements?pageSize=20`).catch(() => ({
          rows: [],
        })),
      ]);

      const normalizedItem = normalizeInventoryItemRow(itemRes.item);
      if (!normalizedItem) throw new Error("Item não encontrado.");
      setItem(normalizedItem);

      const rawRows = balanceRes && typeof balanceRes === "object" && Array.isArray((balanceRes as { rows?: unknown[] }).rows)
        ? (balanceRes as { rows: unknown[] }).rows
        : [];
      const enriched = rawRows
        .map(normalizeInventoryBalanceListRow)
        .filter((r): r is InventoryBalanceListRow => r != null);
      setBalanceRows(enriched);

      const plainBalances = normalizeInventoryBalancesResponse(balanceRes);
      setSummary(summarizeInventoryBalances(plainBalances, normalizedItem));

      const movData = normalizeInventoryMovementListResponse(movementRes);
      setMovements(movData.rows);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao carregar detalhe do item."));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalValue = balanceRows.reduce((sum, b) => sum + (b.totalValue ?? 0), 0);
  const reservationRows = balanceRows.filter((b) => b.reservedQuantity > 0);
  const blockedRows = balanceRows.filter((b) => b.blockedQuantity > 0);
  const quarantineRows = balanceRows.filter((b) => b.quarantineQuantity > 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" data-testid="inventory-balance-item-detail">
      <button type="button" className="flex-1" aria-label="Fechar" onClick={onClose} />
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {item ? `${item.code} — ${item.description}` : "Detalhe do item"}
            </h2>
            {item ? (
              <p className="text-xs text-slate-500">
                {formatInventoryItemType(item.itemType)} · {item.unit}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <div
              className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando…
            </div>
          ) : item ? (
            <div className="space-y-6">
              <section data-testid="inventory-balance-item-cadastral">
                <h3 className="text-sm font-semibold text-slate-900">Dados cadastrais</h3>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-slate-500">Status:</span>{" "}
                    {formatInventoryItemStatus(item.status)}
                  </div>
                  <div>
                    <span className="text-slate-500">Família:</span> {item.family ?? "—"}
                  </div>
                  <div>
                    <span className="text-slate-500">Grupo:</span> {item.group ?? "—"}
                  </div>
                  <div>
                    <span className="text-slate-500">Status operacional:</span>{" "}
                    {summary ? <InventoryOperationalStatusBadge status={summary.operationalStatus} /> : "—"}
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Saldos são alterados somente via movimentações — não editáveis nesta tela.
                </p>
              </section>

              <section data-testid="inventory-balance-item-summary">
                <h3 className="text-sm font-semibold text-slate-900">Valor em estoque</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <MetricTile
                    label="Valor total"
                    value={totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  />
                  <MetricTile
                    label="Disponível"
                    value={formatInventoryQuantity(summary?.availableQuantity ?? 0, item.unit)}
                  />
                  <MetricTile
                    label="Físico"
                    value={formatInventoryQuantity(summary?.physicalQuantity ?? 0, item.unit)}
                  />
                </div>
              </section>

              <section data-testid="inventory-balance-item-reorder-params">
                <h3 className="text-sm font-semibold text-slate-900">Parâmetros de reposição</h3>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                  <MetricTile label="Estoque mínimo" value={formatInventoryQuantity(item.minimumStock, item.unit)} />
                  <MetricTile label="Ponto de reposição" value={formatInventoryQuantity(item.reorderPoint, item.unit)} />
                  <MetricTile label="Estoque máximo" value={formatInventoryQuantity(item.maximumStock, item.unit)} />
                </div>
              </section>

              <section data-testid="inventory-balance-item-by-warehouse">
                <h3 className="text-sm font-semibold text-slate-900">Saldos por almoxarifado</h3>
                {balanceRows.length === 0 ? (
                  <InventoryEmptyState message="Nenhum saldo registrado para este item." />
                ) : (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                    <table className={inventoryTableClassName()}>
                      <thead>
                        <tr>
                          <th>Almoxarifado</th>
                          <th>Físico</th>
                          <th>Reservado</th>
                          <th>Bloqueado</th>
                          <th>Quarentena</th>
                          <th>Disponível</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balanceRows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              {row.warehouseCode} — {row.warehouseName}
                            </td>
                            <td className="tabular-nums">{formatInventoryQuantity(row.physicalQuantity, item.unit)}</td>
                            <td className="tabular-nums">{formatInventoryQuantity(row.reservedQuantity, item.unit)}</td>
                            <td className="tabular-nums">{formatInventoryQuantity(row.blockedQuantity, item.unit)}</td>
                            <td className="tabular-nums">{formatInventoryQuantity(row.quarantineQuantity, item.unit)}</td>
                            <td className="tabular-nums">{formatInventoryQuantity(row.availableQuantity, item.unit)}</td>
                            <td>
                              <InventoryOperationalStatusBadge status={row.operationalStatus} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section data-testid="inventory-balance-item-reservations">
                <h3 className="text-sm font-semibold text-slate-900">Reservas ativas (por saldo)</h3>
                {reservationRows.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">Nenhuma reserva ativa.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {reservationRows.map((r) => (
                      <li key={r.id}>
                        {r.warehouseCode}: {formatInventoryQuantity(r.reservedQuantity, item.unit)} reservado(s)
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section data-testid="inventory-balance-item-blocks">
                <h3 className="text-sm font-semibold text-slate-900">Bloqueios e quarentena</h3>
                {blockedRows.length === 0 && quarantineRows.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">Nenhum bloqueio ou quarentena.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {blockedRows.map((r) => (
                      <li key={`b-${r.id}`}>
                        {r.warehouseCode}: {formatInventoryQuantity(r.blockedQuantity, item.unit)} bloqueado(s)
                      </li>
                    ))}
                    {quarantineRows.map((r) => (
                      <li key={`q-${r.id}`}>
                        {r.warehouseCode}: {formatInventoryQuantity(r.quarantineQuantity, item.unit)} em quarentena
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section data-testid="inventory-balance-item-movements">
                <h3 className="text-sm font-semibold text-slate-900">Histórico de movimentações</h3>
                {movements.length === 0 ? (
                  <InventoryEmptyState message="Nenhuma movimentação registrada." />
                ) : (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                    <table className={inventoryTableClassName()}>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Tipo</th>
                          <th>Qtd</th>
                          <th>Antes / Depois disp.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m) => (
                          <tr key={m.id}>
                            <td className="text-xs whitespace-nowrap">
                              {formatInventoryDateTime(m.movementDate)}
                            </td>
                            <td className="text-xs">{formatInventoryMovementType(m.movementType)}</td>
                            <td className="tabular-nums text-xs">
                              {formatInventoryQuantity(m.quantity, m.unit)}
                            </td>
                            <td className="tabular-nums text-xs">
                              {formatInventoryQuantity(m.previousAvailableBalance)} →{" "}
                              {formatInventoryQuantity(m.nextAvailableBalance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <InventoryEmptyState message="Item não encontrado." />
          )}
        </div>

        {canCreateMovement && item ? (
          <div className="border-t border-slate-200 px-4 py-3">
            <button
              type="button"
              onClick={() => onNewMovement(item.id)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
              data-testid="inventory-balance-new-movement"
            >
              <Plus className="h-4 w-4" />
              Nova movimentação deste item
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
