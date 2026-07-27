/**
 * Parser isolado de OFX da Tesouraria.
 * Usa `ofx-data-extractor` (OFX 1 SGML + OFX 2 XML).
 * Normaliza dinheiro para strings decimais — sem gravar no banco.
 */

import { createRequire } from "node:module";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";

/**
 * `ofx-data-extractor` expõe dual ESM/CJS; createRequire evita
 * interop frágil ("Ofx is not a constructor") sob tsx/test runner.
 */
const require = createRequire(import.meta.url);
const { Ofx } = require("ofx-data-extractor") as {
  Ofx: new (
    data: string,
    config?: {
      parserMode?: "strict" | "lenient";
      nativeTypes?: boolean;
      formatDate?: string;
    }
  ) => {
    getType: () => string;
    getHeaders: () => Record<string, string | number>;
    validate: () => {
      isValid?: boolean;
      warnings?: unknown[];
      errors?: unknown[];
    };
    toNormalized: () => { transactions?: Array<Record<string, unknown>> };
    getTransactionsSummary?: () => Record<string, unknown>;
  };
};
import {
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  TREASURY_OFX_MAX_TRANSACTIONS,
  TREASURY_OFX_PARSER_LIBRARY,
  type TreasuryOfxFormat,
} from "./treasuryOfxConstants.js";
import {
  detectTreasuryOfxFormat,
  hashTreasuryOfxBuffer,
} from "./treasuryOfxIntakeRules.js";

export type TreasuryOfxParsedTransaction = {
  fitId: string;
  postedCivilDate: string;
  amount: TreasuryMoneyString;
  direction: "CREDIT" | "DEBIT";
  memo: string | null;
  trnType: string | null;
  currency: string | null;
  accountBankId: string | null;
  accountId: string | null;
  accountType: string | null;
  source: "BANK" | "CREDIT_CARD";
};

export type TreasuryOfxParseResult = {
  ok: true;
  library: typeof TREASURY_OFX_PARSER_LIBRARY;
  format: TreasuryOfxFormat;
  fileSha256: string;
  byteLength: number;
  headers: Record<string, string | number>;
  account: {
    bankId: string | null;
    accountId: string | null;
    accountType: string | null;
    currency: string | null;
  };
  transactions: TreasuryOfxParsedTransaction[];
  warnings: string[];
  ledgerBalance: {
    amount: TreasuryMoneyString;
    asOfCivilDate: string | null;
  } | null;
  /** Explicitamente: este parser não persiste. */
  persisted: false;
};

function moneyFromOfxAmount(value: unknown, field: string): TreasuryMoneyString {
  if (typeof value === "string") {
    return normalizeTreasuryMoneyString(value.trim());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeTreasuryMoneyString(value.toFixed(2));
  }
  throw new TreasuryDomainError(
    "INVALID_MONEY",
    `Valor monetário OFX inválido em ${field}.`,
    field
  );
}

function asCivilDate(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return null;
}

function directionOf(
  trnType: unknown,
  amount: TreasuryMoneyString
): "CREDIT" | "DEBIT" {
  const t = String(trnType ?? "").toUpperCase();
  if (t === "CREDIT" || t === "DEP" || t === "DIRECTDEP") return "CREDIT";
  if (t === "DEBIT" || t === "PAYMENT" || t === "ATM" || t === "POS")
    return "DEBIT";
  return amount.startsWith("-") ? "DEBIT" : "CREDIT";
}

function mapNormalizedTx(
  row: Record<string, unknown>,
  source: "BANK" | "CREDIT_CARD"
): TreasuryOfxParsedTransaction {
  const raw = (row.raw as Record<string, unknown> | undefined) ?? row;
  const amount = moneyFromOfxAmount(
    row.amount ?? raw.TRNAMT,
    "TRNAMT"
  );
  const fitId = String(row.fitId ?? raw.FITID ?? "").trim();
  if (!fitId) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Transação OFX sem FITID — rejeitada.",
      "FITID"
    );
  }
  const posted =
    asCivilDate(row.postedAt ?? raw.DTPOSTED) ??
    asCivilDate(raw.DTUSER) ??
    null;
  if (!posted) {
    throw new TreasuryDomainError(
      "INVALID_CIVIL_DATE",
      `Transação ${fitId} sem DTPOSTED válido.`,
      "DTPOSTED"
    );
  }
  const account = (row.account as Record<string, unknown> | null) ?? null;
  return {
    fitId,
    postedCivilDate: posted,
    amount,
    direction: directionOf(raw.TRNTYPE ?? row.direction, amount),
    memo:
      row.description != null
        ? String(row.description)
        : raw.MEMO != null
          ? String(raw.MEMO)
          : null,
    trnType: raw.TRNTYPE != null ? String(raw.TRNTYPE) : null,
    currency: row.currency != null ? String(row.currency) : null,
    accountBankId: account?.BANKID != null ? String(account.BANKID) : null,
    accountId: account?.ACCTID != null ? String(account.ACCTID) : null,
    accountType: account?.ACCTTYPE != null ? String(account.ACCTTYPE) : null,
    source,
  };
}

