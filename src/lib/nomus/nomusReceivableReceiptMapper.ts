/**
 * Mapper puro do recurso Nomus `GET /rest/recebimentos` → `NomusReceivableReceipt`.
 *
 * Contrato comprovado LIVE (HTTP 200, 50 registros por página nesta instalação):
 *   baixaContaReceber, codigo, comentarios, dataCompetencia, dataHoraCriacao,
 *   dataModificacao, dataRecebimento, desconto, descricaoLancamento, id,
 *   idClassificacaoFinanceira, idContaBancaria, idContaReceber, idEmpresa,
 *   idFormaPagamento, idPessoa, idUsuarioCriador, multaJuros,
 *   nomeClassificacaoFinanceira, nomeContaBancaria, nomeEmpresa,
 *   nomeFormaPagamento, nomePessoa, nomeUsuarioCriador, taxaBancaria, valorRecebido.
 *
 * O endpoint NÃO expõe `deleted`/`cancelled`/`status`: exclusão/estorno na origem
 * não é observável por este payload e por isso não é inferida aqui.
 * Sem Prisma/rede — seguro para importar em scripts e testes.
 */

import { Prisma } from "@prisma/client";
import {
  asBoolean,
  asString,
  parseNomusBrDateTime,
  parseNomusOptionalMoney,
  toInt,
} from "@/src/lib/nomusAccountsReceivableParser.js";
import { stableNomusPayloadHash } from "@/src/lib/nomusAccountsReceivableMapper.js";

export type JsonObject = Record<string, unknown>;

export { stableNomusPayloadHash };

/**
 * Dia civil BR (`dd/MM/yyyy` ou ISO) em meia-noite **UTC** — convenção do projeto
 * para colunas PostgreSQL DATE (ver `financeCivilDate.ts`).
 *
 * Meia-noite LOCAL aqui seria um defeito: em fuso positivo (UTC+X) o cast para
 * DATE no Postgres jogaria 31/07 para 30/07. Recebimento de 31/07 nunca pode
 * virar 01/08 — nem 30/07 — por causa de fuso.
 */
export function parseNomusReceiptCivilDate(input: unknown): Date | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()));
  }
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (!raw) return null;

  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s.*)?$/.exec(raw);
  if (br) {
    const day = Number.parseInt(br[1], 10);
    const month = Number.parseInt(br[2], 10);
    const yearRaw = Number.parseInt(br[3], 10);
    const year = br[3].length === 2 ? 2000 + yearRaw : yearRaw;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (
      dt.getUTCFullYear() !== year ||
      dt.getUTCMonth() !== month - 1 ||
      dt.getUTCDate() !== day
    ) {
      return null;
    }
    return dt;
  }

  // ISO `yyyy-MM-dd[...]` — usa os componentes textuais, sem passar por Date local.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    const dt = new Date(
      Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

export type MappedNomusReceivableReceipt = {
  externalId: number;
  receivableExternalId: number;
  receiptDate: Date;
  competenceDate: Date | null;
  closesReceivable: boolean | null;
  receivedAmount: Prisma.Decimal;
  bankFeeAmount: Prisma.Decimal | null;
  lateFeeInterestAmount: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal | null;
  code: string | null;
  description: string | null;
  comments: string | null;
  companyId: number | null;
  companyName: string | null;
  personId: number | null;
  personName: string | null;
  bankAccountId: number | null;
  bankAccountName: string | null;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  financialClassificationId: number | null;
  financialClassificationName: string | null;
  createdByUserId: number | null;
  createdByUserName: string | null;
  createdAtNomus: Date | null;
  modifiedAtNomus: Date | null;
  rawPayload: JsonObject;
  payloadHash: string;
};

export const NOMUS_RECEIPT_MAP_REASONS = [
  "MISSING_EXTERNAL_ID",
  "MISSING_RECEIVABLE_EXTERNAL_ID",
  "MISSING_RECEIPT_DATE",
  "INVALID_RECEIVED_AMOUNT",
] as const;

export type NomusReceiptMapReason = (typeof NOMUS_RECEIPT_MAP_REASONS)[number];

