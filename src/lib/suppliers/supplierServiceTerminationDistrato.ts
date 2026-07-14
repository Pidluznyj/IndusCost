/**
 * Termo de Distrato / acerto contratual PJ — labels, validações e textos imprimíveis.
 * Frontend-safe (sem Prisma). Não altera o motor de cálculo.
 */

import type {
  ServiceTerminationCommissionTreatmentDto,
  ServiceTerminationDto,
  ServiceTerminationNoticeOriginDto,
  ServiceTerminationStatusDto,
  ServiceTerminationTerminationModalityDto,
} from "./supplierServiceTerminationTypes.js";

/** Expressões proibidas no PDF/impressão do distrato (terminologia trabalhista). */
export const SERVICE_TERMINATION_FORBIDDEN_PRINT_TERMS = [
  "descanso remunerado",
  "aviso-prévio",
  "aviso previo",
  "aviso prévio",
  "férias",
  "ferias",
  "salário",
  "salario",
  "verbas rescisórias",
  "verbas rescisorias",
  "rescisão trabalhista",
  "rescisao trabalhista",
  "rescisão CLT",
  "rescisao CLT",
  "empregado",
  "funcionário",
  "funcionario",
  "horas por dia",
  "horas por mês",
  "horas por mes",
  "valor hora",
  "multa sem aviso",
] as const;

export const SERVICE_TERMINATION_PJ_WARNING =
  "Este modelo é destinado exclusivamente a contratos civis de prestação de serviços PJ. Não utilizar para empregado CLT ou representação comercial regida por contrato específico.";

export const DISTRATO_DOCUMENT_TITLE =
  "TERMO DE DISTRATO, ACERTO FINANCEIRO E QUITAÇÃO\nDE CONTRATO DE PRESTAÇÃO DE SERVIÇOS";

export const DISTRATO_FOOTER_BASE =
  "Documento civil e contratual gerado pelo IndusCost. A quitação financeira somente é válida após a confirmação integral do pagamento e a assinatura das partes.";

export const DISTRATO_FOOTER_MINUTA = "MINUTA — SEM EFEITO DE QUITAÇÃO.";

export function normalizeServiceTerminationStatus(
  status: string
): ServiceTerminationStatusDto {
  if (status === "FINALIZED") return "PAID_AND_SETTLED";
  if (
    status === "DRAFT" ||
    status === "AWAITING_SIGNATURE" ||
    status === "SIGNED_AWAITING_PAYMENT" ||
    status === "PAID_AND_SETTLED" ||
    status === "CANCELED"
  ) {
    return status;
  }
  return "DRAFT";
}

export function formatDistratoStatusLabel(status: string): string {
  switch (normalizeServiceTerminationStatus(status)) {
    case "DRAFT":
      return "Prévia / Minuta";
    case "AWAITING_SIGNATURE":
      return "Aguardando assinatura";
    case "SIGNED_AWAITING_PAYMENT":
      return "Assinado — aguardando pagamento";
    case "PAID_AND_SETTLED":
      return "Pago e quitado";
    case "CANCELED":
      return "Cancelado";
    default:
      return status;
  }
}

export function isServiceTerminationEditableStatus(status: string): boolean {
  const s = normalizeServiceTerminationStatus(status);
  return s === "DRAFT" || s === "AWAITING_SIGNATURE" || s === "SIGNED_AWAITING_PAYMENT";
}

export function isServiceTerminationLockedStatus(status: string): boolean {
  const s = normalizeServiceTerminationStatus(status);
  return s === "PAID_AND_SETTLED" || s === "CANCELED";
}

export function isMinutaPrintStatus(status: string): boolean {
  return normalizeServiceTerminationStatus(status) === "DRAFT";
}

export function isPaidAndSettledStatus(status: string): boolean {
  return normalizeServiceTerminationStatus(status) === "PAID_AND_SETTLED";
}

