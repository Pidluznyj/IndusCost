/**
 * Regras puras de atraso / prazo de entrega de Pedido de Venda.
 *
 * Centraliza a lógica de negócio para que a tela de Gestão de Pedidos apenas
 * consuma campos calculados (sem recálculo no React) e para que o cálculo de
 * `daysOverdue` use a NF processada (DataReal) em vez de sempre comparar com Hoje.
 *
 * Regra de atraso (datas civis, sem drift de timezone):
 * ```text
 * Prazo original = DataEntregaPlanejada - DataEmissao
 * Prazo real     = DataReal (NF processada / entrega) - DataEmissao
 * Dias atraso    = max(0, Prazo real - Prazo original)
 *                = max(0, DataReal - DataEntregaPlanejada)        // quando há NF/data real
 *                = max(0, Hoje - DataEntregaPlanejada)            // quando não há NF/data real
 *                = 0                                              // cancelado
 * ```
 *
 * A "DataReal" deve ser `nfes.dataProcessamento`. NF vinculada porém sem
 * processamento NÃO é DataReal (ver `salesOrderLinkedNfe`/`salesOrderLogisticStatus`).
 */
import {
  diffCalendarDays,
  parseNomusBrOrIsoDate,
  startOfLocalDay,
} from "./salesOrderNomusRaw.js";

export type SalesOrderDeliveryDateInput = Date | string | null | undefined;

/** Normaliza qualquer entrada de data para início do dia local (ou null). */
export function toDeliveryLocalDay(value: SalesOrderDeliveryDateInput): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : startOfLocalDay(value);
  }
  const parsed = parseNomusBrOrIsoDate(value);
  return parsed ? startOfLocalDay(parsed) : null;
}

export type SalesOrderDelayInput = {
  /** DataEntregaPlanejada (dataEntregaPadrao). */
  plannedDeliveryDate: SalesOrderDeliveryDateInput;
  /** DataReal = nfes.dataProcessamento. Null quando NF não processada / inexistente. */
  realInvoiceDate: SalesOrderDeliveryDateInput;
  referenceDate?: Date;
  isCancelled?: boolean;
};

/**
 * Dias de atraso da entrega.
 * - Cancelado → 0
 * - Sem data planejada → 0 (sem base de comparação; tratar como "Revisar prazo")
 * - Com DataReal → max(0, DataReal - DataPlanejada)
 * - Sem DataReal → max(0, Hoje - DataPlanejada)
 */
export function computeSalesOrderDeliveryDelayDays(input: SalesOrderDelayInput): number {
  if (input.isCancelled) return 0;
  const planned = toDeliveryLocalDay(input.plannedDeliveryDate);
  if (!planned) return 0;
  const real = toDeliveryLocalDay(input.realInvoiceDate);
  if (real) return Math.max(0, diffCalendarDays(planned, real));
  const today = startOfLocalDay(input.referenceDate ?? new Date());
  return Math.max(0, diffCalendarDays(planned, today));
}

/** diasEntregaOriginal = DataEntregaPlanejada - DataEmissao (pode ser negativo se dados ruins → null). */
export function computeSalesOrderDeliveryDaysOriginal(
  issueDate: SalesOrderDeliveryDateInput,
  plannedDeliveryDate: SalesOrderDeliveryDateInput
): number | null {
  const issue = toDeliveryLocalDay(issueDate);
  const planned = toDeliveryLocalDay(plannedDeliveryDate);
  if (!issue || !planned) return null;
  return diffCalendarDays(issue, planned);
}

/**
 * diasEntregaTotal:
 * - Cancelado → 0
 * - Com DataReal → DataReal - DataEmissao
 * - Sem DataReal → Hoje - DataEmissao
 */
export function computeSalesOrderDeliveryDaysTotal(input: {
  issueDate: SalesOrderDeliveryDateInput;
  realInvoiceDate: SalesOrderDeliveryDateInput;
  referenceDate?: Date;
  isCancelled?: boolean;
}): number | null {
  if (input.isCancelled) return 0;
  const issue = toDeliveryLocalDay(input.issueDate);
  if (!issue) return null;
  const real = toDeliveryLocalDay(input.realInvoiceDate);
  const end = real ?? startOfLocalDay(input.referenceDate ?? new Date());
  return Math.max(0, diffCalendarDays(issue, end));
}

