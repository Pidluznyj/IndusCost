import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Scale,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";

type ComparisonPayload = {
  purchaseOrder: {
    id: string;
    code: string;
    status: string;
    supplierName: string;
    currency: string;
  };
  comparison: {
    currency: string;
    prices: {
      initialComparable: number;
      negotiatedComparable: number;
      orderComparable: number;
      realizedComparable: number;
    };
    gains: {
      negotiatedGain: number;
      realizedGain: number;
      unrealizedGain: number;
      gainErosionTotal: number;
      gainErosionBreakdown: {
        priceDivergence: number;
        freight: number;
        taxes: number;
        expenses: number;
      };
    };
    quantities: {
      ordered: number;
      acceptedConfirmed: number;
      pending: number;
      variation: number;
    };
    lines: Array<{
      purchaseOrderItemId: string;
      description: string;
      quantityOrdered: number;
      quantityAcceptedConfirmed: number;
      quantityPending: number;
      quantityVariation: number;
      initialUnitPrice: number | null;
      negotiatedUnitPrice: number;
      orderUnitPrice: number;
      receivedUnitCost: number | null;
      negotiatedUnitGain: number | null;
      realizedGain: number;
      unrealizedGain: number;
      gainErosion: { total: number };
      outsideNegotiatedCondition: boolean;
    }>;
    alerts: Array<{
      code: string;
      severity: string;
      message: string;
      amount?: number | null;
    }>;
    meta: { negotiationMeritImmutable: boolean };
  };
  meta: { doesNotMutateNegotiationHistory: boolean };
};

