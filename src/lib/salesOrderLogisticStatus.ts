/**
 * Status Logístico — adaptação da medida DAX do Power BI para o modelo IndusCost.
 *
 * Power BI (referência):
 * - Com NF: Entregue no Prazo / Entregue com Atraso
 * - Sem NF + item status ∈ {1,2,3}: Atrasado (Pendente) / No Prazo (Pendente)
 * - Sem NF + item fora de {1,2,3}: Finalizado/Cancelado
 *
 * No IndusCost usamos nomenclatura fiscal (dataProcessamento = NF) e refinamos
 * cancelamento, devolução, corte e desconhecidos sem substituir o status gerencial.
 */
import type { SalesOrderItemNomusStatus } from "./salesOrderLifecycleTypes.js";
import {
  extractNomusRawItems,
  extractNomusRawNfes,
  normalizeSalesOrderItemNomusStatus,
  parseNomusBrOrIsoDate,
} from "./salesOrderNomusRaw.js";

/** Baseado na medida histórica do Power BI — sujeito a validação pelo audit script de status Nomus. */
export const NOMUS_PENDING_ITEM_STATUS_CODES = new Set<number>([1, 2, 3]);

/** Evidência em produção: código 6 = Cancelado (PD 02130). */
export const NOMUS_CANCELLED_ITEM_STATUS_CODES = new Set<number>([6]);

export type SalesOrderLogisticStatusLabel =
  | "Faturado no prazo"
  | "Faturado com atraso"
  | "Atrasado pendente"
  | "No prazo pendente"
  | "Cancelado"
  | "Devolvido"
  | "Parcial/com corte"
  | "Finalizado sem NF — revisar"
  | "Revisar/desconhecidos";

export type SalesOrderLogisticStatusResult = {
  label: SalesOrderLogisticStatusLabel;
  source: "power_bi_rule_adapted" | "calculated";
  evidence: {
    expectedDeliveryDate: string | null;
    invoiceProcessingDate: string | null;
    itemStatusCodes: string[];
    summary: string;
  };
};

function parseItemStatusCode(status: unknown): number | null {
  if (typeof status === "number" && Number.isFinite(status)) return Math.trunc(status);
  if (typeof status === "string" && /^\d+$/.test(status.trim())) {
    return Number.parseInt(status.trim(), 10);
  }
  return null;
}

function collectItemStatusCodes(nomusRawResponse: unknown): string[] {
  const items = extractNomusRawItems(nomusRawResponse);
  const codes = new Set<string>();
  for (const item of items) {
    const code = parseItemStatusCode(item.status);
    if (code != null) codes.add(String(code));
    else if (item.status?.trim()) codes.add(item.status.trim());
  }
  return [...codes];
}

function resolveFirstInvoiceProcessingDate(nomusRawResponse: unknown): Date | null {
  const nfes = extractNomusRawNfes(nomusRawResponse);
  const dates: Date[] = [];
  for (const nfe of nfes) {
    const d = parseNomusBrOrIsoDate(nfe.dataProcessamento);
    if (d) dates.push(d);
  }
  dates.sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}

function isItemPendingForLogistics(
  rawStatus: unknown,
  normalized: SalesOrderItemNomusStatus
): boolean {
  const code = parseItemStatusCode(rawStatus);
  if (code != null && NOMUS_PENDING_ITEM_STATUS_CODES.has(code)) return true;
  if (
    normalized === "awaiting_release" ||
    normalized === "released" ||
    normalized === "partially_fulfilled"
  ) {
    return true;
  }
  return false;
}