export type SalesOrderPrazoLabel =
  | "Revisar prazo"
  | "NF no prazo"
  | "NF após prazo"
  | "Pendente no prazo"
  | "Pendente atrasado";

/**
 * Rótulo de "Prazo" da Gestão de Pedidos.
 * - Sem data planejada → "Revisar prazo"
 * - Com DataReal e DataReal <= DataPlanejada → "NF no prazo"
 * - Com DataReal e DataReal > DataPlanejada → "NF após prazo"
 * - Sem DataReal e Hoje <= DataPlanejada → "Pendente no prazo"
 * - Sem DataReal e Hoje > DataPlanejada → "Pendente atrasado"
 */
export function resolveSalesOrderPrazoLabel(input: {
  plannedDeliveryDate: SalesOrderDeliveryDateInput;
  realInvoiceDate: SalesOrderDeliveryDateInput;
  referenceDate?: Date;
}): SalesOrderPrazoLabel {
  const planned = toDeliveryLocalDay(input.plannedDeliveryDate);
  if (!planned) return "Revisar prazo";
  const real = toDeliveryLocalDay(input.realInvoiceDate);
  if (real) {
    return diffCalendarDays(planned, real) <= 0 ? "NF no prazo" : "NF após prazo";
  }
  const today = startOfLocalDay(input.referenceDate ?? new Date());
  return diffCalendarDays(planned, today) <= 0 ? "Pendente no prazo" : "Pendente atrasado";
}

/** Texto exibido na coluna "Data NF" quando NF vinculada não tem processamento. */
export const NFE_NAO_PROCESSADA_LABEL = "Não Processada";

/**
 * Exibição da Data de Processamento da NF-e (coluna "Data NF").
 * Replica a medida DAX `(C) Data Processamento NFe text`:
 * - DataReal presente → "dd/mm/yyyy"
 * - NF vinculada porém sem processamento → "Não Processada"
 * - Sem NF vinculada → "—"
 */
export function formatNfeProcessamentoDisplay(
  realInvoiceDate: SalesOrderDeliveryDateInput,
  hasLinkedNfe: boolean
): string {
  const real = toDeliveryLocalDay(realInvoiceDate);
  if (real) {
    const day = String(real.getDate()).padStart(2, "0");
    const month = String(real.getMonth() + 1).padStart(2, "0");
    const year = real.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return hasLinkedNfe ? NFE_NAO_PROCESSADA_LABEL : "—";
}

export type SalesOrderDeliveryAssessment = {
  delayDays: number;
  daysOriginal: number | null;
  daysTotal: number | null;
  prazoLabel: SalesOrderPrazoLabel;
  nfeProcessingDisplay: string;
  /** DataReal disponível (NF processada). */
  hasRealInvoiceDate: boolean;
};

/** Avaliação consolidada (atraso/prazo/exibição) a partir das datas civis. */
export function buildSalesOrderDeliveryAssessment(input: {
  issueDate: SalesOrderDeliveryDateInput;
  plannedDeliveryDate: SalesOrderDeliveryDateInput;
  realInvoiceDate: SalesOrderDeliveryDateInput;
  hasLinkedNfe: boolean;
  referenceDate?: Date;
  isCancelled?: boolean;
}): SalesOrderDeliveryAssessment {
  const hasRealInvoiceDate = toDeliveryLocalDay(input.realInvoiceDate) != null;
  return {
    delayDays: computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: input.plannedDeliveryDate,
      realInvoiceDate: input.realInvoiceDate,
      referenceDate: input.referenceDate,
      isCancelled: input.isCancelled,
    }),
    daysOriginal: computeSalesOrderDeliveryDaysOriginal(
      input.issueDate,
      input.plannedDeliveryDate
    ),
    daysTotal: computeSalesOrderDeliveryDaysTotal({
      issueDate: input.issueDate,
      realInvoiceDate: input.realInvoiceDate,
      referenceDate: input.referenceDate,
      isCancelled: input.isCancelled,
    }),
    prazoLabel: resolveSalesOrderPrazoLabel({
      plannedDeliveryDate: input.plannedDeliveryDate,
      realInvoiceDate: input.realInvoiceDate,
      referenceDate: input.referenceDate,
    }),
    nfeProcessingDisplay: formatNfeProcessamentoDisplay(
      input.realInvoiceDate,
      input.hasLinkedNfe
    ),
    hasRealInvoiceDate,
  };
}
