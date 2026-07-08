/**
 * Conversão USD→BRL em cotações de mercado com PTAX automático ou fallback manual.
 */

import { resolvePtaxUsdSellRate } from "./materialMarketPtax.js";

export const MATERIAL_MARKET_QUOTE_MANUAL_EXCHANGE_PERMISSION =
  "materials.market_quote.manual_exchange";

export const MATERIAL_MARKET_QUOTE_EXCHANGE_ORIGIN_VALUES = ["BCB_PTAX", "MANUAL"] as const;
export type MaterialMarketQuoteExchangeOrigin =
  (typeof MATERIAL_MARKET_QUOTE_EXCHANGE_ORIGIN_VALUES)[number];

export const MATERIAL_MARKET_QUOTE_PTAX_STATUS_VALUES = [
  "SUCCESS",
  "FAILED",
  "SKIPPED",
] as const;
export type MaterialMarketQuotePtaxStatus =
  (typeof MATERIAL_MARKET_QUOTE_PTAX_STATUS_VALUES)[number];

export const MATERIAL_MARKET_QUOTE_EXCHANGE_ORIGIN_LABELS: Record<
  MaterialMarketQuoteExchangeOrigin,
  string
> = {
  BCB_PTAX: "PTAX BCB",
  MANUAL: "Câmbio manual",
};

export type MaterialMarketQuoteExchangePersistFields = {
  exchangeOrigin: MaterialMarketQuoteExchangeOrigin | null;
  ptaxVenda: number | null;
  ptaxReferenceDate: Date | null;
  ptaxFetchStatus: MaterialMarketQuotePtaxStatus | null;
  ptaxFetchFailureReason: string | null;
  priceBrl: number | null;
  netPriceBrl: number | null;
  manualExchangeJustification: string | null;
  manualExchangeBy: string | null;
  manualExchangeAt: Date | null;
};

export type MaterialMarketQuoteExchangeInput = {
  currency: string;
  quoteDate: Date;
  price: number;
  netPrice: number;
  manualExchangeRate?: unknown;
  manualExchangeJustification?: unknown;
  forceManualExchange?: unknown;
};

export type MaterialMarketQuoteExchangeResolution =
  | { ok: true; value: MaterialMarketQuoteExchangePersistFields; warning?: string }
  | {
      ok: false;
      code:
        | "MANUAL_EXCHANGE_FORBIDDEN"
        | "MANUAL_EXCHANGE_JUSTIFICATION_REQUIRED"
        | "MANUAL_EXCHANGE_RATE_INVALID";
      message: string;
      field?: string;
      ptaxFetchFailureReason?: string;
    };

function roundExchangeMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isUsdCurrency(currency: string): boolean {
  return currency.trim().toUpperCase() === "USD";
}

function normalizeJustification(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseManualExchangeRate(value: unknown):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  if (value == null || value === "") {
    return { ok: false, message: "Taxa de câmbio manual é obrigatória." };
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: "Taxa de câmbio manual deve ser um número positivo." };
  }
  return { ok: true, value: roundExchangeMoney(n) };
}

function buildBrlConversion(price: number, netPrice: number, ptaxVenda: number) {
  return {
    priceBrl: roundExchangeMoney(price * ptaxVenda),
    netPriceBrl: roundExchangeMoney(netPrice * ptaxVenda),
  };
}

function skippedExchangeFields(): MaterialMarketQuoteExchangePersistFields {
  return {
    exchangeOrigin: null,
    ptaxVenda: null,
    ptaxReferenceDate: null,
    ptaxFetchStatus: "SKIPPED",
    ptaxFetchFailureReason: null,
    priceBrl: null,
    netPriceBrl: null,
    manualExchangeJustification: null,
    manualExchangeBy: null,
    manualExchangeAt: null,
  };
}

function failedExchangeFields(reason: string): MaterialMarketQuoteExchangePersistFields {
  return {
    exchangeOrigin: null,
    ptaxVenda: null,
    ptaxReferenceDate: null,
    ptaxFetchStatus: "FAILED",
    ptaxFetchFailureReason: reason,
    priceBrl: null,
    netPriceBrl: null,
    manualExchangeJustification: null,
    manualExchangeBy: null,
    manualExchangeAt: null,
  };
}

export function canManualMaterialMarketQuoteExchange(check: {
  hasPermission: (permission: string) => boolean;
}): boolean {
  return check.hasPermission(MATERIAL_MARKET_QUOTE_MANUAL_EXCHANGE_PERMISSION);
}

