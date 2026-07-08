import React from "react";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import type {
  CustomerIntelligenceProductOpportunity,
  CustomerIntelligenceProductRow,
  CustomerIntelligenceReport,
} from "@/src/lib/customerIntelligenceTypes";
import { CustomerIntelligenceTabKpiGrid } from "@/src/components/crm/customer-intelligence/CustomerIntelligenceTabKpiGrid";

function formatOptionalCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatCurrency(value);
}

function formatOptionalPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

function ProductTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: CustomerIntelligenceProductRow[];
  emptyMessage: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
      <h2 className="text-sm font-bold mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <table className="w-full text-sm border-collapse min-w-[28rem]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">Código</th>
              <th className="py-2 pr-3 font-semibold">Produto</th>
              <th className="py-2 pr-3 font-semibold">Receita</th>
              <th className="py-2 pr-3 font-semibold">Qtd.</th>
              <th className="py-2 pr-3 font-semibold">Pedidos</th>
              <th className="py-2 pr-3 font-semibold">Participação</th>
              <th className="py-2 pr-3 font-semibold">Última compra</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.productId} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap">{p.productCode}</td>
                <td className="py-2 pr-3">{p.productName}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{formatCurrency(p.revenue)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{formatNumber(p.quantity)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{formatNumber(p.ordersCount)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {formatOptionalPercent(p.shareOfCustomerRevenue)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{p.lastPurchaseDate ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function opportunityKindLabel(kind: CustomerIntelligenceProductOpportunity["kind"]): string {
  switch (kind) {
    case "offer_again":
      return "Ofertar novamente";
    case "recurring_late":
      return "Recorrente atrasado";
    case "low_mix":
      return "Mix baixo";
    case "concentrated_revenue":
      return "Receita concentrada";
    case "cross_sell":
      return "Cross-sell";
    case "up_sell":
      return "Up-sell";
    default:
      return kind;
  }
}

export function CustomerIntelligenceProductsTab({ report }: { report: CustomerIntelligenceReport }) {
  const { products } = report;
  const hasProducts = products.concentration.distinctProductsCount > 0;

  if (!hasProducts) {
    return (
      <div className="customer-intelligence-tab-panel rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <p className="font-semibold">Sem produtos no filtro aplicado</p>
        <p className="text-sm text-muted-foreground mt-2">
          Não há itens de pedidos válidos para montar mix, concentração ou oportunidades por produto.
        </p>
      </div>
    );
  }

  const leaderFromProducts = products.topByRevenue[0];
  const leaderLabel = leaderFromProducts
    ? `${leaderFromProducts.productCode} — ${leaderFromProducts.productName}`
    : report.commercialSummary.leadingProduct
      ? `${report.commercialSummary.leadingProduct.sku} — ${report.commercialSummary.leadingProduct.name}`
      : "—";

  return (
    <div className="customer-intelligence-tab-panel space-y-5">
      <CustomerIntelligenceTabKpiGrid
        ariaLabel="Indicadores de produtos"
        items={[
          {
            label: "Produto líder",
            value: leaderLabel,
            hint: products.topByRevenue[0]
              ? formatCurrency(products.topByRevenue[0].revenue)
              : undefined,
          },
          {
            label: "Produtos distintos",
            value: formatNumber(products.concentration.distinctProductsCount),
          },
          {
            label: "Concentração top 3",
            value: formatOptionalPercent(products.concentration.top3RevenueSharePercent),
            hint:
              products.concentration.top5RevenueSharePercent != null
                ? `Top 5: ${products.concentration.top5RevenueSharePercent.toFixed(1)}%`
                : undefined,
          },
          {
            label: "Produtos abandonados",
            value: formatNumber(products.abandonedProducts.length),
          },
          {
            label: "Produtos recorrentes",
            value: formatNumber(products.recurringProducts.length),
            hint:
              products.newProducts.length > 0
                ? `${products.newProducts.length} novo(s) no mix`
                : undefined,
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ProductTable
          title="Top produtos por receita"
          rows={products.topByRevenue}
          emptyMessage="Sem ranking por receita."
        />
        <ProductTable
          title="Top produtos por quantidade"
          rows={products.topByQuantity}
          emptyMessage="Sem ranking por quantidade."
        />
      </div>

      <ProductTable
        title="Produtos abandonados"
        rows={products.abandonedProducts}
        emptyMessage="Nenhum produto abandonado no critério configurado."
      />

      {products.productOpportunities.length > 0 ? (
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <h2 className="text-sm font-bold">Oportunidades por produto</h2>
          <ul className="space-y-2">
            {products.productOpportunities.map((opp, idx) => (
              <li
                key={`${opp.kind}-${opp.productId ?? idx}`}
                className="rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-sm"
              >
                <p className="font-semibold">
                  {opportunityKindLabel(opp.kind)}
                  {opp.productName ? ` — ${opp.productName}` : null}
                </p>
                <p className="text-muted-foreground mt-0.5">{opp.description}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
