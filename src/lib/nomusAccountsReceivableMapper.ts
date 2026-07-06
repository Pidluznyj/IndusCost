import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  asBoolean,
  asString,
  parseNomusBrDate,
  parseNomusBrDateTime,
  parseNomusOptionalMoney,
  toInt,
} from "@/src/lib/nomusAccountsReceivableParser.js";

export type JsonObject = Record<string, unknown>;

export type MappedNomusAccountsReceivable = {
  externalId: number;
  classification: string | null;
  type: number | null;
  status: boolean | null;
  companyId: number | null;
  companyName: string | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  personPhone: string | null;
  bankAccountId: number | null;
  bankAccountName: string | null;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  dueDate: Date | null;
  competenceDate: Date | null;
  scheduleDate: Date | null;
  createdAtNomus: Date | null;
  modifiedAtNomus: Date | null;
  settlementDate: Date | null;
  amountReceivable: Prisma.Decimal | null;
  amountScheduled: Prisma.Decimal | null;
  amountReceived: Prisma.Decimal | null;
  balanceReceivable: Prisma.Decimal | null;
  description: string | null;
  comments: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  suspendCollection: boolean | null;
  lateFeePercent: Prisma.Decimal | null;
  monthlyInterestRate: Prisma.Decimal | null;
  lateFeeCalculationType: string | null;
  lateInterestType: string | null;
  rawPayload: JsonObject;
  payloadHash: string;
};

export type MapResult =
  | { ok: true; row: MappedNomusAccountsReceivable }
  | { ok: false; reasons: string[]; externalId: number | null };

function toOptionalDecimal(value: unknown): Prisma.Decimal | null {
  const n = parseNomusOptionalMoney(value);
  return n == null ? null : new Prisma.Decimal(n);
}

export function stableNomusPayloadHash(raw: JsonObject): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

export function mapNomusAccountsReceivablePayload(raw: JsonObject): MapResult {
  const externalId = toInt(raw.id);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const row: MappedNomusAccountsReceivable = {
    externalId,
    classification: asString(raw.classificacao),
    type: toInt(raw.tipo),
    status: asBoolean(raw.status),
    companyId: toInt(raw.idEmpresa),
    companyName: asString(raw.nomeEmpresa),
    personId: toInt(raw.idPessoa),
    personName: asString(raw.nomePessoa),
    personCnpj: asString(raw.cnpjPessoa),
    personPhone: asString(raw.telefonePessoa),
    bankAccountId: toInt(raw.idContaBancaria),
    bankAccountName: asString(raw.nomeContaBancaria),
    paymentMethodId: toInt(raw.idFormaPagamento),
    paymentMethodName: asString(raw.nomeFormaPagamento),
    dueDate: parseNomusBrDate(raw.dataVencimento),
    competenceDate: parseNomusBrDate(raw.dataCompetencia),
    scheduleDate: parseNomusBrDate(raw.dataAgendamento),
    createdAtNomus: parseNomusBrDateTime(raw.dataHoraCriacao),
    modifiedAtNomus: parseNomusBrDateTime(raw.dataModificacao),
    settlementDate: parseNomusBrDate(raw.dataBaixa),
    amountReceivable: toOptionalDecimal(raw.valorReceber),
    amountScheduled: toOptionalDecimal(raw.valorReceberAgendado),
    amountReceived: toOptionalDecimal(raw.valorRecebido),
    balanceReceivable: toOptionalDecimal(raw.saldoReceber),
    description: asString(raw.descricaoLancamento),
    comments: asString(raw.comentarios),
    sourceInvoiceId: toInt(raw.idNfe),
    sourceInvoiceNumber: asString(raw.numeroNotaFiscalOrigem),
    suspendCollection: asBoolean(raw.suspenderCobranca),
    lateFeePercent: toOptionalDecimal(raw.percentualMultaPorAtrasoEmContasReceber),
    monthlyInterestRate: toOptionalDecimal(raw.taxaMensalJuros),
    lateFeeCalculationType: asString(raw.tipoCalculoMultaPorAtrasoEmContasReceber),
    lateInterestType: asString(raw.tipoJurosAtrasoEmContasReceber),
    rawPayload: raw,
    payloadHash: stableNomusPayloadHash(raw),
  };

  return { ok: true, row };
}