export async function resolveMaterialMarketQuoteExchange(
  input: MaterialMarketQuoteExchangeInput,
  options: {
    canManualExchange: boolean;
    userId?: string | null;
    fetchPtax?: (quoteDate: Date) => Promise<
      | { ok: true; ptaxVenda: number; referenceDate: string }
      | { ok: false; reason: string }
    >;
    now?: Date;
  }
): Promise<MaterialMarketQuoteExchangeResolution> {
  if (!isUsdCurrency(input.currency)) {
    return { ok: true, value: skippedExchangeFields() };
  }

  const fetchPtax = options.fetchPtax ?? defaultFetchPtax;
  const forceManual = input.forceManualExchange === true || input.forceManualExchange === "true";
  const manualRateRaw = input.manualExchangeRate;
  const hasManualRate =
    manualRateRaw != null && manualRateRaw !== "" && manualRateRaw !== undefined;
  const justification = normalizeJustification(input.manualExchangeJustification);

  let ptaxResult: Awaited<ReturnType<typeof defaultFetchPtax>> | null = null;
  if (!forceManual && !hasManualRate) {
    ptaxResult = await fetchPtax(input.quoteDate);
    if (ptaxResult.ok) {
      const brl = buildBrlConversion(input.price, input.netPrice, ptaxResult.ptaxVenda);
      return {
        ok: true,
        value: {
          exchangeOrigin: "BCB_PTAX",
          ptaxVenda: ptaxResult.ptaxVenda,
          ptaxReferenceDate: new Date(`${ptaxResult.referenceDate}T12:00:00`),
          ptaxFetchStatus: "SUCCESS",
          ptaxFetchFailureReason: null,
          ...brl,
          manualExchangeJustification: null,
          manualExchangeBy: null,
          manualExchangeAt: null,
        },
      };
    }
  }

  const failureReason =
    ptaxResult && ptaxResult.ok === false
      ? ptaxResult.reason
      : forceManual
        ? "Câmbio informado manualmente por decisão do usuário."
        : "PTAX automático indisponível.";

  if (!options.canManualExchange) {
    if (hasManualRate || forceManual) {
      return {
        ok: false,
        code: "MANUAL_EXCHANGE_FORBIDDEN",
        message: "Você não tem permissão para informar câmbio manual.",
        ptaxFetchFailureReason: failureReason,
      };
    }
    return {
      ok: true,
      value: failedExchangeFields(failureReason),
      warning:
        "PTAX indisponível. Cotação salva sem conversão para BRL. Solicite a um administrador se precisar informar o câmbio manualmente.",
    };
  }

  if (!hasManualRate && !forceManual) {
    return {
      ok: false,
      code: "MANUAL_EXCHANGE_RATE_INVALID",
      field: "manualExchangeRate",
      message:
        "PTAX indisponível. Informe a taxa de câmbio manual (PTAX venda equivalente) para converter valores em BRL.",
      ptaxFetchFailureReason: failureReason,
    };
  }

  const manualRateParsed = parseManualExchangeRate(manualRateRaw);
  if (manualRateParsed.ok === false) {
    return {
      ok: false,
      code: "MANUAL_EXCHANGE_RATE_INVALID",
      field: "manualExchangeRate",
      message: manualRateParsed.message,
      ptaxFetchFailureReason: failureReason,
    };
  }

  if (!justification) {
    return {
      ok: false,
      code: "MANUAL_EXCHANGE_JUSTIFICATION_REQUIRED",
      field: "manualExchangeJustification",
      message: "Justificativa obrigatória para câmbio informado manualmente.",
      ptaxFetchFailureReason: failureReason,
    };
  }

  const brl = buildBrlConversion(input.price, input.netPrice, manualRateParsed.value);
  const now = options.now ?? new Date();

  return {
    ok: true,
    value: {
      exchangeOrigin: "MANUAL",
      ptaxVenda: manualRateParsed.value,
      ptaxReferenceDate: input.quoteDate,
      ptaxFetchStatus: "SUCCESS",
      ptaxFetchFailureReason: failureReason,
      ...brl,
      manualExchangeJustification: justification,
      manualExchangeBy: options.userId ?? null,
      manualExchangeAt: now,
    },
  };
}

export type MaterialMarketQuotePtaxPreview = {
  status: "SUCCESS" | "FAILED";
  ptaxVenda: number | null;
  referenceDate: string | null;
  failureReason: string | null;
  canManualExchange: boolean;
};

export type PtaxUsdSellRateFetcher = (isoDate: string) => Promise<number | null>;

function toIsoDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function defaultFetchPtax(quoteDate: Date): Promise<
  | { ok: true; ptaxVenda: number; referenceDate: string }
  | { ok: false; reason: string }
> {
  const isoDate = toIsoDateOnly(quoteDate);
  const rate = await resolvePtaxUsdSellRate(isoDate);
  if (rate == null) {
    return {
      ok: false,
      reason: `PTAX indisponível para ${isoDate} (sem cotação no BCB).`,
    };
  }
  return { ok: true, ptaxVenda: rate, referenceDate: isoDate };
}

export async function previewMaterialMarketQuotePtax(
  quoteDate: Date,
  options: {
    canManualExchange: boolean;
    fetchPtax?: (quoteDate: Date) => Promise<
      | { ok: true; ptaxVenda: number; referenceDate: string }
      | { ok: false; reason: string }
    >;
  }
): Promise<MaterialMarketQuotePtaxPreview> {
  const fetchPtax = options.fetchPtax ?? defaultFetchPtax;
  const result = await fetchPtax(quoteDate);
  if (result.ok) {
    return {
      status: "SUCCESS",
      ptaxVenda: result.ptaxVenda,
      referenceDate: result.referenceDate,
      failureReason: null,
      canManualExchange: options.canManualExchange,
    };
  }
  return {
    status: "FAILED",
    ptaxVenda: null,
    referenceDate: null,
    failureReason: result.reason,
    canManualExchange: options.canManualExchange,
  };
}
