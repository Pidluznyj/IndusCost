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
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
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
  if (slice.positiveItemCount === 0) return "Nenhum item com saldo";
  const missing =
    slice.uncoveredItemCount > 0
      ? ` · ${slice.uncoveredItemCount} sem dado`
      : "";
  if (slice.cardBasis === "SALE") {
    return `Valor de venda · ${slice.saleItemCount} de ${slice.positiveItemCount} itens${missing}`;
  }
  if (slice.cardBasis === "SUPPLY_COST") {
    return `Custo congelado de MP · ${slice.costItemCount} de ${slice.positiveItemCount} itens${missing}`;
  }
  if (slice.cardBasis === "INDUSTRIAL_COST") {
    return `Custo fabril congelado · ${slice.costItemCount} de ${slice.positiveItemCount} itens${missing}`;
  }
  if (slice.cardBasis === "MIXED") {
    return `Valor de venda · ${slice.saleItemCount} itens · custo · ${slice.costItemCount}${missing}`;
  }
  if (slice.sourceUnavailableReason) return slice.sourceUnavailableReason;
  return slice.includedInRetailValuation
    ? `${slice.uncoveredItemCount} itens sem preço e sem custo`
    : `${slice.uncoveredItemCount} itens sem custo congelado de MP`;
}

function retailTypeSubtitle(slice: InventoryValuationTypeSlice): string {
  if (slice.positiveItemCount === 0) return "Nenhum item com saldo";
  const sale = slice.salesPotential;
  const saleLine =
    sale.available && sale.value != null ? "Valor de venda" : "Valor de venda indisponível";
  const cost = slice.manufacturingCost;
  const missing =
    cost && cost.available && cost.uncoveredItems > 0 ? ` · ${cost.uncoveredItems} sem custo` : "";
  const costLine =
    cost && cost.available && cost.value != null
      ? `Custo de fabricação ${formatFinanceKpiCurrency(cost.value)}${missing}`
      : "Custo de fabricação indisponível";
  return `${saleLine}\n${costLine}`;
}

function typeSliceHint(slice: InventoryValuationTypeSlice): string {
  if (!slice.includedInRetailValuation) {
    return "Saldo físico × custo posto congelado na tabela oficial de matéria-prima da formação de preço.";
  }
  return "O valor do card é o saldo físico × preço da tabela Varejo 1. O custo de fabricação é o custo fabril congelado na mesma formação de preço, com matéria-prima, homem-hora e hora-máquina.";
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
  const sale = slice.salesPotential;
  const showSale = slice.includedInRetailValuation && sale.available && sale.value != null;
  const showSupply = !slice.includedInRetailValuation && slice.cardValue != null;
  const showMoney = showSale || showSupply;
  const emptyLabel = slice.includedInRetailValuation || slice.sourceUnavailableReason ? "Indisponível" : "Sem custo";
  return (
    <KpiLink to="/inventory/balances" testId={testId}>
      <FinanceExecutiveTotalizerCard
        label={label}
        className={slice.includedInRetailValuation ? "inventory-type-card--dual" : undefined}
        amount={showMoney ? (showSale ? sale.value : slice.cardValue) : null}
        amountFormat="currency"
        value={showMoney ? undefined : emptyLabel}
        valueSize={showMoney ? "default" : "text"}
        subtitle={slice.includedInRetailValuation ? retailTypeSubtitle(slice) : typeSliceSubtitle(slice)}
        helperText={typeSliceHint(slice)}
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
            subtitle={valuationCoverageSubtitle("Base: custo fabril congelado no Varejo 1", cost)}
            helperText={valuationHint(cost, "custo fabril congelado")}
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
