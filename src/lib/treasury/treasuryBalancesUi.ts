/**
 * Formatação pt-BR, formulário e estados — atualização de saldo (client-safe).
 */

import { formatFinanceCurrency, formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat.js";
import { HttpError } from "@/src/lib/http.js";
import { normalizeTreasuryMoneyString } from "@/src/lib/treasury/contracts/index.js";
import type {
  TreasuryBalanceOrigin,
  TreasuryBalanceSnapshotDto,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryCreateBalanceSnapshotBody } from "./treasuryBalancesApi.js";

export const TREASURY_BALANCE_PAGE_TITLE = "Atualização de saldo" as const;
export const TREASURY_BALANCE_STALE_HOURS = 24;

export const TREASURY_BALANCE_DENIED_MESSAGE =
  "Sem permissão para visualizar saldos desta conta." as const;

export const TREASURY_BALANCE_MANAGE_DENIED_MESSAGE =
  "Sem permissão para informar novo saldo nesta conta." as const;

export const TREASURY_BALANCE_STALE_NONE_MESSAGE =
  "Nenhum saldo informado ainda. Atualize o saldo para iniciar o histórico." as const;

export const TREASURY_BALANCE_CONFLICT_MESSAGE =
  "Conflito ao salvar: o saldo da conta mudou ou a conta não admite a operação. Recarregue e tente novamente." as const;

export const TREASURY_BALANCE_CONFIRM_TITLE =
  "Confirmar atualização de saldo" as const;

export type TreasuryBalanceFormState = {
  availableBalance: string;
  blockedBalance: string;
  investmentsBalance: string;
  usedLimit: string;
  /** Valor para input datetime-local (YYYY-MM-DDTHH:mm). */
  referenceLocal: string;
  origin: TreasuryBalanceOrigin;
  notes: string;
};

/** Máscara monetária pt-BR a partir da digitação (centavos). */
export function maskTreasuryMoneyInputPtBr(raw: string): string {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const digits = trimmed.replace(/\D/g, "").slice(0, 16);
  if (!digits) return negative ? "-" : "";
  const padded = digits.padStart(3, "0");
  const frac = padded.slice(-2);
  const intRaw = padded.slice(0, -2).replace(/^0+(?=\d)/, "") || "0";
  const intFormatted = Number(intRaw).toLocaleString("pt-BR");
  return `${negative ? "-" : ""}${intFormatted},${frac}`;
}

/** Exibe string decimal API (1000.50) como pt-BR (1.000,50). */
export function formatTreasuryApiMoneyToPtBr(api: string): string {
  try {
    const normalized = normalizeTreasuryMoneyString(api);
    const negative = normalized.startsWith("-");
    const raw = negative ? normalized.slice(1) : normalized;
    const [intPart, frac = "00"] = raw.split(".");
    const intFormatted = Number(intPart).toLocaleString("pt-BR");
    return `${negative ? "-" : ""}${intFormatted},${frac.padEnd(2, "0").slice(0, 2)}`;
  } catch {
    return api;
  }
}

/**
 * Converte display pt-BR → string decimal API sem formatação monetária.
 * Aceita "1.234,56", "1234,56", "1234.56".
 */
export function parseTreasuryPtBrMoneyToApi(display: string): string | null {
  const trimmed = display.trim();
  if (!trimmed || trimmed === "-") return null;
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1).trim() : trimmed;
  let normalized: string;
  if (body.includes(",")) {
    normalized = body.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(body)) {
    normalized = body;
  } else if (/^\d+$/.test(body.replace(/\./g, ""))) {
    // só milhares ou inteiro
    normalized = body.replace(/\./g, "");
  } else {
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  try {
    const api = normalizeTreasuryMoneyString(
      `${negative ? "-" : ""}${normalized}`
    );
    return api;
  } catch {
    return null;
  }
}

export function formatTreasuryBalanceDateTimePtBr(
  iso: string | null | undefined
): string {
  return formatFinanceDateTime(iso);
}

export function formatTreasuryBalanceCurrencyPtBr(
  api: string | null | undefined
): string {
  if (api == null || api === "") return "—";
  return formatFinanceCurrency(api);
}

export function toDatetimeLocalValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local → ISO com offset local. */
export function datetimeLocalToIsoOffset(local: string): string | null {
  const trimmed = local.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

export function createEmptyTreasuryBalanceForm(
  latest?: TreasuryBalanceSnapshotDto | null
): TreasuryBalanceFormState {
  if (!latest) {
    return {
      availableBalance: "",
      blockedBalance: maskTreasuryMoneyInputPtBr("0"),
      investmentsBalance: maskTreasuryMoneyInputPtBr("0"),
      usedLimit: maskTreasuryMoneyInputPtBr("0"),
      referenceLocal: toDatetimeLocalValue(),
      origin: "MANUAL",
      notes: "",
    };
  }
  return {
    availableBalance: formatTreasuryApiMoneyToPtBr(latest.availableBalance),
    blockedBalance: formatTreasuryApiMoneyToPtBr(latest.blockedBalance),
    investmentsBalance: formatTreasuryApiMoneyToPtBr(latest.investmentsBalance),
    usedLimit: formatTreasuryApiMoneyToPtBr(latest.usedLimit),
    referenceLocal: toDatetimeLocalValue(),
    origin: "MANUAL",
    notes: "",
  };
}

export function validateTreasuryBalanceForm(
  form: TreasuryBalanceFormState
): string | null {
  const available = parseTreasuryPtBrMoneyToApi(form.availableBalance);
  if (available == null) return "Informe o saldo disponível (formato pt-BR).";
  if (parseTreasuryPtBrMoneyToApi(form.blockedBalance) == null) {
    return "Saldo bloqueado inválido.";
  }
  if (parseTreasuryPtBrMoneyToApi(form.investmentsBalance) == null) {
    return "Saldo de aplicação inválido.";
  }
  if (parseTreasuryPtBrMoneyToApi(form.usedLimit) == null) {
    return "Limite utilizado inválido.";
  }
  if (!datetimeLocalToIsoOffset(form.referenceLocal)) {
    return "Informe data e hora de referência válidas.";
  }
  return null;
}

export function toTreasuryBalanceSnapshotApiBody(
  form: TreasuryBalanceFormState
): TreasuryCreateBalanceSnapshotBody | null {
  if (validateTreasuryBalanceForm(form)) return null;
  const referenceAt = datetimeLocalToIsoOffset(form.referenceLocal);
  const availableBalance = parseTreasuryPtBrMoneyToApi(form.availableBalance);
  const blockedBalance = parseTreasuryPtBrMoneyToApi(form.blockedBalance);
  const investmentsBalance = parseTreasuryPtBrMoneyToApi(
    form.investmentsBalance
  );
  const usedLimit = parseTreasuryPtBrMoneyToApi(form.usedLimit);
  if (
    !referenceAt ||
    availableBalance == null ||
    blockedBalance == null ||
    investmentsBalance == null ||
    usedLimit == null
  ) {
    return null;
  }
  return {
    referenceAt,
    availableBalance,
    blockedBalance,
    investmentsBalance,
    usedLimit,
    origin: form.origin,
    notes: form.notes.trim() || null,
    justification: "atualização de saldo pela UI",
  };
}

export type TreasuryBalanceStaleState =
  | { kind: "none" }
  | { kind: "missing"; message: string }
  | { kind: "stale"; message: string; hours: number };

export function resolveTreasuryBalanceStaleState(
  latest: TreasuryBalanceSnapshotDto | null,
  now = new Date(),
  staleHours = TREASURY_BALANCE_STALE_HOURS
): TreasuryBalanceStaleState {
  if (!latest) {
    return { kind: "missing", message: TREASURY_BALANCE_STALE_NONE_MESSAGE };
  }
  const ref = new Date(latest.referenceAt).getTime();
  if (!Number.isFinite(ref)) {
    return { kind: "missing", message: TREASURY_BALANCE_STALE_NONE_MESSAGE };
  }
  const hours = (now.getTime() - ref) / (1000 * 60 * 60);
  if (hours > staleHours) {
    return {
      kind: "stale",
      hours: Math.floor(hours),
      message: `Saldo desatualizado: última referência há ${Math.floor(hours)} h (limite ${staleHours} h).`,
    };
  }
  return { kind: "none" };
}

export function resolveTreasuryBalanceSaveError(err: unknown): {
  message: string;
  isConflict: boolean;
} {
  if (err instanceof HttpError) {
    const isConflict = err.status === 409 || err.code === "CONFLICT";
    return {
      isConflict,
      message: isConflict
        ? TREASURY_BALANCE_CONFLICT_MESSAGE
        : err.message || "Não foi possível salvar o saldo.",
    };
  }
  if (err instanceof Error) {
    return { message: err.message, isConflict: false };
  }
  return { message: "Não foi possível salvar o saldo.", isConflict: false };
}

export function buildTreasuryBalanceAccountLabel(
  account: Pick<TreasuryFinancialAccountDto, "code" | "name">
): string {
  return `${account.code} · ${account.name}`;
}

export function buildTreasuryBalancePath(accountId: string): string {
  return `/finance/treasury/accounts/${accountId}/balances`;
}