export function formatNoticeOriginPrintLabel(
  origin: ServiceTerminationNoticeOriginDto | null | undefined,
  clauseNumber?: string | null
): string {
  if (origin === "CONTRACT_CLAUSE") {
    const clause = clauseNumber?.trim();
    return clause
      ? `Compensação contratual pelo encerramento sem antecedência (cláusula ${clause})`
      : "Compensação contratual pelo encerramento sem antecedência";
  }
  return "Valor negociado para encerramento contratual";
}

export function formatTerminationModalityLabel(
  modality: ServiceTerminationTerminationModalityDto | null | undefined
): string {
  switch (modality) {
    case "MUTUAL_AGREEMENT":
      return "comum acordo";
    case "CONTRACTOR_INITIATIVE":
      return "iniciativa da CONTRATANTE";
    case "CONTRACTED_INITIATIVE":
      return "iniciativa da CONTRATADA";
    default:
      return "comum acordo";
  }
}

export function formatCommissionTreatmentLabel(
  treatment: ServiceTerminationCommissionTreatmentDto | null | undefined
): string {
  switch (treatment) {
    case "NONE_PENDING":
      return "Não existem comissões pendentes";
    case "HAS_PENDING":
      return "Existem comissões pendentes (fora da quitação)";
    case "NEGOTIATED_INCLUDED":
      return "Comissões incluídas em valor negociado";
    default:
      return "Não informado";
  }
}

/** Parcelas do acerto com nomes civis/contratuais (impressão). */
export function buildDistratoSettlementRows(dto: ServiceTerminationDto): Array<{
  label: string;
  value: number;
  emphasize?: boolean;
}> {
  const noticeLabel = formatNoticeOriginPrintLabel(
    dto.noticePenaltyOrigin,
    dto.noticePenaltyClauseNumber
  );
  return [
    { label: "Compensação contratual proporcional", value: dto.proportionalRestAmount },
    { label: "Saldo adicional de serviços prestados", value: dto.extraWorkedAmount },
    { label: noticeLabel, value: dto.noticePenaltyAmount },
    { label: "Comissões comerciais apuradas", value: dto.commissionReportTotal },
    { label: "Outros valores devidos ao prestador", value: dto.otherCredits },
    {
      label: "Compensações e deduções contratualmente autorizadas",
      value: -Math.abs(dto.otherDiscounts),
    },
    {
      label: "VALOR LÍQUIDO DO ACERTO CONTRATUAL",
      value: dto.totalTerminationAmount,
      emphasize: true,
    },
  ];
}

