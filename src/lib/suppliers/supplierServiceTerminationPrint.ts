/**
 * Modelo de impressão — Termo de Distrato / Acerto Financeiro / Quitação (PJ).
 * Frontend-safe (sem Prisma).
 */

import {
  DISTRATO_DOCUMENT_TITLE,
  DISTRATO_FOOTER_BASE,
  DISTRATO_FOOTER_MINUTA,
  buildCommissionClauseText,
  buildDistratoSettlementRows,
  buildPendingObligationsClauseText,
  formatDistratoStatusLabel,
  formatTerminationModalityLabel,
  isMinutaPrintStatus,
  isPaidAndSettledStatus,
} from "./supplierServiceTerminationDistrato.js";
import type { ServiceTerminationDto } from "./supplierServiceTerminationTypes.js";

export const SERVICE_TERMINATION_PRINT_DOCUMENT_TITLE = DISTRATO_DOCUMENT_TITLE.replace(
  "\n",
  " "
);

export const SERVICE_TERMINATION_PRINT_SUBTITLE =
  "Instrumento civil e contratual de encerramento de prestação de serviços PJ";

export const SERVICE_TERMINATION_PRINT_FOOTER_NOTE = DISTRATO_FOOTER_BASE;

export function buildServiceTerminationPrintPath(
  supplierId: string,
  terminationId: string
): string {
  return `/finance/suppliers/${encodeURIComponent(supplierId)}/service-terminations/${encodeURIComponent(terminationId)}/print`;
}

export function formatServiceTerminationStatusLabel(status: string): string {
  return formatDistratoStatusLabel(status);
}

