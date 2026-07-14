/**
 * Modelo de impressão / PDF — Encerramento de Prestação de Serviço.
 * Frontend-safe (sem Prisma).
 */

import { formatProportionalRestDaysLabel } from "./supplierServiceTerminationCalc.js";
import type { ServiceTerminationDto } from "./supplierServiceTerminationTypes.js";

export const SERVICE_TERMINATION_PRINT_DOCUMENT_TITLE = "ENCERRAMENTO";
export const SERVICE_TERMINATION_PRINT_SUBTITLE =
  "Verbas de encerramento de prestação de serviço — cálculo gerencial/contratual";
export const SERVICE_TERMINATION_PRINT_FOOTER_NOTE =
  "Documento gerado pelo IndusCost. Cálculo gerencial/contratual de encerramento de prestação de serviço. Não constitui rescisão trabalhista CLT.";

export function buildServiceTerminationPrintPath(
  supplierId: string,
  terminationId: string
): string {
  return `/finance/suppliers/${encodeURIComponent(supplierId)}/service-terminations/${encodeURIComponent(terminationId)}/print`;
}

export function formatServiceTerminationStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Prévia";
    case "FINALIZED":
      return "Finalizado";
    case "CANCELED":
      return "Cancelado";
    default:
      return status;
  }
}

export function formatServiceTerminationCalcModeLabel(mode: string): string {
  return mode === "WORKED_DAYS" ? "Por dias corridos" : "Por meses trabalhados";
}

export function formatServiceTerminationDateBr(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export type ServiceTerminationPrintMoneyRow = {
  label: string;
  value: number;
  emphasize?: boolean;
};

export type ServiceTerminationPrintCommissionRow = {
  orderCode: string;
  description: string;
  personName: string;
  source: string;
  amount: number;
};

export type ServiceTerminationPrintModel = {
  documentHighlight: string;
  supplierName: string;
  personName: string;
  personDocument: string;
  serviceRole: string;
  periodLabel: string;
  statusLabel: string;
  calcModeLabel: string;
  monthlyServiceAmount: number;
  monthlyHours: number;
  hourlyServiceAmount: number;
  dailyServiceAmount: number;
  restDaysPerYear: number;
  workedMonths: number;
  workedDays: number;
  proportionalRestDaysLabel: string;
  proportionalRestAmount: number;
  extraWorkedDays: number;
  extraWorkedAmount: number;
  noticePenaltyAmount: number;
  commissionReportTotal: number;
  otherCredits: number;
  otherDiscounts: number;
  otherAdjustments: number;
  totalTerminationAmount: number;
  notes: string | null;
  adjustmentNotes: string | null;
  commissionRows: ServiceTerminationPrintCommissionRow[];
  totalizationRows: ServiceTerminationPrintMoneyRow[];
};

export function buildServiceTerminationPrintModel(
  dto: ServiceTerminationDto
): ServiceTerminationPrintModel {
  const commissionRows: ServiceTerminationPrintCommissionRow[] = (
    dto.commissionLinks ?? []
  ).map((l) => ({
    orderCode: l.orderCode?.trim() || "—",
    description: l.periodLabel?.trim() || "—",
    personName: l.commissionPersonName?.trim() || "—",
    source:
      (l.source ?? "").toUpperCase() === "MANUAL"
        ? "Manual"
        : l.source?.trim() || "Relatório oficial",
    amount: l.commissionAmount,
  }));

  const totalizationRows: ServiceTerminationPrintMoneyRow[] = [
    { label: "Descanso remunerado proporcional", value: dto.proportionalRestAmount },
    { label: "Dias a mais trabalhados", value: dto.extraWorkedAmount },
    { label: "Multa sem aviso de 30 dias", value: dto.noticePenaltyAmount },
    { label: "Comissões (oficial + manual)", value: dto.commissionReportTotal },
    { label: "Outros créditos", value: dto.otherCredits },
    { label: "Outros descontos", value: -Math.abs(dto.otherDiscounts) },
    {
      label: "TOTAL A PAGAR",
      value: dto.totalTerminationAmount,
      emphasize: true,
    },
  ];

  return {
    documentHighlight: dto.personName?.trim() || dto.id.slice(0, 8),
    supplierName: dto.supplierName || "—",
    personName: dto.personName || "—",
    personDocument: dto.personDocument?.trim() || "—",
    serviceRole: dto.serviceRole?.trim() || "—",
    periodLabel: `${formatServiceTerminationDateBr(dto.contractStartDate)} a ${formatServiceTerminationDateBr(dto.contractEndDate)}`,
    statusLabel: formatServiceTerminationStatusLabel(dto.status),
    calcModeLabel: formatServiceTerminationCalcModeLabel(dto.calculationMode),
    monthlyServiceAmount: dto.monthlyServiceAmount,
    monthlyHours: dto.monthlyHours,
    hourlyServiceAmount: dto.hourlyServiceAmount,
    dailyServiceAmount: dto.dailyServiceAmount,
    restDaysPerYear: dto.restDaysPerYear,
    workedMonths: dto.workedMonths,
    workedDays: dto.workedDays,
    proportionalRestDaysLabel: formatProportionalRestDaysLabel(dto.proportionalRestDays),
    proportionalRestAmount: dto.proportionalRestAmount,
    extraWorkedDays: dto.extraWorkedDays,
    extraWorkedAmount: dto.extraWorkedAmount,
    noticePenaltyAmount: dto.noticePenaltyAmount,
    commissionReportTotal: dto.commissionReportTotal,
    otherCredits: dto.otherCredits,
    otherDiscounts: dto.otherDiscounts,
    otherAdjustments: dto.otherAdjustments,
    totalTerminationAmount: dto.totalTerminationAmount,
    notes: dto.notes?.trim() || null,
    adjustmentNotes: dto.adjustmentNotes?.trim() || null,
    commissionRows,
    totalizationRows,
  };
}
