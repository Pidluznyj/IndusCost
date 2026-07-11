import React from "react";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioIntelligenceOrderDetail } from "@/src/lib/financePortfolioReconciliationClient";
import { PortfolioFulfillmentItemsGrid } from "./PortfolioFulfillmentItemsGrid";
import { PortfolioFulfillmentDocumentsGrid } from "./PortfolioFulfillmentDocumentsGrid";
import { PortfolioFulfillmentReceivablesGrid } from "./PortfolioFulfillmentReceivablesGrid";
import { PortfolioOperationalDeviationAlertsPanel } from "./PortfolioOperationalDeviationAlertsPanel";
import { PortfolioOrderDataFreshnessPanel } from "./PortfolioOrderDataFreshnessPanel";

function pctDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.min(100, Math.max(0, value)).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}%`;
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#EAECF0] bg-white px-3 py-2.5">
      <p className="text-[12px] font-semibold text-[#667085]">{label}</p>
      <p className="mt-1 text-[20px] font-bold tabular-nums leading-tight text-[#101828]">
        {value}
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[16px] font-bold text-[#101828]">{children}</h3>
  );
}

export function PortfolioOrderFulfillmentMap({
  detail,
}: {
  detail: PortfolioIntelligenceOrderDetail;
}) {
  const map = detail.fulfillmentMap;
  if (!map) {
    return (
      <div className="space-y-5" data-testid="portfolio-intelligence-drawer-mapa">
        <p
          className="rounded-xl border border-dashed border-[#EAECF0] bg-[#F9FAFB] px-3 py-6 text-center text-sm text-[#667085]"
        >
          {detail.fulfillmentMapWarning?.trim() ||
            "Mapa de atendimento indisponível com os dados atuais."}
        </p>
        <PortfolioOperationalDeviationAlertsPanel
          alerts={detail.operationalDeviationAlerts}
        />
        <PortfolioOrderDataFreshnessPanel freshness={detail.dataFreshness} />
      </div>
    );
  }

  const s = map.fulfillmentSummary;
  const alerts =
    detail.operationalDeviationAlerts ?? map.operationalDeviationAlerts ?? [];

  return (
    <div className="space-y-5" data-testid="portfolio-intelligence-drawer-mapa">
      <div>
        <SectionTitle>Resumo do atendimento</SectionTitle>
        <div
          className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="portfolio-intelligence-drawer-mapa-resumo"
        >
          <MiniCard label="Valor do pedido" value={formatFinanceCurrency(s.orderValue)} />
          <MiniCard
            label="Valor atribuído ao pedido"
            value={formatFinanceCurrency(
              s.attributedOrderValueByOrderPrice ?? s.attributedOrderValue
            )}
          />
          <MiniCard
            label="Valor cabeçalho NF/documento"
            value={formatFinanceCurrency(s.nfeHeaderTotalValue ?? s.nfeHeaderTotal)}
          />
          <MiniCard
            label="Valor fora deste pedido"
            value={formatFinanceCurrency(
              s.nfeHeaderNotAttributedToOrderValue ?? s.nfeHeaderNotAttributed
            )}
          />
          <MiniCard
            label="Quantidade pedida"
            value={formatFinanceInteger(s.totalOrderedQuantity ?? s.totalOrderQuantity)}
          />
          <MiniCard
            label="Quantidade atendida"
            value={formatFinanceInteger(
              s.totalAttendedQuantityCapped ?? s.attendedQuantity
            )}
          />
          <MiniCard
            label="Quantidade faltante"
            value={formatFinanceInteger(s.totalRemainingQuantity ?? s.remainingQuantity)}
          />
          <MiniCard
            label="Quantidade excedente"
            value={formatFinanceInteger(s.totalExcessQuantity ?? 0)}
          />
          <MiniCard label="% atendimento" value={pctDisplay(s.fulfillmentPercent)} />
        </div>
      </div>

      {s.hasHeaderInflationRisk ? (
        <p className="rounded-xl border border-[#FDBA74] bg-[#FFF6ED] px-3 py-2 text-xs text-[#C2410C]">
          Cabeçalho de NF ({formatFinanceCurrency(s.nfeHeaderTotalValue ?? s.nfeHeaderTotal)})
          é maior que o valor do pedido ({formatFinanceCurrency(s.orderValue)}). O cabeçalho{" "}
          <strong>não</strong> é o valor do pedido e não deve ser somado à carteira.
        </p>
      ) : null}

      <PortfolioOperationalDeviationAlertsPanel alerts={alerts} />

      <PortfolioOrderDataFreshnessPanel freshness={detail.dataFreshness} />

      <div className="space-y-2">
        <SectionTitle>Itens do pedido</SectionTitle>
        <PortfolioFulfillmentItemsGrid rows={map.orderItemsCoverage} />
      </div>

      <div className="space-y-2">
        <SectionTitle>Documentos de saída</SectionTitle>
        <PortfolioFulfillmentDocumentsGrid rows={map.stockDocumentsCoverage} />
      </div>

      <div className="space-y-2">
        <SectionTitle>Contas a Receber</SectionTitle>
        <PortfolioFulfillmentReceivablesGrid rows={map.receivablesCoverage} />
      </div>

      <div className="space-y-2">
        <SectionTitle>Conclusão executiva</SectionTitle>
        <p
          className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-4 text-sm leading-relaxed text-[#344054]"
          data-testid="portfolio-intelligence-drawer-executive"
        >
          {map.executiveConclusion}
        </p>
      </div>
    </div>
  );
}
