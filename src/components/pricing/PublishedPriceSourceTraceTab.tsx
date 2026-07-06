import { AlertTriangle } from "lucide-react";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import {
  PUBLISHED_TRACE_UNAVAILABLE_LABEL,
  type PublishedPriceSourceTrace,
  type PublishedTraceStatus,
} from "@/src/lib/pricing/publishedPriceSourceTrace";
import { formatPublishedAtLabel } from "@/src/lib/pricing/commercialPublishedPricesUi";

type PublishedPriceSourceTraceTabProps = {
  trace: PublishedPriceSourceTrace | null;
  loading: boolean;
  error: string | null;
  clickedSalePrice?: number | null;
};

function TraceValue({
  value,
  status,
  format,
}: {
  value: string | number | null | undefined;
  status?: PublishedTraceStatus;
  format?: (value: number) => string;
}) {
  if (value == null || status === "NOT_AVAILABLE") {
    return <span className="text-sm text-muted-foreground italic">{PUBLISHED_TRACE_UNAVAILABLE_LABEL}</span>;
  }
  if (typeof value === "number" && format) {
    return <span className="text-sm font-semibold">{format(value)}</span>;
  }
  return <span className="text-sm font-semibold">{value}</span>;
}

function TraceCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function TraceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  );
}

export function PublishedPriceSourceTraceTab({
  trace,
  loading,
  error,
  clickedSalePrice,
}: PublishedPriceSourceTraceTabProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-accent/20 px-4 py-8 text-center text-sm text-muted-foreground">
        Carregando rastreabilidade do preço publicado…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!trace) {
    return (
      <div className="rounded-xl border border-border bg-accent/20 px-4 py-3 text-sm text-muted-foreground">
        Rastreabilidade disponível apenas para preços publicados do grid.
      </div>
    );
  }

  const priceMatchesCell =
    clickedSalePrice == null ||
    trace.commercialPrice.salePrice == null ||
    Math.abs(trace.commercialPrice.salePrice - clickedSalePrice) < 0.000001;

  return (
    <div className="space-y-4">
      {!priceMatchesCell ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          O preço rastreado ({formatCurrency(trace.commercialPrice.salePrice ?? 0, 2)}) difere da célula clicada (
          {formatCurrency(clickedSalePrice ?? 0, 2)}).
        </div>
      ) : null}

      {trace.costSource.newerPublishedVersionWarning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{trace.costSource.newerPublishedVersionWarning}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TraceCard title="Produto">
          <TraceRow label="SKU">
            <TraceValue value={trace.product.sku} status={trace.product.status} />
          </TraceRow>
          <TraceRow label="Nome">
            <TraceValue value={trace.product.name} status={trace.product.status} />
          </TraceRow>
          <TraceRow label="Tipo">
            <TraceValue value={trace.product.type} status={trace.product.type ? "AVAILABLE" : "NOT_AVAILABLE"} />
          </TraceRow>
        </TraceCard>

        <TraceCard title="Tabela comercial publicada">
          <TraceRow label="Tabela">
            <TraceValue
              value={`${trace.commercialPrice.tableName} (${trace.commercialPrice.tableCode})`}
              status={trace.commercialPrice.status}
            />
          </TraceRow>
          <TraceRow label="Versão">
            <TraceValue
              value={`v${trace.commercialPrice.versionNumber}`}
              status={trace.commercialPrice.status}
            />
          </TraceRow>
          <TraceRow label="Preço publicado">
            <TraceValue
              value={trace.commercialPrice.salePrice}
              status={trace.commercialPrice.status}
              format={(v) => formatCurrency(v, 2)}
            />
          </TraceRow>
          <TraceRow label="Publicado em">
            <TraceValue
              value={formatPublishedAtLabel(trace.commercialPrice.publishedAt)}
              status={trace.commercialPrice.publishedAt ? "AVAILABLE" : "NOT_AVAILABLE"}
            />
          </TraceRow>
          <TraceRow label="Vigência desde">
            <TraceValue
              value={formatPublishedAtLabel(trace.commercialPrice.effectiveFrom)}
              status={trace.commercialPrice.effectiveFrom ? "AVAILABLE" : "NOT_AVAILABLE"}
            />
          </TraceRow>
        </TraceCard>

        <TraceCard title="Custo de produção usado">
          <TraceRow label="Versão custo produção">
            <TraceValue
              value={
                trace.costSource.productionCostTableCode && trace.costSource.productionCostRevision != null
                  ? `${trace.costSource.productionCostTableCode} rev.${trace.costSource.productionCostRevision}`
                  : null
              }
              status={trace.costSource.status}
            />
          </TraceRow>
          <TraceRow label="Vigência custo">
            <TraceValue
              value={formatPublishedAtLabel(trace.costSource.productionCostEffectiveFrom)}
              status={trace.costSource.productionCostEffectiveFrom ? "AVAILABLE" : "NOT_AVAILABLE"}
            />
          </TraceRow>
          <TraceRow label="Custo industrial usado">
            <TraceValue
              value={trace.costSource.industrialCost}
              status={trace.costSource.status}
              format={(v) => formatCurrency(v, 2)}
            />
          </TraceRow>
          <TraceRow label="MP / HH / HM">
            <TraceValue
              value={
                trace.costSource.materialCostInPrice != null
                  ? `${formatCurrency(trace.costSource.materialCostInPrice, 2)} / ${formatCurrency(trace.costSource.laborCostInPrice ?? 0, 2)} / ${formatCurrency(trace.costSource.machineCostInPrice ?? 0, 2)}`
                  : null
              }
              status={trace.costSource.status}
            />
          </TraceRow>
          <TraceRow label="Custo gerencial">
            <TraceValue value={trace.costSource.managerialCost} status="NOT_AVAILABLE" />
          </TraceRow>
        </TraceCard>

        <TraceCard title="Custo de matéria-prima usado">
          <TraceRow label="Versão MP">
            <TraceValue
              value={
                trace.materialSource.materialCostTableCode && trace.materialSource.materialCostRevision != null
                  ? `${trace.materialSource.materialCostTableCode} rev.${trace.materialSource.materialCostRevision}`
                  : null
              }
              status={trace.materialSource.status}
            />
          </TraceRow>
          <TraceRow label="Vigência MP">
            <TraceValue
              value={formatPublishedAtLabel(trace.materialSource.materialCostEffectiveFrom)}
              status={trace.materialSource.materialCostEffectiveFrom ? "AVAILABLE" : "NOT_AVAILABLE"}
            />
          </TraceRow>
          <TraceRow label="MP no preço publicado">
            <TraceValue
              value={trace.materialSource.materialCostAmount}
              status={trace.materialSource.status}
              format={(v) => formatCurrency(v, 2)}
            />
          </TraceRow>
        </TraceCard>

        <TraceCard title="Regra fiscal">
          <TraceRow label="Regra">
            <TraceValue value={trace.taxSource.taxRuleName} status={trace.taxSource.status} />
          </TraceRow>
          <TraceRow label="Alíquota publicada">
            <TraceValue
              value={trace.taxSource.taxPercent}
              status={trace.taxSource.status}
              format={(v) => `${formatNumber(v, 2)}%`}
            />
          </TraceRow>
          <TraceRow label="Imposto publicado">
            <TraceValue
              value={trace.taxSource.taxAmount}
              status={trace.taxSource.status}
              format={(v) => formatCurrency(v, 2)}
            />
          </TraceRow>
        </TraceCard>

        <TraceCard title="Margem">
          <TraceRow label="Margem publicada">
            <TraceValue
              value={trace.marginSource.publishedMarginPercent}
              status={trace.marginSource.status}
              format={(v) => `${formatNumber(v, 2)}%`}
            />
          </TraceRow>
          <TraceRow label="Markup">
            <TraceValue
              value={trace.marginSource.markup}
              status={trace.marginSource.status}
              format={(v) => `${formatNumber(v, 2)}x`}
            />
          </TraceRow>
        </TraceCard>

        <TraceCard title="Comissão">
          <TraceRow label="Comissão publicada">
            <TraceValue
              value={trace.commissionSource.commissionPercent}
              status={trace.commissionSource.status}
              format={(v) => `${formatNumber(v, 2)}%`}
            />
          </TraceRow>
          <TraceRow label="Valor comissão">
            <TraceValue
              value={trace.commissionSource.commissionAmount}
              status={trace.commissionSource.status}
              format={(v) => formatCurrency(v, 2)}
            />
          </TraceRow>
          <TraceRow label="Fonte">
            <TraceValue value={trace.commissionSource.source} status={trace.commissionSource.source ? "AVAILABLE" : "NOT_AVAILABLE"} />
          </TraceRow>
        </TraceCard>

        <TraceCard title="Deduções">
          <TraceRow label="Frete">
            <TraceValue
              value={trace.deductions.freightAmount}
              status={trace.deductions.status}
              format={(v) => formatCurrency(v, 2)}
            />
          </TraceRow>
          <TraceRow label="Outras variáveis">
            <TraceValue
              value={trace.deductions.otherVariablesAmount}
              status={trace.deductions.status}
              format={(v) => formatCurrency(v, 2)}
            />
          </TraceRow>
          <TraceRow label="Arredondamento">
            <TraceValue value={trace.deductions.roundingAmount} status="NOT_AVAILABLE" />
          </TraceRow>
          <TraceRow label="Outras congeladas (total)">
            <TraceValue
              value={trace.deductions.frozenOtherCostTotal}
              status={trace.deductions.status}
              format={(v) => formatCurrency(v, 2)}
            />
          </TraceRow>
        </TraceCard>
      </div>

      {trace.availability.missingFields.length > 0 ? (
        <TraceCard title="Campos indisponíveis nesta versão">
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            {trace.availability.missingFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </TraceCard>
      ) : null}
    </div>
  );
}