function refineWithoutInvoice(input: {
  nomusRawResponse: unknown;
  referenceDate: Date;
  expectedDelivery: Date | null;
}): SalesOrderLogisticStatusResult {
  const rawItems = extractNomusRawItems(input.nomusRawResponse);
  const itemStatusCodes = collectItemStatusCodes(input.nomusRawResponse);

  if (rawItems.length === 0) {
    return {
      label: "Revisar/desconhecidos",
      source: "calculated",
      evidence: {
        expectedDeliveryDate: input.expectedDelivery?.toISOString() ?? null,
        invoiceProcessingDate: null,
        itemStatusCodes,
        summary: "Sem itens no raw Nomus para classificar status logístico.",
      },
    };
  }

  const normalizedList = rawItems.map((r) =>
    normalizeSalesOrderItemNomusStatus(r.status)
  );
  const pendingItems = rawItems.filter((r, i) =>
    isItemPendingForLogistics(r.status, normalizedList[i])
  );

  if (pendingItems.length > 0) {
    const overdue =
      input.expectedDelivery != null &&
      input.referenceDate.getTime() > input.expectedDelivery.getTime();
    const label: SalesOrderLogisticStatusLabel = overdue
      ? "Atrasado pendente"
      : "No prazo pendente";
    return {
      label,
      source: "power_bi_rule_adapted",
      evidence: {
        expectedDeliveryDate: input.expectedDelivery?.toISOString() ?? null,
        invoiceProcessingDate: null,
        itemStatusCodes,
        summary: overdue
          ? "Sem NF processada; item(s) pendente(s) com previsão vencida."
          : "Sem NF processada; item(s) pendente(s) dentro do prazo.",
      },
    };
  }

  const allCancelled =
    normalizedList.length > 0 &&
    normalizedList.every((s, i) => {
      if (s === "cancelled") return true;
      const qty = rawItems[i].quantidade ?? 0;
      const cancelled = rawItems[i].quantidadeCancelada ?? 0;
      return cancelled > 0 && qty > 0 && cancelled >= qty;
    });
  if (allCancelled) {
    return {
      label: "Cancelado",
      source: "calculated",
      evidence: {
        expectedDeliveryDate: input.expectedDelivery?.toISOString() ?? null,
        invoiceProcessingDate: null,
        itemStatusCodes,
        summary: "Todos os itens cancelados no Nomus.",
      },
    };
  }

  const anyReturned = normalizedList.some(
    (s) => s === "partially_returned" || s === "fully_returned"
  );
  if (anyReturned) {
    return {
      label: "Devolvido",
      source: "calculated",
      evidence: {
        expectedDeliveryDate: input.expectedDelivery?.toISOString() ?? null,
        invoiceProcessingDate: null,
        itemStatusCodes,
        summary: "Itens com devolução no Nomus.",
      },
    };
  }

  const anyCut = normalizedList.some((s) => s === "fulfilled_with_cut");
  const anyPartial = normalizedList.some((s) => s === "partially_fulfilled");
  if (anyCut || anyPartial) {
    return {
      label: "Parcial/com corte",
      source: "calculated",
      evidence: {
        expectedDeliveryDate: input.expectedDelivery?.toISOString() ?? null,
        invoiceProcessingDate: null,
        itemStatusCodes,
        summary: "Atendimento parcial ou com corte sem NF processada.",
      },
    };
  }

  const anyUnknown = normalizedList.some((s) => s === "unknown");
  if (anyUnknown) {
    return {
      label: "Revisar/desconhecidos",
      source: "calculated",
      evidence: {
        expectedDeliveryDate: input.expectedDelivery?.toISOString() ?? null,
        invoiceProcessingDate: null,
        itemStatusCodes,
        summary: "Status de item não mapeado no Nomus.",
      },
    };
  }

  return {
    label: "Finalizado sem NF — revisar",
    source: "power_bi_rule_adapted",
    evidence: {
      expectedDeliveryDate: input.expectedDelivery?.toISOString() ?? null,
      invoiceProcessingDate: null,
      itemStatusCodes,
      summary:
        "Sem NF processada e itens fora do conjunto pendente (1/2/3) — revisar evidência.",
    },
  };
}

