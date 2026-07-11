import React from "react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";
import {
  FINANCIAL_STATUS_LABEL,
  OPERATIONAL_STATUS_LABEL,
} from "@/src/lib/finance/portfolioOrderFulfillmentMap";
import type { PortfolioIntelligenceOrderDetail } from "@/src/lib/financePortfolioReconciliationClient";

function pctDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.min(100, Math.max(0, value)).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}%`;
}

function hasAlert(alerts: readonly string[] | undefined, code: string): boolean {
  return (alerts ?? []).includes(code);
}

function financialTone(code: string | null | undefined): string {
  switch (code) {
    case "FIN_RECEBIDO":
      return "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]";
    case "FIN_CR_ABERTO":
      return "border-[#B2DDFF] bg-[#EFF8FF] text-[#175CD3]";
    case "FIN_FATURADO_SEM_CR":
      return "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]";
    case "FIN_SEM_CR":
    default:
      return "border-[#D0D5DD] bg-[#F2F4F7] text-[#667085]";
  }
}

function operationalTone(code: string | null | undefined): string {
  switch (code) {
    case "OP_TOTALMENTE_ATENDIDO":
      return "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]";
    case "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE":
      return "border-[#FDBA74] bg-[#FFF6ED] text-[#C2410C]";
    case "OP_PARCIALMENTE_ATENDIDO":
      return "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]";
    case "OP_NAO_ATENDIDO":
      return "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]";
    case "OP_DOCUMENTO_SEM_ITEMIZACAO":
    case "OP_VINCULO_APENAS_CABECALHO":
      return "border-[#FEDF89] bg-[#F2F4F7] text-[#B54708]";
    default:
      return "border-[#D0D5DD] bg-[#F2F4F7] text-[#667085]";
  }
}

function nextDueDate(detail: PortfolioIntelligenceOrderDetail): string | null {
  const fromMap = detail.fulfillmentMap?.receivablesCoverage
    ?.map((r) => r.dueDate)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  if (fromMap) return fromMap;
  return detail.dates.receivableDueDate ?? null;
}

export function PortfolioFulfillmentStatusCards({
  detail,
}: {
  detail: PortfolioIntelligenceOrderDetail;
}) {
  const map = detail.fulfillmentMap;
  const s = map?.fulfillmentSummary;
  const finCode =
    map?.financialStatus ?? detail.classification.financialStatus ?? null;
  const opCode =
    map?.operationalStatus ?? detail.classification.operationalStatus ?? null;
  const finLabel =
    map?.financialStatusLabel ??
    (finCode
      ? FINANCIAL_STATUS_LABEL[finCode as keyof typeof FINANCIAL_STATUS_LABEL]
      : null) ??
    "—";
  const opLabel =
    map?.operationalStatusLabel ??
    (opCode
      ? OPERATIONAL_STATUS_LABEL[opCode as keyof typeof OPERATIONAL_STATUS_LABEL]
      : null) ??
    "—";
  const alerts = map?.technicalAlerts ?? detail.classification.technicalAlerts ?? [];
  const items = map?.orderItemsCoverage ?? [];
  const attendedItems = items.filter(
    (r) => (r.attendedQuantityCapped ?? r.attendedQuantity) > 0.000001
  ).length;
  const pendingItems = items.filter((r) => r.remainingQuantity > 0.000001).length;
  const due = nextDueDate(detail);

  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      data-testid="portfolio-intelligence-drawer-axes"
    >
      <div
        className={cn("rounded-xl border px-3 py-2.5", financialTone(finCode))}
        data-testid="portfolio-fulfillment-card-financeiro"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
          Financeiro
        </p>
        <p className="mt-1 text-sm font-bold leading-snug">{finLabel}</p>
        <dl className="mt-2 space-y-1 text-[11px] opacity-90">
          <div className="flex justify-between gap-2">
            <dt>Valor CR</dt>
            <dd className="tabular-nums font-semibold">
              {formatFinanceCurrency(
                s?.receivableTotalValue ??
                  s?.receivableTotal ??
                  detail.values.receivableTotalValue
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Recebido</dt>
            <dd className="tabular-nums font-semibold">
              {formatFinanceCurrency(s?.receivedValue ?? detail.values.receivedValue)}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Aberto</dt>
            <dd className="tabular-nums font-semibold">
              {formatFinanceCurrency(
                s?.openReceivableValue ?? detail.values.openReceivableValue
              )}
            </dd>
          </div>
          {due ? (
            <div className="flex justify-between gap-2">
              <dt>Próx. vencimento</dt>
              <dd className="tabular-nums font-semibold">
                {formatFinanceDate(due)}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div
        className={cn("rounded-xl border px-3 py-2.5", operationalTone(opCode))}
        data-testid="portfolio-fulfillment-card-atendimento"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
          Atendimento
        </p>
        <p className="mt-1 text-sm font-bold leading-snug">
          {pctDisplay(s?.fulfillmentPercent)} · {opLabel}
        </p>
        <dl className="mt-2 space-y-1 text-[11px] opacity-90">
          <div className="flex justify-between gap-2">
            <dt>Itens atendidos</dt>
            <dd className="tabular-nums font-semibold">{attendedItems}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Itens pendentes</dt>
            <dd className="tabular-nums font-semibold">{pendingItems}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Qtde excedente</dt>
            <dd className="tabular-nums font-semibold">
              {formatFinanceInteger(s?.totalExcessQuantity ?? 0)}
            </dd>
          </div>
        </dl>
      </div>

      <div
        className="rounded-xl border border-[#FDBA74] bg-[#FFF6ED] px-3 py-2.5 text-[#C2410C]"
        data-testid="portfolio-fulfillment-card-alertas"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
          Alertas técnicos
        </p>
        <p className="mt-1 text-sm font-bold leading-snug">
          {alerts.length} alerta{alerts.length === 1 ? "" : "s"}
        </p>
        <p className="mt-0.5 text-[10px] leading-snug opacity-80">
          Não somam carteira
        </p>
        <ul className="mt-2 space-y-1 text-[11px]">
          <li className="flex justify-between gap-2">
            <span>NF maior que pedido</span>
            <span className="font-semibold">
              {hasAlert(alerts, "NF_CABECALHO_MAIOR_PEDIDO") || s?.hasHeaderInflationRisk
                ? "Sim"
                : "Não"}
            </span>
          </li>
          <li className="flex justify-between gap-2">
            <span>Divergência de preço</span>
            <span className="font-semibold">
              {hasAlert(alerts, "DIVERGENCIA_PRECO") ? "Sim" : "Não"}
            </span>
          </li>
          <li className="flex justify-between gap-2">
            <span>Produto fora do pedido</span>
            <span className="font-semibold">
              {hasAlert(alerts, "PRODUTO_FORA_DO_PEDIDO") || s?.hasProductsOutsideOrder
                ? "Sim"
                : "Não"}
            </span>
          </li>
          <li className="flex justify-between gap-2">
            <span>Excesso</span>
            <span className="font-semibold">
              {hasAlert(alerts, "QUANTIDADE_EXCEDENTE_DOCUMENTO") || s?.hasExcessQuantity
                ? "Sim"
                : "Não"}
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