function money(v: number | null | undefined, currency = "BRL"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export function PurchaseSavingsComparisonModule() {
  const { orderId } = useParams<{ orderId: string }>();
  const auth = useAuth();
  const permissions = usePermissions();
  const allowView =
    auth.hasPermission("purchases.view") ||
    permissions.canViewResource(OPERATIONS_RESOURCE_KEYS.purchases);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ComparisonPayload | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    const row = await fetchJsonOk<ComparisonPayload>(
      `/api/purchase-orders/${orderId}/savings-comparison`
    );
    setData(row);
  }, [orderId]);

  useEffect(() => {
    if (!allowView || !orderId) return;
    setLoading(true);
    void load()
      .catch((e) => alert(e instanceof Error ? e.message : "Erro ao carregar comparação."))
      .finally(() => setLoading(false));
  }, [allowView, orderId, load]);

  if (!allowView) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="savings-comparison-denied">
        Sem permissão para ver a comparação de ganhos.
      </p>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando comparação financeira…
      </div>
    );
  }

  const { comparison, purchaseOrder } = data;
  const currency = comparison.currency || purchaseOrder.currency || "BRL";

  return (
    <div className="space-y-6" data-testid="savings-comparison">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <Link
            to={`/purchases/orders/${purchaseOrder.id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao pedido
          </Link>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Ganho negociado × realizado — {purchaseOrder.code}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {purchaseOrder.supplierName} · O mérito histórico da negociação permanece imutável; o
            realizado reflete apenas quantidades confirmadas no recebimento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/purchases/receiving/${purchaseOrder.id}`}
            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent"
          >
            Recebimento
          </Link>
        </div>
      </div>

      <div
        className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
        data-testid="savings-merit-banner"
      >
        <strong>Negociado ≠ realizado.</strong> Preço inicial, negociado e do pedido preservam o
        histórico. O ganho realizado usa custo efetivo recebido na base comparável (itens + frete +
        impostos + despesas − descontos), com suporte a recebimento parcial.
      </div>

      <SummaryKpiGrid minColumnWidth={150} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="savings-card-negotiated"
          label="Ganho negociado"
          amount={comparison.gains.negotiatedGain}
          amountFormat="currency"
          tone="money"
          icon={TrendingDown}
          helperText="Mérito histórico (imutável)"
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="savings-card-realized"
          label="Ganho realizado"
          amount={comparison.gains.realizedGain}
          amountFormat="currency"
          tone="success"
          icon={CheckCircle2}
          helperText="Qty aceita confirmada"
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="savings-card-unrealized"
          label="Ainda não realizado"
          amount={comparison.gains.unrealizedGain}
          amountFormat="currency"
          tone="warning"
          icon={TrendingUp}
          helperText="Qty pendente"
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="savings-card-erosion"
          label="Perda do ganho"
          amount={comparison.gains.gainErosionTotal}
          amountFormat="currency"
          tone="danger"
          icon={AlertTriangle}
          helperText="Frete / imposto / despesa / divergência"
        />
      </SummaryKpiGrid>

      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 text-sm font-medium">
          Base comparável de preços
        </div>
        <table className="w-full text-sm" data-testid="savings-prices-table">
          <thead className="bg-muted/20 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Inicial</th>
              <th className="p-3">Negociado</th>
              <th className="p-3">Pedido</th>
              <th className="p-3">Custo efetivo recebido</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="p-3">{money(comparison.prices.initialComparable, currency)}</td>
              <td className="p-3">{money(comparison.prices.negotiatedComparable, currency)}</td>
              <td className="p-3">{money(comparison.prices.orderComparable, currency)}</td>
              <td className="p-3">{money(comparison.prices.realizedComparable, currency)}</td>
            </tr>
          </tbody>
        </table>
        <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
          Quantidades — pedida {qty(comparison.quantities.ordered)} · aceita{" "}
          {qty(comparison.quantities.acceptedConfirmed)} · pendente{" "}
          {qty(comparison.quantities.pending)} · variação {qty(comparison.quantities.variation)}
        </div>
        <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
          Erosão — preço {money(comparison.gains.gainErosionBreakdown.priceDivergence, currency)} ·
          frete {money(comparison.gains.gainErosionBreakdown.freight, currency)} · imposto{" "}
          {money(comparison.gains.gainErosionBreakdown.taxes, currency)} · despesa{" "}
          {money(comparison.gains.gainErosionBreakdown.expenses, currency)}
        </div>
      </div>

      {comparison.alerts.length > 0 ? (
        <div className="space-y-2" data-testid="savings-alerts">
          <h4 className="text-sm font-medium">Alertas</h4>
          {comparison.alerts.map((a, idx) => (
            <div
              key={`${a.code}-${idx}`}
              className={
                a.severity === "critical"
                  ? "rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-950"
                  : a.severity === "warning"
                    ? "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                    : "rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm"
              }
            >
              <span className="font-mono text-[10px] uppercase tracking-wide mr-2">{a.code}</span>
              {a.message}
              {a.amount != null ? ` (${money(a.amount, currency)})` : ""}
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 text-sm font-medium">
          Por linha — negociado vs concretizado
        </div>
        <table className="w-full text-sm" data-testid="savings-lines-table">
          <thead className="bg-muted/20 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Item</th>
              <th className="p-3">P. inicial</th>
              <th className="p-3">P. pedido</th>
              <th className="p-3">Custo rec.</th>
              <th className="p-3">Qty</th>
              <th className="p-3">Ganho neg. un.</th>
              <th className="p-3">Realizado</th>
              <th className="p-3">Não realizado</th>
              <th className="p-3">Erosão</th>
            </tr>
          </thead>
          <tbody>
            {comparison.lines.map((line) => (
              <tr
                key={line.purchaseOrderItemId}
                className={`border-t border-border ${
                  line.outsideNegotiatedCondition ? "bg-amber-50/40" : ""
                }`}
              >
                <td className="p-3">
                  <div className="font-medium">{line.description}</div>
                  {line.outsideNegotiatedCondition ? (
                    <div className="text-[10px] uppercase text-amber-800">fora da condição</div>
                  ) : null}
                </td>
                <td className="p-3">{money(line.initialUnitPrice, currency)}</td>
                <td className="p-3">{money(line.orderUnitPrice, currency)}</td>
                <td className="p-3">{money(line.receivedUnitCost, currency)}</td>
                <td className="p-3 text-xs">
                  {qty(line.quantityAcceptedConfirmed)}/{qty(line.quantityOrdered)}
                  <div className="text-muted-foreground">pend. {qty(line.quantityPending)}</div>
                </td>
                <td className="p-3">{money(line.negotiatedUnitGain, currency)}</td>
                <td className="p-3">{money(line.realizedGain, currency)}</td>
                <td className="p-3">{money(line.unrealizedGain, currency)}</td>
                <td className="p-3">{money(line.gainErosion.total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