export function buildSalesOrderLogisticStatus(input: {
  expectedDeliveryDate?: Date | string | null;
  nomusRawResponse?: unknown;
  referenceDate?: Date;
}): SalesOrderLogisticStatusResult {
  const referenceDate = input.referenceDate ?? new Date();
  const expectedDelivery = input.expectedDeliveryDate
    ? parseNomusBrOrIsoDate(
        input.expectedDeliveryDate instanceof Date
          ? input.expectedDeliveryDate.toISOString()
          : input.expectedDeliveryDate
      )
    : null;
  const invoiceDate = resolveFirstInvoiceProcessingDate(input.nomusRawResponse);
  const itemStatusCodes = collectItemStatusCodes(input.nomusRawResponse ?? null);

  if (invoiceDate) {
    const onTime =
      expectedDelivery == null || invoiceDate.getTime() <= expectedDelivery.getTime();
    const label: SalesOrderLogisticStatusLabel = onTime
      ? "Faturado no prazo"
      : "Faturado com atraso";
    return {
      label,
      source: "power_bi_rule_adapted",
      evidence: {
        expectedDeliveryDate: expectedDelivery?.toISOString() ?? null,
        invoiceProcessingDate: invoiceDate.toISOString(),
        itemStatusCodes,
        summary: onTime
          ? "NF processada até a data prevista de entrega."
          : "NF processada após a data prevista de entrega.",
      },
    };
  }

  return refineWithoutInvoice({
    nomusRawResponse: input.nomusRawResponse,
    referenceDate,
    expectedDelivery,
  });
}

const LOGISTIC_TO_EXECUTIVE_ALIGNED: Record<SalesOrderLogisticStatusLabel, readonly string[]> = {
  "Faturado no prazo": ["Faturado total no prazo"],
  "Faturado com atraso": ["Faturado total com atraso"],
  "Atrasado pendente": ["Atrasado sem NF"],
  "No prazo pendente": [
    "Aguardando liberação",
    "Liberado",
    "Em andamento",
    "Atendido totalmente",
    "Faturado total",
    "Faturado parcialmente",
    "Atendido parcialmente",
  ],
  Cancelado: ["Cancelado"],
  Devolvido: ["Devolvido totalmente", "Devolvido parcialmente"],
  "Parcial/com corte": [
    "Atendido parcialmente",
    "Atendido com corte",
    "Faturado parcialmente",
  ],
  "Finalizado sem NF — revisar": ["Divergente — revisar", "Status desconhecido", "Entregue", "Enviado"],
  "Revisar/desconhecidos": ["Divergente — revisar", "Status desconhecido"],
};

export function compareLogisticToExecutiveStatus(
  logistic: SalesOrderLogisticStatusResult,
  executiveStatusLabel: string
): { diverges: boolean; message: string | null } {
  const aligned = LOGISTIC_TO_EXECUTIVE_ALIGNED[logistic.label] ?? [];
  const executive = executiveStatusLabel.trim();
  if (aligned.includes(executive)) {
    return { diverges: false, message: null };
  }
  return {
    diverges: true,
    message: `Divergência entre status logístico (${logistic.label}) e status gerencial (${executive}) — revisar regra.`,
  };
}

export function formatLogisticEvidenceLine(logistic: SalesOrderLogisticStatusResult): string {
  const { evidence } = logistic;
  if (evidence.invoiceProcessingDate && evidence.expectedDeliveryDate) {
    const inv = new Date(evidence.invoiceProcessingDate).toLocaleDateString("pt-BR");
    const due = new Date(evidence.expectedDeliveryDate).toLocaleDateString("pt-BR");
    return `Base: NF processada em ${inv}; previsão ${due}. ${evidence.summary}`;
  }
  if (evidence.expectedDeliveryDate) {
    const due = new Date(evidence.expectedDeliveryDate).toLocaleDateString("pt-BR");
    return `Base: sem NF; previsão ${due}. ${evidence.summary}`;
  }
  return evidence.summary;
}
