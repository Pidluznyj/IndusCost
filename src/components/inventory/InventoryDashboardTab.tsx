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
import { INVENTORY_EMPTY } from "@/src/components/inventory/inventoryEmptyStates";
import {
  formatInventoryDateTime,
  formatInventoryMovementType,
  formatInventoryQuantity,
  InventoryBalanceGlossary,
  InventoryEmptyState,
  InventoryOperationalStatusBadge,
  InventoryTableScroll,
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
  empty,
}: {
  title: string;
  rows: InventoryDashboardCriticalItem[];
  empty: { title: string; description: string };
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="p-4">
          <InventoryEmptyState title={empty.title} description={empty.description} />
        </div>
      ) : (
        <InventoryTableScroll>
          <table className={inventoryTableClassName()} data-testid="inventory-critical-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descrição</th>
                <th scope="col">Disponível</th>
                <th scope="col">Mínimo</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.itemId}>
                  <td className="font-medium text-slate-900">{row.code || "—"}</td>
                  <td title={row.description ?? undefined}>{row.description || "—"}</td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.availableQuantity)}</td>
                  <td className="tabular-nums">
                    {row.minimumStock != null ? formatInventoryQuantity(row.minimumStock) : "—"}
                  </td>
                  <td>
                    <InventoryOperationalStatusBadge status={row.operationalStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </InventoryTableScroll>
      )}
    </section>
  );
}

function RecentMovementsTable({ rows }: { rows: InventoryDashboardRecentMovement[] }) {
  const empty = INVENTORY_EMPTY.noRecentMovements;
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Últimas movimentações</h3>
      </div>
      {rows.length === 0 ? (
        <div className="p-4">
          <InventoryEmptyState title={empty.title} description={empty.description} />
        </div>
      ) : (
        <InventoryTableScroll>
          <table className={inventoryTableClassName()} data-testid="inventory-recent-movements">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Item</th>
                <th scope="col">Tipo</th>
                <th scope="col">Quantidade</th>
                <th scope="col">Almoxarifado</th>
                <th scope="col">Usuário</th>
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
        </InventoryTableScroll>
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

      <InventoryBalanceGlossary compact />

      <RecentMovementsTable rows={data.recentMovements} />

      <div className="grid gap-4 xl:grid-cols-2">
        <CriticalItemsTable
          title="Matérias-primas críticas"
          rows={data.criticalRawMaterials}
          empty={{
            title: "Nenhuma matéria-prima crítica",
            description: "Itens abaixo do mínimo ou com saldo negativo aparecerão aqui.",
          }}
        />
        <CriticalItemsTable
          title="Suprimentos críticos"
          rows={data.criticalSupplies}
          empty={{
            title: "Nenhum suprimento crítico",
            description: "Itens de suprimento que precisam de atenção aparecerão aqui.",
          }}
        />
      </div>
    </div>
  );
}