export type NomusReceiptMapSuccess = { ok: true; row: MappedNomusReceivableReceipt };

export type NomusReceiptMapFailure = {
  ok: false;
  reasons: NomusReceiptMapReason[];
  externalId: number | null;
};

export type NomusReceiptMapResult = NomusReceiptMapSuccess | NomusReceiptMapFailure;

/**
 * Guards explícitos: o tsconfig do projeto não liga `strictNullChecks`, e sem ele
 * o TypeScript não estreita união discriminada por `if (!result.ok)`.
 */
export function isNomusReceiptMapSuccess(
  result: NomusReceiptMapResult
): result is NomusReceiptMapSuccess {
  return result.ok === true;
}

export function isNomusReceiptMapFailure(
  result: NomusReceiptMapResult
): result is NomusReceiptMapFailure {
  return result.ok === false;
}

function toOptionalDecimal(value: unknown): Prisma.Decimal | null {
  const n = parseNomusOptionalMoney(value);
  return n == null ? null : new Prisma.Decimal(n);
}

export function mapNomusReceivableReceiptPayload(raw: JsonObject): NomusReceiptMapResult {
  const externalId = toInt(raw.id);
  const receivableExternalId = toInt(raw.idContaReceber);
  const receiptDate = parseNomusReceiptCivilDate(raw.dataRecebimento);
  const receivedAmount = parseNomusOptionalMoney(raw.valorRecebido);

  const reasons: NomusReceiptMapReason[] = [];
  if (externalId == null) reasons.push("MISSING_EXTERNAL_ID");
  if (receivableExternalId == null) reasons.push("MISSING_RECEIVABLE_EXTERNAL_ID");
  if (!receiptDate) reasons.push("MISSING_RECEIPT_DATE");
  if (receivedAmount == null || !Number.isFinite(receivedAmount)) {
    reasons.push("INVALID_RECEIVED_AMOUNT");
  }
  if (reasons.length > 0) return { ok: false, reasons, externalId };

  const row: MappedNomusReceivableReceipt = {
    externalId: externalId!,
    receivableExternalId: receivableExternalId!,
    receiptDate: receiptDate!,
    competenceDate: parseNomusReceiptCivilDate(raw.dataCompetencia),
    closesReceivable: asBoolean(raw.baixaContaReceber),
    receivedAmount: new Prisma.Decimal(receivedAmount!),
    bankFeeAmount: toOptionalDecimal(raw.taxaBancaria),
    lateFeeInterestAmount: toOptionalDecimal(raw.multaJuros),
    discountAmount: toOptionalDecimal(raw.desconto),
    code: asString(raw.codigo),
    description: asString(raw.descricaoLancamento),
    comments: asString(raw.comentarios),
    companyId: toInt(raw.idEmpresa),
    companyName: asString(raw.nomeEmpresa),
    personId: toInt(raw.idPessoa),
    personName: asString(raw.nomePessoa),
    bankAccountId: toInt(raw.idContaBancaria),
    bankAccountName: asString(raw.nomeContaBancaria),
    paymentMethodId: toInt(raw.idFormaPagamento),
    paymentMethodName: asString(raw.nomeFormaPagamento),
    financialClassificationId: toInt(raw.idClassificacaoFinanceira),
    financialClassificationName: asString(raw.nomeClassificacaoFinanceira),
    createdByUserId: toInt(raw.idUsuarioCriador),
    createdByUserName: asString(raw.nomeUsuarioCriador),
    createdAtNomus: parseNomusBrDateTime(raw.dataHoraCriacao),
    modifiedAtNomus: parseNomusBrDateTime(raw.dataModificacao),
    rawPayload: raw,
    payloadHash: stableNomusPayloadHash(raw),
  };

  return { ok: true, row };
}

/**
 * Idempotência: só grava de novo quando o payload realmente mudou na origem.
 * `dataModificacao` existe no payload live — recebimento NÃO é imutável.
 */
export function receiptNeedsWrite(
  existing: { payloadHash: string } | null | undefined,
  mapped: Pick<MappedNomusReceivableReceipt, "payloadHash">
): boolean {
  if (!existing) return true;
  return existing.payloadHash !== mapped.payloadHash;
}
