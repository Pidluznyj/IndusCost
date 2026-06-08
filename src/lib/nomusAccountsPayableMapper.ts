import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  asBoolean,
  asString,
  parseNomusBrDate,
  parseNomusBrDateTime,
  parseNomusOptionalMoney,
  toInt,
} from "@/src/lib/nomusAccountsPayableParser.js";

export type JsonObject = Record<string, unknown>;

export type MappedNomusAccountsPayable = {
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
  paymentDate: Date | null;
  amountPayable: Prisma.Decimal | null;
  amountScheduled: Prisma.Decimal | null;
  amountPaid: Prisma.Decimal | null;
  balancePayable: Prisma.Decimal | null;
  description: string | null;
  comments: string | null;
  documentNumber: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  suspendPayment: boolean | null;
  lateFeePercent: Prisma.Decimal | null;
  monthlyInterestRate: Prisma.Decimal | null;
  lateFeeCalculationType: string | null;
  lateInterestType: string | null;
  rawPayload: JsonObject;
  payloadHash: string;
};

export type MapResult =
  | { ok: true; row: MappedNomusAccountsPayable }
  | { ok: false; reasons: string[]; externalId: number | null };

function toOptionalDecimal(value: unknown): Prisma.Decimal | null {
  const n = parseNomusOptionalMoney(value);
  return n == null ? null : new Prisma.Decimal(n);
}

/** Valores monetários AP: Nomus pode enviar negativos (campos *Receber*); dashboard usa positivo. */
export function toOptionalPositiveDecimal(value: unknown): Prisma.Decimal | null {
  const n = parseNomusOptionalMoney(value);
  if (n == null) return null;
  return new Prisma.Decimal(Math.abs(n));
}

function firstMoney(raw: JsonObject, keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] != null && raw[key] !== "") return raw[key];
  }
  return null;
}

export function stableNomusPayloadHash(raw: JsonObject): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

export function mapNomusAccountsPayablePayload(raw: JsonObject): MapResult {
  const externalId = toInt(raw.id);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const row: MappedNomusAccountsPayable = {
    externalId,
    classification: asString(raw.classificacao),
    type: toInt(raw.tipo),
    status: asBoolean(raw.status),
    companyId: toInt(raw.idEmpresa),
    companyName: asString(raw.nomeEmpresa),
    personId: toInt(raw.idPessoa ?? raw.idFornecedor),
    personName: asString(raw.nomePessoa ?? raw.nomeFornecedor),
    personCnpj: asString(raw.cnpjPessoa ?? raw.cpfCnpj ?? raw.cnpjFornecedor),
    personPhone: asString(raw.telefonePessoa ?? raw.telefoneFornecedor),
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
    paymentDate: parseNomusBrDate(raw.dataPagamento),
    amountPayable: toOptionalPositiveDecimal(
      firstMoney(raw, ["valorPagar", "valorAPagar", "valorReceber"])
    ),
    amountScheduled: toOptionalPositiveDecimal(
      firstMoney(raw, [
        "valorPagarAgendado",
        "valorAgendado",
        "valorAPagarAgendado",
        "valorReceberAgendado",
      ])
    ),
    amountPaid: toOptionalPositiveDecimal(
      firstMoney(raw, ["valorPago", "valorAPago", "valorRecebido", "valorBaixadoSemNumerario"])
    ),
    balancePayable: toOptionalPositiveDecimal(
      firstMoney(raw, ["saldoPagar", "saldoAPagar", "saldoReceber"])
    ),
    description: asString(raw.descricaoLancamento),
    comments: asString(raw.comentarios),
    documentNumber: asString(raw.numeroDocumento ?? raw.numeroNotaFiscalOrigem),
    sourceInvoiceId: toInt(raw.idNfe),
    sourceInvoiceNumber: asString(raw.numeroNotaFiscalOrigem),
    suspendPayment: asBoolean(raw.suspenderPagamento ?? raw.suspenderCobranca),
    lateFeePercent: toOptionalDecimal(
      firstMoney(raw, [
        "percentualMultaPorAtrasoEmContasPagar",
        "percentualMultaPorAtrasoEmContasReceber",
      ])
    ),
    monthlyInterestRate: toOptionalDecimal(raw.taxaMensalJuros),
    lateFeeCalculationType: asString(
      raw.tipoCalculoMultaPorAtrasoEmContasPagar ?? raw.tipoCalculoMultaPorAtrasoEmContasReceber
    ),
    lateInterestType: asString(
      raw.tipoJurosAtrasoEmContasPagar ?? raw.tipoJurosAtrasoEmContasReceber
    ),
    rawPayload: raw,
    payloadHash: stableNomusPayloadHash(raw),
  };

  return { ok: true, row };
}
