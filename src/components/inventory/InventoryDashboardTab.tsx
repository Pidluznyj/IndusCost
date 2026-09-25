import React from "react";
import {
  Box,
  Boxes,
  Factory,
  Layers,
  Package,
  Puzzle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
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
  InventoryValuationMetric,
  InventoryValuationTypeSlice,
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
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Últimas movimentações</h3>
        <Link
          to="/inventory/movements"
          className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
          data-testid="inventory-dashboard-movements-link"
        >
          Ver histórico
        </Link>
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

function KpiLink({
  to,
  children,
  testId,
}: {
  to: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-xl transition hover:ring-2 hover:ring-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      data-testid={testId}
    >
      {children}
    </Link>
  );
}

function valuationCoverageSubtitle(base: string, metric: InventoryValuationMetric): string {
  const population = metric.coveredItems + metric.uncoveredItems;
  if (!metric.available || population === 0) return base;
  return `${base} · ${metric.coveredItems} de ${population} itens`;
}

function typeSliceSubtitle(slice: InventoryValuationTypeSlice): string {
  if (!slice.includedInRetailValuation) {
    if (slice.positiveItemCount === 0) return "Nenhum item com saldo";
    return `${slice.positiveItemCount} ${
      slice.positiveItemCount === 1 ? "item com saldo" : "itens com saldo"
    } · fora do Varejo 1`;
  }
  const metric = slice.salesPotential;
  if (!metric.available) return "Tabela Varejo 1 indisponível";
  if (slice.positiveItemCount === 0) return "Nenhum item com saldo";
  return valuationCoverageSubtitle("Parte do valor de venda", metric);
}

function TypeValueCard({
  label,
  testId,
  slice,
  icon,
  loading,
}: {
  label: string;
  testId: string;
  slice: InventoryValuationTypeSlice;
  icon: LucideIcon;
  loading: boolean;
}) {
  const metric = slice.salesPotential;
  const showMoney = slice.includedInRetailValuation && metric.available;
  return (
    <KpiLink to="/inventory/balances" testId={testId}>
      <FinanceExecutiveTotalizerCard
        label={label}
        amount={showMoney ? metric.value : null}
        amountFormat="currency"
        value={showMoney ? undefined : slice.includedInRetailValuation ? "Indisponível" : "Fora do Varejo 1"}
        valueSize={showMoney ? "default" : "text"}
        subtitle={typeSliceSubtitle(slice)}
        helperText={
          slice.includedInRetailValuation
            ? valuationHint(metric, "preço Varejo 1")
            : "Matéria-prima não usa a tabela comercial. O valor de venda acima é só PA e componentes."
        }
        tone="neutral"
        icon={icon}
        loading={loading}
      />
    </KpiLink>
  );
}

function valuationHint(metric: InventoryValuationMetric, missingLabel: string): string | undefined {
  const parts: string[] = [];
  if (!metric.available && metric.unavailableReason) parts.push(metric.unavailableReason);
  if (metric.available && metric.uncoveredItems > 0) {
    parts.push(`${metric.uncoveredItems} itens sem ${missingLabel}`);
  }
  if (metric.negativePhysicalItems > 0) {
    parts.push(
      `${metric.negativePhysicalItems} ${
        metric.negativePhysicalItems === 1 ? "item com saldo negativo" : "itens com saldo negativo"
      } fora da valorização`
    );
  }
  return parts.length > 0 ? parts.join(". ") : undefined;
}

export function InventoryDashboardTab({ data, loading = false }: Props) {
  const sales = data.valuation.salesPotential;
  const cost = data.valuation.industrialCost;
  return (
    <div className="space-y-6" data-testid="inventory-dashboard">
      <SummaryKpiGrid className={SYSTEM_TOTALIZER_GRID_CLASS} testId="inventory-dashboard-kpis">
        <KpiLink to="/inventory/balances" testId="inventory-kpi-sales-potential">
          <FinanceExecutiveTotalizerCard
            label="Valor potencial de venda"
            amount={sales.available ? sales.value : null}
            amountFormat="currency"
            value={sales.available ? undefined : "Indisponível"}
            valueSize={sales.available ? "default" : "text"}
            subtitle={valuationCoverageSubtitle("Base: Tabela Comercial Varejo 1", sales)}
            helperText={valuationHint(sales, "preço Varejo 1")}
            tone="neutral"
            icon={Boxes}
            loading={loading}
          />
        </KpiLink>
        <KpiLink to="/inventory/balances" testId="inventory-kpi-industrial-cost">
          <FinanceExecutiveTotalizerCard
            label="Custo industrial do estoque"
            amount={cost.available ? cost.value : null}
            amountFormat="currency"
            value={cost.available ? undefined : "Indisponível"}
            valueSize={cost.available ? "default" : "text"}
            subtitle={valuationCoverageSubtitle("Base: custo industrial vigente", cost)}
            helperText={valuationHint(cost, "custo industrial")}
            tone="neutral"
            icon={Factory}
            loading={loading}
          />
        </KpiLink>
        <KpiLink to="/inventory/items" testId="inventory-kpi-items">
          <FinanceExecutiveTotalizerCard
            label="Itens cadastrados"
            amount={data.itemsCount}
            amountFormat="number"
            tone="info"
            icon={Package}
            loading={loading}
          />
        </KpiLink>
        <TypeValueCard
          label="MP"
          testId="inventory-kpi-raw-material"
          slice={data.valuation.byItemType.rawMaterial}
          icon={Layers}
          loading={loading}
        />
        <TypeValueCard
          label="PA"
          testId="inventory-kpi-finished-product"
          slice={data.valuation.byItemType.finishedProduct}
          icon={Box}
          loading={loading}
        />
        <TypeValueCard
          label="Componentes"
          testId="inventory-kpi-component"
          slice={data.valuation.byItemType.component}
          icon={Puzzle}
          loading={loading}
        />
      </SummaryKpiGrid>

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
