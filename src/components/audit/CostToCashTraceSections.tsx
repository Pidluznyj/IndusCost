import { AlertTriangle, Copy } from "lucide-react";
import {
  CommissionsEmptyState,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { ExecutiveAlert } from "@/src/components/ui/ExecutiveAlert";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import {
  TRACE_PAGE_UNAVAILABLE,
  apiStatusChipClass,
  buildTraceSummaryCards,
  chainStatusChipClass,
  formatTraceDate,
  formatTraceMoney,
  formatTracePercent,
  hasCommissionData,
  hasProductData,
  hasPublishedPriceData,
  hasSalesOrderData,
} from "@/src/lib/audit/costToCashTracePageView";
import type { CostToCashTracePageData } from "@/src/lib/audit/costToCashTracePageView";
import { cn } from "@/src/lib/utils";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";

type TraceTabId = "product" | "cost" | "price" | "sales" | "commission" | "diagnostics";

const TRACE_TABS: { id: TraceTabId; label: string }[] = [
  { id: "product", label: "Produto" },
  { id: "cost", label: "Custo" },
  { id: "price", label: "Preço" },
  { id: "sales", label: "Venda" },
  { id: "commission", label: "Comissão" },
  { id: "diagnostics", label: "Diagnósticos" },
];

function TraceSectionCard({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h4>
        <p className="mt-2 text-sm text-muted-foreground italic">{TRACE_PAGE_UNAVAILABLE}</p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function TraceRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground italic">{TRACE_PAGE_UNAVAILABLE}</p>;
  }
  return (
    <CommissionsTableScroll>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border/60">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2">
                  {cell ?? TRACE_PAGE_UNAVAILABLE}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </CommissionsTableScroll>
  );
}

export function CostToCashTraceSections({
  data,
  activeTab,
  onCopyDiagnostics,
}: {
  data: CostToCashTracePageData;
  activeTab: TraceTabId;
  onCopyDiagnostics?: () => void;
}) {
  const { sections } = data;
  const product = sections.product;
  const publishedPrice = sections.publishedPrice;
  const salesOrder = sections.salesOrder;
  const commission = sections.commission;

  if (activeTab === "product") {
    if (!hasProductData(sections)) {
      return (
        <CommissionsEmptyState
          title="Produto não encontrado"
          description="Nenhum dado de produto/engenharia para os filtros informados."
          testId="trace-empty-product"
        />
      );
    }
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TraceSectionCard title="Produto e engenharia">
          <TraceRow label="SKU" value={product?.product?.sku} />
          <TraceRow label="Nome" value={product?.product?.name} />
          <TraceRow label="Tipo" value={product?.product?.type} />
          <TraceRow label="Status" value={product?.product?.status} />
          <TraceRow
            label="Custo engenharia"
            value={formatTraceMoney(product?.currentCost.engineeringCost)}
          />
          <TraceRow label="Fonte engenharia" value={product?.currentCost.engineeringSource} />
        </TraceSectionCard>
        <TraceSectionCard title="Custo oficial publicado">
          <TraceRow
            label="Custo oficial"
            value={formatTraceMoney(product?.currentCost.officialPublishedCost)}
          />
          <TraceRow label="Fonte" value={product?.currentCost.officialSource} />
          <TraceRow label="Versão" value={product?.officialVersion.versionCode} />
          <TraceRow label="Revisão" value={product?.officialVersion.revision} />
          <TraceRow label="Vigência" value={formatTraceDate(product?.officialVersion.effectiveDate)} />
          <TraceRow label="Publicado em" value={formatTraceDate(product?.officialVersion.publishedAt)} />
        </TraceSectionCard>
      </div>
    );
  }

  if (activeTab === "cost") {
    if (!hasProductData(sections)) {
      return <CommissionsEmptyState title="Sem composição de custo" description="Produto não localizado." />;
    }
    return (
      <div className="space-y-4">
        <TraceSectionCard title="Composição do custo">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard label="MP" value={formatTraceMoney(product?.costBreakdown.materialCost)} />
            <MetricCard label="HH" value={formatTraceMoney(product?.costBreakdown.laborCost)} />
            <MetricCard label="HM" value={formatTraceMoney(product?.costBreakdown.machineCost)} />
            <MetricCard label="Overhead" value={formatTraceMoney(product?.costBreakdown.overheadCost)} />
            <MetricCard label="Total" value={formatTraceMoney(product?.costBreakdown.totalCost)} />
          </div>
          <p className="text-xs text-muted-foreground">Fonte: {product?.costBreakdown.source}</p>
        </TraceSectionCard>

        <TraceSectionCard title="BOM / componentes" empty={!product?.bom.included}>
          <SimpleTable
            headers={["SKU", "Nome", "Qtd", "Unit.", "Total", "%"]}
            rows={(product?.bom.components ?? []).slice(0, 50).map((row) => [
              row.sku,
              row.name,
              row.quantity,
              formatTraceMoney(row.unitCost),
              formatTraceMoney(row.totalCost),
              row.sharePercent != null ? formatTracePercent(row.sharePercent) : null,
            ])}
          />
        </TraceSectionCard>

        <TraceSectionCard title="Matéria-prima" empty={!product?.materials.included}>
          <SimpleTable
            headers={["#", "SKU", "Nome", "Consumo", "Unit.", "Total", "%"]}
            rows={(product?.materials.topCostRanking ?? []).slice(0, 20).map((row) => [
              row.rank,
              row.sku,
              row.name,
              row.quantity,
              formatTraceMoney(row.unitCost),
              formatTraceMoney(row.totalCost),
              row.sharePercent != null ? formatTracePercent(row.sharePercent) : null,
            ])}
          />
        </TraceSectionCard>

        <TraceSectionCard title="Processo HH/HM" empty={!product?.process.included}>
          <TraceRow label="Ciclo (s)" value={product?.process.cycleTimeSeconds} />
          <TraceRow label="Cavidades" value={product?.process.cavities} />
          <TraceRow label="HH" value={formatTraceMoney(product?.process.laborCost)} />
          <TraceRow label="HM" value={formatTraceMoney(product?.process.machineCost)} />
          <TraceRow
            label="Eficiência (%)"
            value={product?.process.efficiencyExpectedPercent ?? TRACE_PAGE_UNAVAILABLE}
          />
          <TraceRow label="Fonte" value={product?.process.source} />
        </TraceSectionCard>

        <TraceSectionCard title="Preços comerciais publicados (referência)">
          {(product?.commercialPrices ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{TRACE_PAGE_UNAVAILABLE}</p>
          ) : (
            <SimpleTable
              headers={["Tabela", "Versão", "Preço", "Custo congelado", "Publicado em"]}
              rows={(product?.commercialPrices ?? []).map((row) => [
                row.priceTableCode,
                row.versionNumber,
                formatTraceMoney(row.salePrice),
                formatTraceMoney(row.frozenTotalCost),
                formatTraceDate(row.publishedAt),
              ])}
            />
          )}
        </TraceSectionCard>
      </div>
    );
  }

  if (activeTab === "price") {
    if (!hasPublishedPriceData(sections)) {
      return (
        <CommissionsEmptyState
          title="Preço publicado não encontrado"
          description="Informe SKU com tableCode ou selecione um item publicado."
          testId="trace-empty-price"
        />
      );
    }
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TraceSectionCard title="Preço comercial publicado">
          <TraceRow label="Tabela" value={publishedPrice?.commercialPrice.tableCode} />
          <TraceRow label="Versão" value={publishedPrice?.commercialPrice.versionNumber} />
          <TraceRow label="Preço" value={formatTraceMoney(publishedPrice?.commercialPrice.salePrice)} />
          <TraceRow label="Vigência de" value={formatTraceDate(publishedPrice?.commercialPrice.effectiveFrom)} />
          <TraceRow label="Publicado em" value={formatTraceDate(publishedPrice?.commercialPrice.publishedAt)} />
        </TraceSectionCard>
        <TraceSectionCard title="Custo congelado na publicação">
          <TraceRow label="Versão custo" value={publishedPrice?.costSource.productionCostTableCode} />
          <TraceRow label="Revisão" value={publishedPrice?.costSource.productionCostRevision} />
          <TraceRow label="Custo industrial" value={formatTraceMoney(publishedPrice?.costSource.industrialCost)} />
          <TraceRow label="MP no preço" value={formatTraceMoney(publishedPrice?.costSource.materialCostInPrice)} />
          <TraceRow label="HH no preço" value={formatTraceMoney(publishedPrice?.costSource.laborCostInPrice)} />
          <TraceRow label="HM no preço" value={formatTraceMoney(publishedPrice?.costSource.machineCostInPrice)} />
        </TraceSectionCard>
      </div>
    );
  }

  if (activeTab === "sales") {
    if (!hasSalesOrderData(sections)) {
      return (
        <CommissionsEmptyState
          title="Sem venda encontrada"
          description="Nenhum pedido Nomus vinculado aos filtros informados."
          testId="trace-empty-sales"
        />
      );
    }
    return (
      <div className="space-y-4">
        <TraceSectionCard title="Pedido Nomus">
          <TraceRow label="Pedido" value={salesOrder?.order?.orderNumber} />
          <TraceRow label="Cliente" value={salesOrder?.order?.customerName} />
          <TraceRow label="Vendedor" value={salesOrder?.order?.canonicalSellerName ?? salesOrder?.order?.rawSellerName} />
          <TraceRow label="Emissão" value={formatTraceDate(salesOrder?.order?.issueDate)} />
          <TraceRow label="Total líquido" value={formatTraceMoney(salesOrder?.totals.totalSold)} />
          <TraceRow label="Margem" value={formatTracePercent(salesOrder?.totals.totalMarginPercent)} />
        </TraceSectionCard>

        <TraceSectionCard title="Itens da venda">
          <SimpleTable
            headers={["SKU", "Produto", "Vendido", "Custo oficial", "Margem %", "Fonte custo"]}
            rows={(salesOrder?.items ?? []).map((item) => [
              item.sku,
              item.productName,
              formatTraceMoney(item.soldAmount),
              formatTraceMoney(item.officialTotalCost),
              formatTracePercent(item.marginPercent),
              item.costSource ?? TRACE_PAGE_UNAVAILABLE,
            ])}
          />
        </TraceSectionCard>

        <TraceSectionCard title="Notas fiscais" empty={(salesOrder?.nfes ?? []).length === 0}>
          <SimpleTable
            headers={["NF", "Série", "Processamento"]}
            rows={(salesOrder?.nfes ?? []).map((nfe) => [
              nfe.nfeNumber,
              nfe.nfeSerie,
              formatTraceDate(nfe.dataProcessamento),
            ])}
          />
        </TraceSectionCard>
      </div>
    );
  }

  if (activeTab === "commission") {
    if (!hasCommissionData(sections)) {
      return (
        <CommissionsEmptyState
          title="Sem comissão encontrada"
          description="Pedido sem snapshot/schedule de comissão materializado."
          testId="trace-empty-commission"
        />
      );
    }
    return (
      <div className="space-y-4">
        <MetricCardGrid>
          <MetricCard label="Comissão bruta" value={formatTraceMoney(commission?.totals.totalGrossCommission)} />
          <MetricCard label="Comissão final" value={formatTraceMoney(commission?.totals.totalFinalCommission)} />
          <MetricCard label="Liberada" value={formatTraceMoney(commission?.totals.totalReleasedCommission)} />
          <MetricCard label="Pendente" value={formatTraceMoney(commission?.totals.totalPendingCommission)} />
        </MetricCardGrid>

        <TraceSectionCard title="Comissão por item">
          <SimpleTable
            headers={["SKU", "Produto", "Vendido", "Regra", "Comissão final"]}
            rows={(commission?.items ?? []).map((item) => [
              item.sku,
              item.productName,
              formatTraceMoney(item.soldAmount),
              item.ruleName ?? item.status,
              formatTraceMoney(item.finalCommissionAmount),
            ])}
          />
        </TraceSectionCard>

        <TraceSectionCard title="Títulos a receber">
          <SimpleTable
            headers={["AR", "Valor", "% venda", "Programada", "Status"]}
            rows={(commission?.receivables ?? []).map((row) => [
              row.receivableCode,
              formatTraceMoney(row.nominalAmount),
              row.sharePercent != null ? formatTracePercent(row.sharePercent) : null,
              formatTraceMoney(row.scheduledCommissionAmount),
              row.ledgerStatus,
            ])}
          />
        </TraceSectionCard>

        <TraceSectionCard title="Recebimentos e comissão liberada">
          <SimpleTable
            headers={["AR", "Baixa", "Recebido", "Liberada", "Pendente", "Status"]}
            rows={(commission?.receipts ?? []).map((row) => [
              row.receivableCode,
              formatTraceDate(row.settlementDate),
              formatTraceMoney(row.amountReceived),
              formatTraceMoney(row.releasedCommissionAmount),
              formatTraceMoney(row.pendingCommissionAmount),
              row.status,
            ])}
          />
        </TraceSectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {onCopyDiagnostics ? (
        <div className="flex justify-end">
          <button type="button" className={financeBiButtonOutlineClass} onClick={onCopyDiagnostics}>
            <Copy className="h-4 w-4" />
            Copiar diagnósticos
          </button>
        </div>
      ) : null}
      {data.diagnostics.length === 0 && data.warnings.length === 0 && data.errors.length === 0 ? (
        <CommissionsEmptyState title="Sem diagnósticos" description="Nenhum alerta para esta consulta." />
      ) : null}
      {data.errors.map((item) => (
        <ExecutiveAlert
          key={`err-${item.code}-${item.message}`}
          variant="danger"
          title={item.code}
          description={item.message}
        />
      ))}
      {data.warnings.map((item) => (
        <div
          key={`warn-${item.code}-${item.message}`}
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>{item.code}</strong> — {item.message}
          </span>
        </div>
      ))}
      {data.diagnostics.map((item) => (
        <div key={`diag-${item.source}-${item.code}`} className="rounded-lg border border-border px-3 py-2 text-sm">
          <span className="font-semibold">{item.source}</span> · {item.code} · {item.message}
        </div>
      ))}
    </div>
  );
}

export { TRACE_TABS, type TraceTabId };

export function CostToCashTraceSummary({
  data,
}: {
  data: CostToCashTracePageData | null;
}) {
  if (!data) return null;
  const cards = buildTraceSummaryCards(data);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
            apiStatusChipClass(data.status)
          )}
        >
          {data.status}
        </span>
        {data.summary.calculationMode ? (
          <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
            {data.summary.calculationMode}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Auditado em {formatTraceDate(data.summary.auditedAt)}
        </span>
      </div>

      {(data.sections.chain ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {data.sections.chain.map((link) => (
            <span
              key={link.stage}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
                chainStatusChipClass(link.status)
              )}
            >
              {link.stage}: {link.label}
            </span>
          ))}
        </div>
      ) : null}

      <MetricCardGrid>
        {cards.map((card) => (
          <MetricCard key={card.label} label={card.label} value={card.value} subtitle={card.meta} />
        ))}
      </MetricCardGrid>
    </div>
  );
}