export function sumDistratoSettlementParts(dto: Pick<
  ServiceTerminationDto,
  | "proportionalRestAmount"
  | "extraWorkedAmount"
  | "noticePenaltyAmount"
  | "commissionReportTotal"
  | "otherCredits"
  | "otherDiscounts"
>): number {
  return (
    round2(dto.proportionalRestAmount) +
    round2(dto.extraWorkedAmount) +
    round2(dto.noticePenaltyAmount) +
    round2(dto.commissionReportTotal) +
    round2(dto.otherCredits) -
    round2(Math.abs(dto.otherDiscounts))
  );
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type DistratoValidationIssue = { code: string; message: string };

export function validateDistratoForStatusTransition(input: {
  dto: ServiceTerminationDto;
  targetStatus: ServiceTerminationStatusDto;
}): DistratoValidationIssue[] {
  const { dto, targetStatus } = input;
  const issues: DistratoValidationIssue[] = [];
  const requireParties =
    targetStatus === "AWAITING_SIGNATURE" ||
    targetStatus === "SIGNED_AWAITING_PAYMENT" ||
    targetStatus === "PAID_AND_SETTLED";

  if (requireParties) {
    if (!dto.contractingPartyName?.trim() || !dto.contractingPartyDocument?.trim()) {
      issues.push({
        code: "CONTRACTOR_INCOMPLETE",
        message: "Contratante incompleta (razão social e CNPJ).",
      });
    }
    if (!dto.contractedPartyName?.trim() || !dto.contractedPartyDocument?.trim()) {
      issues.push({
        code: "CONTRACTED_INCOMPLETE",
        message: "Contratada incompleta (razão social e CNPJ).",
      });
    }
    if (!dto.contractingPartyRepName?.trim() || !dto.contractingPartyRepRole?.trim()) {
      issues.push({
        code: "CONTRACTOR_REP_INCOMPLETE",
        message: "Representante e cargo da contratante são obrigatórios.",
      });
    }
    if (!dto.contractedPartyRepName?.trim() || !dto.contractedPartyRepDocument?.trim()) {
      issues.push({
        code: "CONTRACTED_REP_INCOMPLETE",
        message: "Representante e CPF da contratada são obrigatórios.",
      });
    }
    if (!dto.originalContractReference?.trim()) {
      issues.push({
        code: "CONTRACT_REF_REQUIRED",
        message: "Informe a referência do contrato original.",
      });
    }
    if (!dto.contractEndDate?.trim()) {
      issues.push({
        code: "END_DATE_REQUIRED",
        message: "Informe a data efetiva do encerramento.",
      });
    }
    if (!dto.terminationModality) {
      issues.push({
        code: "MODALITY_REQUIRED",
        message: "Informe a modalidade do encerramento.",
      });
    }
    if (!dto.commissionTreatment) {
      issues.push({
        code: "COMMISSION_TREATMENT_REQUIRED",
        message: "Tratamento das comissões é obrigatório.",
      });
    }
    if (
      Math.abs(dto.otherDiscounts) > 0.009 &&
      !dto.otherDiscountsDescription?.trim()
    ) {
      issues.push({
        code: "DISCOUNT_DESCRIPTION_REQUIRED",
        message: "Desconto diferente de zero exige descrição.",
      });
    }
    if (Math.abs(dto.noticePenaltyAmount) > 0.009 && !dto.noticePenaltyOrigin) {
      issues.push({
        code: "NOTICE_ORIGIN_REQUIRED",
        message: "Informe a origem da compensação de encerramento.",
      });
    }
    if (
      dto.noticePenaltyOrigin === "CONTRACT_CLAUSE" &&
      Math.abs(dto.noticePenaltyAmount) > 0.009 &&
      !dto.noticePenaltyClauseNumber?.trim()
    ) {
      issues.push({
        code: "CLAUSE_NUMBER_REQUIRED",
        message: "Informe o número da cláusula contratual.",
      });
    }
    if (dto.commissionTreatment === "HAS_PENDING" && !dto.commissionPendingNotes?.trim()) {
      issues.push({
        code: "PENDING_COMMISSION_NOTES",
        message: "Relate as comissões pendentes (anexo / observações).",
      });
    }
    if (dto.commissionTreatment === "NEGOTIATED_INCLUDED") {
      if (!(Number(dto.commissionNegotiatedAmount) > 0)) {
        issues.push({
          code: "NEGOTIATED_AMOUNT_REQUIRED",
          message: "Informe o valor negociado das comissões.",
        });
      }
      if (!dto.commissionNegotiatedJustification?.trim()) {
        issues.push({
          code: "NEGOTIATED_JUSTIFICATION_REQUIRED",
          message: "Informe a justificativa do valor negociado de comissões.",
        });
      }
      if (!dto.commissionNegotiatedApprover?.trim()) {
        issues.push({
          code: "NEGOTIATED_APPROVER_REQUIRED",
          message: "Informe quem aprovou o valor negociado de comissões.",
        });
      }
    }
    const parts = sumDistratoSettlementParts(dto);
    if (Math.abs(parts - round2(dto.totalTerminationAmount)) > 0.02) {
      issues.push({
        code: "TOTAL_MISMATCH",
        message: "Total não confere com a soma das parcelas do acerto.",
      });
    }
  }

  if (targetStatus === "PAID_AND_SETTLED") {
    if (dto.commissionTreatment === "HAS_PENDING") {
      issues.push({
        code: "PENDING_COMMISSION_BLOCKS_SETTLEMENT",
        message:
          "Não é possível quitar com comissões pendentes fora deste documento.",
      });
    }
    if (!dto.paymentEffectiveDate?.trim()) {
      issues.push({
        code: "PAYMENT_DATE_REQUIRED",
        message: "Informe a data efetiva do pagamento.",
      });
    }
    if (!dto.paymentMethod?.trim()) {
      issues.push({
        code: "PAYMENT_METHOD_REQUIRED",
        message: "Informe a forma de pagamento.",
      });
    }
    if (!dto.paymentTransactionId?.trim()) {
      issues.push({
        code: "PAYMENT_TX_REQUIRED",
        message: "Informe a identificação da transação.",
      });
    }
    const paid = Number(dto.paymentConfirmedAmount);
    if (!Number.isFinite(paid)) {
      issues.push({
        code: "PAYMENT_AMOUNT_REQUIRED",
        message: "Informe o valor efetivamente pago.",
      });
    } else if (Math.abs(paid - round2(dto.totalTerminationAmount)) > 0.02) {
      issues.push({
        code: "PAYMENT_AMOUNT_MISMATCH",
        message: "Valor pago difere do valor líquido do acerto.",
      });
    }
    const hasProof = Boolean(dto.paymentProofStorageKey?.trim());
    const hasWaiver = Boolean(dto.paymentProofWaiverReason?.trim());
    if (!hasProof && !hasWaiver) {
      issues.push({
        code: "PAYMENT_PROOF_REQUIRED",
        message: "Anexe comprovante ou informe justificativa de dispensa.",
      });
    }
  }

  return issues;
}

export function buildCommissionClauseText(
  treatment: ServiceTerminationCommissionTreatmentDto | null | undefined
): string {
  if (treatment === "HAS_PENDING") {
    return "As comissões relacionadas no Anexo II permanecem pendentes e não estão abrangidas pela quitação concedida neste instrumento, devendo observar as condições e os eventos de exigibilidade indicados no referido anexo.";
  }
  if (treatment === "NEGOTIATED_INCLUDED") {
    return "As comissões comerciais foram objeto de acordo negociado entre as partes, nos termos e valores discriminados neste instrumento e em seus anexos, observadas as justificativas e a aprovação registradas no sistema.";
  }
  return "As partes declaram que as comissões comerciais conhecidas, vencidas e relacionadas aos pedidos abrangidos por este encerramento foram conferidas e estão discriminadas no Anexo I deste instrumento, não existindo outras comissões identificadas como pendentes na data de sua assinatura.";
}

export function buildPendingObligationsClauseText(
  hasPending: boolean,
  notes?: string | null
): string {
  if (hasPending || notes?.trim()) {
    return `Permanecem pendentes exclusivamente as obrigações relacionadas no Anexo II${
      notes?.trim() ? ` (${notes.trim()})` : ""
    }, as quais não são abrangidas pela quitação deste instrumento.`;
  }
  return "As partes declaram que não existem obrigações contratuais conhecidas pendentes relacionadas ao contrato encerrado, além das expressamente indicadas neste instrumento.";
}

export function collectForbiddenPrintTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return SERVICE_TERMINATION_FORBIDDEN_PRINT_TERMS.filter((term) =>
    lower.includes(term.toLowerCase())
  );
}

/** Remove CPF/documentos sensíveis de payloads de auditoria. */
export function redactSensitiveDistratoFields<T extends Record<string, unknown>>(
  payload: T
): T {
  const clone = { ...payload } as Record<string, unknown>;
  const keys = [
    "contractingPartyRepDocument",
    "contractedPartyRepDocument",
    "witness1Document",
    "witness2Document",
    "personDocument",
  ];
  for (const key of keys) {
    if (typeof clone[key] === "string" && String(clone[key]).trim()) {
      clone[key] = "***";
    }
  }
  return clone as T;
}
