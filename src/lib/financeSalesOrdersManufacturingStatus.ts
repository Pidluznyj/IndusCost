import type { SalesOrderItemNomusStatus } from "./salesOrderLifecycleTypes.js";
import {
  extractNomusRawItems,
  normalizeNomusSalesOrderItemStatusCode,
  normalizeSalesOrderItemNomusStatus,
} from "./salesOrderNomusRaw.js";

export const MANUFACTURING_STATUS_POWER_BI_CODES = ["1", "2", "3", "4", "5", "6"] as const;
export type ManufacturingStatusPowerBiCode = (typeof MANUFACTURING_STATUS_POWER_BI_CODES)[number];

/** Labels alinhados ao relatório Power BI de Pedidos de Venda. */
export const MANUFACTURING_STATUS_LABELS: Record<ManufacturingStatusPowerBiCode, string> = {
  "1": "Aguardando liberação",
  "2": "Liberado",
  "3": "Atendido parcialmente",
  "4": "Atendido totalmente",
  "5": "Atendido com corte",
  "6": "Cancelado",
};

const NOMUS_STATUS_TO_CODE: Partial<Record<SalesOrderItemNomusStatus, ManufacturingStatusPowerBiCode>> =
  {
    awaiting_release: "1",
    released: "2",
    partially_fulfilled: "3",
    fully_fulfilled: "4",
    fulfilled_with_cut: "5",
    cancelled: "6",
  };

const CODE_PRIORITY: Record<ManufacturingStatusPowerBiCode, number> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
};

function parseNumericStatusCode(status: unknown): number | null {
  if (typeof status === "number" && Number.isFinite(status)) return Math.trunc(status);
  if (typeof status === "string" && /^\d+$/.test(status.trim())) {
    return Number.parseInt(status.trim(), 10);
  }
  return null;
}

export function resolveItemManufacturingStatusCode(
  status: unknown
): ManufacturingStatusPowerBiCode | "unknown" {
  const numeric = parseNumericStatusCode(status);
  if (numeric != null && numeric >= 1 && numeric <= 6) {
    return String(numeric) as ManufacturingStatusPowerBiCode;
  }

  const fromCode = normalizeNomusSalesOrderItemStatusCode(status);
  if (fromCode) {
    const mapped = NOMUS_STATUS_TO_CODE[fromCode];
    if (mapped) return mapped;
  }

  const normalized = normalizeSalesOrderItemNomusStatus(status);
  return NOMUS_STATUS_TO_CODE[normalized] ?? "unknown";
}

/** Classifica o pedido pelo item mais pendente (menor código 1–6). */
export function resolveOrderManufacturingStatusCode(
  nomusRawResponse: unknown
): ManufacturingStatusPowerBiCode | "unknown" {
  const items = extractNomusRawItems(nomusRawResponse);
  if (items.length === 0) return "unknown";

  let best: ManufacturingStatusPowerBiCode | "unknown" = "unknown";
  let bestPriority = 99;
  for (const item of items) {
    const code = resolveItemManufacturingStatusCode(item.status);
    if (code === "unknown") continue;
    const priority = CODE_PRIORITY[code];
    if (priority < bestPriority) {
      bestPriority = priority;
      best = code;
    }
  }
  return best;
}

export function emptyManufacturingStatusBreakdown(): Array<{
  code: ManufacturingStatusPowerBiCode;
  label: string;
  amount: number;
  orderCount: number;
}> {
  return MANUFACTURING_STATUS_POWER_BI_CODES.map((code) => ({
    code,
    label: MANUFACTURING_STATUS_LABELS[code],
    amount: 0,
    orderCount: 0,
  }));
}
