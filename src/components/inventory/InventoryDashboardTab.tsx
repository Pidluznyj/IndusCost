import React from "react";
import {
  AlertTriangle,
  Ban,
  Boxes,
  ClipboardList,
  Lock,
  Package,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import {
  formatInventoryDateTime,
  formatInventoryMovementType,
  formatInventoryOperationalStatus,
  formatInventoryQuantity,
  InventoryEmptyState,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type {
  InventoryDashboardCriticalItem,
  InventoryDashboardPayload,
  InventoryDashboardRecentMovement,
} from "@/src/types/inventory";

type Props = {
  data: InventoryDashboardPayload;
  loading?: boolean;
};

function CriticalItemsTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: InventoryDashboardCriticalItem[];
  emptyMessage: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <InventoryEmptyState message={emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <table className={inventoryTableClassName()} data-testid="inventory-critical-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Disponível</th>
                <th>Mínimo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.itemId}>
                  <td className="font-medium text-slate-900">{row.code || "—"}</td>
                  <td>{row.description || "—"}</td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.availableQuantity)}</td>
                  <td className="tabular-nums">
                    {row.minimumStock != null ? formatInventoryQuantity(row.minimumStock) : "—"}
                  </td>
                  <td>{formatInventoryOperationalStatus(row.operationalStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecentMovementsTable({ rows }: { rows: InventoryDashboardRecentMovement[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Últimas movimentações</h3>
      </div>
      {rows.length === 0 ? (
        <InventoryEmptyState message="Nenhuma movimentação registrada ainda." />
      ) : (
        <div className="overflow-x-auto">
          <table className={inventoryTableClassName()} data-testid="inventory-recent-movements">
            <thead>
              <tr>
                <th>Data</th>
                <th>Item</th>
                <th>Tipo</th>
                <th>Quantidade</th>
                <th>Almoxarifado</th>
                <th>Usuário</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">{formatInventoryDateTime(row.movementDate)}</td>
                  <td>
                    <div className="font-medium text-slate-900">{row.itemCode ?? "—"}</div>
                    {row.itemDescription ? (
                      <div className="text-xs text-slate-500">{row.itemDescription}</div>
                    ) : null}
                  </td>
                  <td>{formatInventoryMovementType(row.movementType)}</td>
                  <td className="tabular-nums">
                    {formatInventoryQuantity(row.quantity, row.unit)}
                  </td>
                  <td>
                    {row.warehouseCode
                      ? `${row.warehouseCode}${row.warehouseName ? ` — ${row.warehouseName}` : ""}`
                      : "—"}
                  </td>
                  <td className="text-xs text-slate-600">{row.responsibleUserId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function InventoryDashboardTab({ data, loading = false }: Props) {
  return (
    <div className="space-y-6" data-testid="inventory-dashboard">
      <MetricCardGrid data-testid="inventory-dashboard-kpis">
        <MetricCard
          label="Valor total em estoque"
          amount={data.totalInventoryValue}
          amountFormat="currency"
          variant="neutral"
          icon={<Boxes />}
          loading={loading}
        />
        <MetricCard
          label="Itens cadastrados"
          amount={data.itemsCount}
          amountFormat="number"
          variant="info"
          icon={<Package />}
          loading={loading}
        />
        <MetricCard
          label="Abaixo do mínimo"
          amount={data.belowMinimumCount}
          amountFormat="number"
          variant="warning"
          icon={<TrendingDown />}
          loading={loading}
        />
        <MetricCard
          label="Abaixo do ponto de reposição"
          amount={data.belowReorderPointCount}
          amountFormat="number"
          variant="warning"
          icon={<AlertTriangle />}
          loading={loading}
        />
        <MetricCard
          label="Saldo negativo"
          amount={data.negativeStockCount}
          amountFormat="number"
          variant="danger"
          icon={<ShieldAlert />}
          loading={loading}
        />
        <MetricCard
          label="Bloqueados"
          amount={data.blockedItemsCount}
          amountFormat="number"
          variant="neutral"
          icon={<Lock />}
          loading={loading}
        />
        <MetricCard
          label="Reservados"
          amount={data.reservedItemsCount}
          amountFormat="number"
          variant="info"
          icon={<ClipboardList />}
          loading={loading}
        />
        <MetricCard
          label="Quarentena"
          amount={data.quarantineItemsCount}
          amountFormat="number"
          variant="neutral"
          icon={<Ban />}
          loading={loading}
        />
      </MetricCardGrid>

      <RecentMovementsTable rows={data.recentMovements} />

      <div className="grid gap-4 xl:grid-cols-2">
        <CriticalItemsTable
          title="Matérias-primas críticas"
          rows={data.criticalRawMaterials}
          emptyMessage="Nenhuma matéria-prima crítica no momento."
        />
        <CriticalItemsTable
          title="Suprimentos críticos"
          rows={data.criticalSupplies}
          emptyMessage="Nenhum suprimento crítico no momento."
        />
      </div>
    </div>
  );
}