export function formatServiceTerminationDateBr(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export type ServiceTerminationPrintMoneyRow = {
  label: string;
  value: number;
  emphasize?: boolean;
};

export type ServiceTerminationPrintCommissionRow = {
  orderCode: string;
  description: string;
  personName: string;
  source: string;
  statusLabel: string;
  amount: number;
};

export type ServiceTerminationPrintModel = {
  documentTitle: string;
  documentCode: string;
  documentVersion: number;
  documentHighlight: string;
  status: string;
  statusLabel: string;
  isMinuta: boolean;
  isPaidAndSettled: boolean;
  showQuitacaoClause: boolean;
  watermarkText: string | null;
  footerNote: string;
  contractingPartyName: string;
  contractingPartyDocument: string;
  contractingPartyRepName: string;
  contractingPartyRepRole: string;
  contractingPartyRepDocument: string;
  contractedPartyName: string;
  contractedPartyDocument: string;
  contractedPartyRepName: string;
  contractedPartyRepDocument: string;
  originalContractReference: string;
  originalContractDateLabel: string;
  contractedServiceDescription: string;
  periodLabel: string;
  modalityLabel: string;
  terminationReason: string | null;
  signaturePlace: string;
  settlementRows: ServiceTerminationPrintMoneyRow[];
  totalTerminationAmount: number;
  commissionRows: ServiceTerminationPrintCommissionRow[];
  commissionClause: string;
  paymentDueDateLabel: string;
  paymentEffectiveDateLabel: string;
  paymentMethod: string;
  paymentTransactionId: string;
  paymentConfirmedAmount: number | null;
  paymentClause: string;
  quitacaoClause: string | null;
  pendingObligationsClause: string;
  freeManifestationClause: string;
  contractualNotes: string | null;
  proportionalCompensationJustification: string | null;
  extraServicesDescription: string | null;
  witness1Name: string;
  witness1Document: string;
  witness2Name: string;
  witness2Document: string;
  integrityCode: string;
  issuedBy: string;
};

function moneyPlain(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const [intPart, dec = "00"] = abs.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${grouped},${dec}`;
}

export function buildServiceTerminationPrintModel(
  dto: ServiceTerminationDto,
  options?: { issuedBy?: string | null }
): ServiceTerminationPrintModel {
  const isMinuta = isMinutaPrintStatus(dto.status);
  const paid = isPaidAndSettledStatus(dto.status);
  const totalLabel = moneyPlain(dto.totalTerminationAmount);
  const payDate = formatServiceTerminationDateBr(
    dto.paymentEffectiveDate || dto.paymentDueDate
  );
  const payMethod = dto.paymentMethod?.trim() || "—";
  const payTx = dto.paymentTransactionId?.trim() || "—";

  const paymentClause = paid
    ? `A CONTRATADA declara ter recebido, de maneira efetiva e integral, o valor líquido de ${totalLabel}, em ${payDate}, por meio de ${payMethod}, sob a identificação ${payTx}.`
    : `O valor líquido de ${totalLabel} será pago pela CONTRATANTE em ${payDate}, por meio de ${payMethod}, sob a identificação ${payTx}. A declaração de quitação somente produzirá efeitos após a efetiva e integral disponibilização do valor em favor da CONTRATADA.`;

  const quitacaoClause = paid
    ? `Confirmado o pagamento integral, a CONTRATADA concede à CONTRATANTE quitação específica, plena, irrevogável e irretratável quanto aos valores e às obrigações civis e contratuais expressamente discriminados neste instrumento e em seus anexos, relativos ao contrato e ao período compreendido entre ${formatServiceTerminationDateBr(dto.contractStartDate)} e ${formatServiceTerminationDateBr(dto.contractEndDate)}. A CONTRATADA declara não possuir outros valores civis ou contratuais conhecidos a receber referentes ao período e às obrigações expressamente abrangidas por este instrumento, ressalvadas exclusivamente as pendências eventualmente identificadas em anexo.`
    : dto.status === "SIGNED_AWAITING_PAYMENT" || dto.status === "AWAITING_SIGNATURE"
      ? "Quitação pendente de confirmação do pagamento e da assinatura das partes. Este instrumento ainda não produz quitação financeira definitiva."
      : null;

  const commissionRows: ServiceTerminationPrintCommissionRow[] = (dto.commissionLinks ?? []).map(
    (l) => ({
      orderCode: l.orderCode?.trim() || "—",
      description: l.periodLabel?.trim() || "—",
      personName: l.commissionPersonName?.trim() || "—",
      source:
        (l.source ?? "").toUpperCase() === "MANUAL"
          ? "Manual"
          : l.source?.trim() || "Relatório oficial",
      statusLabel: l.statusLabel?.trim() || "—",
      amount: l.commissionAmount,
    })
  );

  const footerNote = isMinuta
    ? `${DISTRATO_FOOTER_BASE} ${DISTRATO_FOOTER_MINUTA}`
    : DISTRATO_FOOTER_BASE;

  return {
    documentTitle: SERVICE_TERMINATION_PRINT_DOCUMENT_TITLE,
    documentCode: dto.documentCode?.trim() || dto.id.slice(0, 8).toUpperCase(),
    documentVersion: dto.documentVersion || 1,
    documentHighlight: dto.documentCode?.trim() || dto.personName?.trim() || dto.id.slice(0, 8),
    status: dto.status,
    statusLabel: formatDistratoStatusLabel(dto.status),
    isMinuta,
    isPaidAndSettled: paid,
    showQuitacaoClause: paid,
    watermarkText: isMinuta ? DISTRATO_FOOTER_MINUTA : null,
    footerNote,
    contractingPartyName: dto.contractingPartyName?.trim() || "—",
    contractingPartyDocument: dto.contractingPartyDocument?.trim() || "—",
    contractingPartyRepName: dto.contractingPartyRepName?.trim() || "—",
    contractingPartyRepRole: dto.contractingPartyRepRole?.trim() || "—",
    contractingPartyRepDocument: dto.contractingPartyRepDocument?.trim() || "—",
    contractedPartyName: dto.contractedPartyName?.trim() || dto.supplierName || "—",
    contractedPartyDocument:
      dto.contractedPartyDocument?.trim() || dto.personDocument?.trim() || "—",
    contractedPartyRepName: dto.contractedPartyRepName?.trim() || dto.personName || "—",
    contractedPartyRepDocument: dto.contractedPartyRepDocument?.trim() || "—",
    originalContractReference: dto.originalContractReference?.trim() || "—",
    originalContractDateLabel: formatServiceTerminationDateBr(
      dto.originalContractDate || dto.contractStartDate
    ),
    contractedServiceDescription:
      dto.contractedServiceDescription?.trim() ||
      dto.serviceRole?.trim() ||
      "prestação de serviços",
    periodLabel: `${formatServiceTerminationDateBr(dto.contractStartDate)} a ${formatServiceTerminationDateBr(dto.contractEndDate)}`,
    modalityLabel: formatTerminationModalityLabel(dto.terminationModality),
    terminationReason: dto.terminationReason?.trim() || null,
    signaturePlace: dto.signaturePlace?.trim() || "—",
    settlementRows: buildDistratoSettlementRows(dto),
    totalTerminationAmount: dto.totalTerminationAmount,
    commissionRows,
    commissionClause: buildCommissionClauseText(dto.commissionTreatment),
    paymentDueDateLabel: formatServiceTerminationDateBr(dto.paymentDueDate),
    paymentEffectiveDateLabel: formatServiceTerminationDateBr(dto.paymentEffectiveDate),
    paymentMethod: payMethod,
    paymentTransactionId: payTx,
    paymentConfirmedAmount: dto.paymentConfirmedAmount,
    paymentClause,
    quitacaoClause,
    pendingObligationsClause: buildPendingObligationsClauseText(
      dto.hasPendingObligations,
      dto.pendingObligationsNotes
    ),
    freeManifestationClause:
      "As partes declaram que leram o presente instrumento, compreenderam seu conteúdo e o assinam de forma livre e consciente, reconhecendo a exatidão dos valores, documentos e informações nele discriminados.",
    contractualNotes: dto.contractualNotes?.trim() || dto.notes?.trim() || null,
    proportionalCompensationJustification:
      dto.proportionalCompensationJustification?.trim() || null,
    extraServicesDescription: dto.extraServicesDescription?.trim() || null,
    witness1Name: dto.witness1Name?.trim() || "—",
    witness1Document: dto.witness1Document?.trim() || "—",
    witness2Name: dto.witness2Name?.trim() || "—",
    witness2Document: dto.witness2Document?.trim() || "—",
    integrityCode: dto.integrityCode?.trim() || dto.id.slice(0, 12).toUpperCase(),
    issuedBy: options?.issuedBy?.trim() || dto.finalizedByName || dto.createdByName || "—",
  };
}

/** Texto plano do PDF/impressão para testes de termos proibidos. */
export function buildServiceTerminationPrintPlainText(
  dto: ServiceTerminationDto
): string {
  const m = buildServiceTerminationPrintModel(dto);
  const parts = [
    m.documentTitle,
    m.documentCode,
    m.statusLabel,
    m.watermarkText ?? "",
    m.contractingPartyName,
    m.contractedPartyName,
    m.commissionClause,
    m.paymentClause,
    m.quitacaoClause ?? "",
    m.pendingObligationsClause,
    m.freeManifestationClause,
    m.footerNote,
    ...m.settlementRows.map((r) => r.label),
    ...m.commissionRows.map(
      (r) => `${r.orderCode} ${r.description} ${r.personName} ${r.source} ${r.statusLabel}`
    ),
  ];
  return parts.join("\n");
}
