import React from "react";
import type { FinanceCashFlowExecutiveYtdTotals } from "@/src/lib/financeCashFlowExecutiveYtd";
import { formatCashFlowKpiDisplay } from "@/src/lib/financeCashFlowDisplay";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

function TotalLine({
  label,
  value,
  colorClass,
  testId,
}: {
  label: string;
  value: { display: string; full: string };
  colorClass: string;
  testId: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1" data-testid={testId}>
      <span className="text-[10px] text-[#6B7280] leading-tight">{label}</span>
      <span
        className={`text-sm font-bold tabular-nums shrink-0 ${colorClass}`}
        title={value.full}
      >
        {value.display}
      </span>
    </div>
  );
}

function SidePanel({
  title,
  titleClass,
  children,
  testId,
}: {
  title: string;
  titleClass: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`${financeBiCardClass} px-3 py-2.5 border border-[#E5E7EB] bg-white`}
    >
      <p className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${titleClass}`}>
        {title}
      </p>
      <div className="divide-y divide-[#F3F4F6]">{children}</div>
    </div>
  );
}

export function FinanceCashFlowYtdTotalsPanel({
  totals,
}: {
  totals: FinanceCashFlowExecutiveYtdTotals;
}) {
  const arTotal = formatCashFlowKpiDisplay(totals.receivable.totalAmount);
  const arReceived = formatCashFlowKpiDisplay(totals.receivable.receivedAmount);
  const arOpen = formatCashFlowKpiDisplay(totals.receivable.openAmount);
  const apTotal = formatCashFlowKpiDisplay(totals.payable.totalAmount);
  const apPaid = formatCashFlowKpiDisplay(totals.payable.paidAmount);
  const apOpen = formatCashFlowKpiDisplay(totals.payable.openAmount);

  return (
    <div data-testid="cash-flow-ytd-totals-panel" className="space-y-1.5">
      <div>
        <h3 className="text-[11px] font-bold text-[#111827]">Totais financeiros YTD</h3>
        <p className="text-[10px] text-[#6B7280]">
          Carteira saneada de contas a receber e contas a pagar no ano selecionado.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <SidePanel title="A RECEBER" titleClass="text-[#059669]" testId="ytd-totals-receivable">
          <TotalLine
            label="Valor a receber"
            value={arTotal}
            colorClass="text-[#059669]"
            testId="ytd-totals-ar-total"
          />
          <TotalLine
            label="Valor recebido"
            value={arReceived}
            colorClass="text-[#059669]"
            testId="ytd-totals-ar-received"
          />
          <TotalLine
            label="Valor em aberto receber"
            value={arOpen}
            colorClass="text-[#059669]"
            testId="ytd-totals-ar-open"
          />
        </SidePanel>
        <SidePanel title="A PAGAR" titleClass="text-[#DC2626]" testId="ytd-totals-payable">
          <TotalLine
            label="Valor a pagar total"
            value={apTotal}
            colorClass="text-[#DC2626]"
            testId="ytd-totals-ap-total"
          />
          <TotalLine
            label="Valor pago"
            value={apPaid}
            colorClass="text-[#059669]"
            testId="ytd-totals-ap-paid"
          />
          <TotalLine
            label="Valor em aberto pagar"
            value={apOpen}
            colorClass="text-[#DC2626]"
            testId="ytd-totals-ap-open"
          />
        </SidePanel>
      </div>
    </div>
  );
}
