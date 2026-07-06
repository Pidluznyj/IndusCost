/**
 * Rótulos padronizados de status de comissão — fonte única para tabelas, filtros e gráficos.
 */

export const COMMISSION_RECORD_STATUS_LABELS: Record<string, string> = {
  FORECAST_FROM_ORDER: "Prevista pelo Pedido",
  WAITING_NFE: "Aguardando NF-e",
  SUPERSEDED_BY_OUTPUT_DOCUMENT: "Substituída por Documento de Saída",
  CONFIRMED_BY_OUTPUT_DOCUMENT: "Confirmada por Documento de Saída",
  WAITING_RECEIVABLE: "Aguardando Contas a Receber",
  WAITING_PAYMENT: "Aguardando recebimento",
  PARTIALLY_RELEASED: "Liberada parcial",
  RELEASED: "Liberada total",
  PAID_PARTIAL: "Paga parcial",
  PAID_TOTAL: "Paga total",
  CANCELLED: "Cancelada",
  REVERSED: "Estornada",
  ERROR: "Erro/Auditoria",
};

export function formatCommissionRecordStatus(status: string): string {
  return COMMISSION_RECORD_STATUS_LABELS[status] ?? status;
}

/** @deprecated Use formatCommissionRecordStatus */
export const formatCommissionStatus = formatCommissionRecordStatus;

/** @deprecated Use COMMISSION_RECORD_STATUS_LABELS */
export const COMMISSION_STATUS_LABELS = COMMISSION_RECORD_STATUS_LABELS;

function option(value: string, label?: string) {
  return { value, label: label ?? COMMISSION_RECORD_STATUS_LABELS[value] ?? value };
}

export const COMMISSION_STATUS_FILTER_OPTIONS = [
  { value: "", label: "Todos os status" },
  option("FORECAST_FROM_ORDER"),
  option("WAITING_NFE"),
  option("CONFIRMED_BY_OUTPUT_DOCUMENT"),
  option("WAITING_RECEIVABLE"),
  option("WAITING_PAYMENT"),
  option("PARTIALLY_RELEASED"),
  option("RELEASED"),
  option("PAID_PARTIAL"),
  option("PAID_TOTAL"),
  option("CANCELLED"),
  option("REVERSED"),
  option("ERROR"),
] as const;

export const COMMISSION_FORECAST_STATUS_OPTIONS = [
  { value: "", label: "Ativos (previsão + aguardando NF-e)" },
  option("FORECAST_FROM_ORDER"),
  option("WAITING_NFE"),
  option("SUPERSEDED_BY_OUTPUT_DOCUMENT"),
] as const;

export const COMMISSION_CONFIRMED_STATUS_OPTIONS = [
  { value: "", label: "Ativos (confirmados e liberação)" },
  option("CONFIRMED_BY_OUTPUT_DOCUMENT"),
  option("WAITING_RECEIVABLE"),
  option("WAITING_PAYMENT"),
  option("PARTIALLY_RELEASED"),
  option("RELEASED"),
  option("PAID_PARTIAL"),
  option("PAID_TOTAL"),
  option("CANCELLED"),
  option("REVERSED"),
  option("ERROR"),
] as const;

export function commissionStatusClassName(status: string): string {
  switch (status) {
    case "FORECAST_FROM_ORDER":
    case "WAITING_NFE":
      return "text-sky-700";
    case "CONFIRMED_BY_OUTPUT_DOCUMENT":
    case "RELEASED":
    case "PAID_TOTAL":
      return "text-emerald-700";
    case "PARTIALLY_RELEASED":
    case "PAID_PARTIAL":
      return "text-amber-700";
    case "CANCELLED":
    case "REVERSED":
      return "text-muted-foreground";
    case "ERROR":
      return "text-red-700 font-semibold";
    default:
      return "text-[#374151]";
  }
}