function wrapParseError(err: unknown): never {
  if (err instanceof TreasuryDomainError) throw err;
  const message =
    err instanceof Error ? err.message : "Falha desconhecida ao ler OFX.";
  throw new TreasuryDomainError(
    "VALIDATION_ERROR",
    `Falha ao interpretar OFX (arquivo malformado ou não suportado): ${message}`,
    "file"
  );
}

/**
 * Interpreta conteúdo OFX já validado no intake.
 * Não grava transações — apenas normaliza em memória.
 */
export function parseTreasuryOfxBuffer(
  buffer: Buffer,
  options?: { fileSha256?: string }
): TreasuryOfxParseResult {
  const text = buffer.toString("utf8");
  const format = detectTreasuryOfxFormat(text);
  const fileSha256 = options?.fileSha256 ?? hashTreasuryOfxBuffer(buffer);

  let ofx: InstanceType<typeof Ofx>;
  try {
    ofx = new Ofx(text, {
      parserMode: "strict",
      nativeTypes: true,
      formatDate: "yyyy-MM-dd",
    });
  } catch (err) {
    wrapParseError(err);
  }

  let validation: {
    isValid?: boolean;
    warnings?: unknown[];
    errors?: unknown[];
  };
  try {
    validation = ofx.validate() as typeof validation;
  } catch (err) {
    wrapParseError(err);
  }

  const stringifyDiag = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const warnings = (validation.warnings ?? []).map(stringifyDiag);
  const errors = (validation.errors ?? []).map(stringifyDiag);
  if (validation.isValid === false || errors.length > 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `OFX inválido: ${errors.join("; ") || "validate() falhou"}.`,
      "file"
    );
  }

  const hasStatementSection =
    /<BANKMSGSRSV1[\s>]/i.test(text) ||
    /<CREDITCARDMSGSRSV1[\s>]/i.test(text) ||
    /<BANKTRANLIST[\s>]/i.test(text);
  if (!hasStatementSection) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "OFX malformado: ausência de extrato bancário/cartão (BANKMSGSRSV1/CREDITCARDMSGSRSV1).",
      "file"
    );
  }

  let normalized: {
    transactions?: Array<Record<string, unknown>>;
  };
  try {
    normalized = ofx.toNormalized() as typeof normalized;
  } catch (err) {
    wrapParseError(err);
  }

  const rawList = normalized.transactions ?? [];
  if (rawList.length > TREASURY_OFX_MAX_TRANSACTIONS) {
    throw new TreasuryDomainError(
      "PAYLOAD_TOO_LARGE",
      `OFX possui ${rawList.length} lançamentos (limite ${TREASURY_OFX_MAX_TRANSACTIONS}).`,
      "file"
    );
  }

  const transactions: TreasuryOfxParsedTransaction[] = [];
  for (const row of rawList) {
    const source =
      String(row.source ?? "bank").toLowerCase() === "creditCard" ||
      String(row.source ?? "").toLowerCase() === "credit_card"
        ? "CREDIT_CARD"
        : "BANK";
    try {
      transactions.push(mapNormalizedTx(row, source));
    } catch (err) {
      // Quarantine: falha em uma linha → rejeita o arquivo inteiro nesta base
      // (strict). Persistência seletiva virá em prompt futuro.
      wrapParseError(err);
    }
  }

  const headers = (ofx.getHeaders?.() ?? {}) as Record<string, string | number>;
  const first = transactions[0] ?? null;

  let ledgerBalance: TreasuryOfxParseResult["ledgerBalance"] = null;
  try {
    const summary = ofx.getTransactionsSummary?.() as
      | Record<string, unknown>
      | undefined;
    const bal = summary?.ledgerBalance ?? summary?.BALAMT ?? null;
    if (bal != null && typeof bal === "object") {
      const rec = bal as Record<string, unknown>;
      ledgerBalance = {
        amount: moneyFromOfxAmount(rec.BALAMT ?? rec.amount, "LEDGERBAL"),
        asOfCivilDate: asCivilDate(rec.DTASOF ?? rec.asOf),
      };
    }
  } catch {
    ledgerBalance = null;
  }

  return {
    ok: true,
    library: TREASURY_OFX_PARSER_LIBRARY,
    format:
      format === "UNKNOWN"
        ? headers.OFXHEADER === 200 || headers.OFXHEADER === "200"
          ? "OFX2"
          : "OFX1"
        : format,
    fileSha256,
    byteLength: buffer.byteLength,
    headers,
    account: {
      bankId: first?.accountBankId ?? null,
      accountId: first?.accountId ?? null,
      accountType: first?.accountType ?? null,
      currency: first?.currency ?? null,
    },
    transactions,
    warnings,
    ledgerBalance,
    persisted: false,
  };
}

export function parseTreasuryOfxText(text: string): TreasuryOfxParseResult {
  return parseTreasuryOfxBuffer(Buffer.from(text, "utf8"));
}
