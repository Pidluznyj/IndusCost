/**
 * Apresentação pura de exceções — idade, ação recomendada, deep-link.
 * Sem Prisma / sem I/O.
 */

import type {
  TreasuryExceptionEntityKind,
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
  TreasuryExceptionType,
} from "../contracts/treasuryEnums.js";
import { TREASURY_OPEN_EXCEPTION_STATUSES } from "../contracts/treasuryEnums.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeTreasuryExceptionAgeDays(
  detectedAtIso: string,
  nowEpochMs: number
): number {
  const detected = Date.parse(detectedAtIso);
  if (Number.isNaN(detected)) return 0;
  const days = Math.floor((nowEpochMs - detected) / MS_PER_DAY);
  return Math.max(0, days);
}

const RECOMMENDED_BY_TYPE: Partial<Record<TreasuryExceptionType, string>> = {
  EXPECTED_RECEIPT_NOT_RECEIVED: "Confirmar recebimento ou atualizar data esperada.",
  EXPECTED_PAYMENT_NOT_MADE: "Realizar pagamento ou reprogramar.",
  OVERDUE_RECEIVABLE_WITHOUT_ACTION: "Registrar ação de cobrança.",
  EXPIRED_PROMISE: "Renovar promessa ou registrar quebra.",
  CRITICAL_PAYMENT_NOT_PROGRAMMED: "Programar pagamento crítico.",
  ACCOUNT_BELOW_MINIMUM: "Reforçar saldo ou revisar mínimo operacional.",
  ACCOUNT_PROJECTION_NEGATIVE: "Antecipar entradas ou postergar saídas na conta.",
  CONSOLIDATED_PROJECTION_NEGATIVE: "Revisar caixa consolidado do dia.",
  STALE_BALANCE: "Atualizar saldo da conta.",
  BANK_MOVEMENT_UNIDENTIFIED: "Identificar movimento bancário.",
  RECONCILIATION_DIFFERENCE: "Investigar e conciliar diferença.",
  TRANSFER_IN_TRANSIT: "Confirmar recebimento da transferência.",
  TITLE_WITHOUT_RESPONSIBLE: "Atribuir responsável ao título.",
  SYNC_DELAYED: "Verificar sincronização Nomus.",
  SUSPECTED_DUPLICATE: "Analisar e confirmar/descartar duplicidade.",
  FINANCIAL_CHANGE_AFTER_CLOSING:
    "Reabrir o dia ou registrar tratamento formal da alteração pós-fechamento.",
  BALANCE_DIVERGENCE: "Investigar divergência de saldo.",
  NEGATIVE_BALANCE: "Corrigir saldo negativo.",
  POSITION_ALERT: "Revisar alerta de posição.",
  HIGH_PRIORITY_RECEIVABLES: "Priorizar cobrança.",
  HIGH_PRIORITY_PAYABLES: "Priorizar pagamento.",
  OVERDUE_WITHOUT_FORECAST: "Definir previsão de recebimento.",
  OFX_UNMATCHED: "Conciliar lançamento OFX.",
  MANUAL: "Tratar exceção manual.",
  OTHER: "Analisar e definir encaminhamento.",
};

export function recommendTreasuryExceptionAction(input: {
  type: TreasuryExceptionType;
  status: TreasuryExceptionStatus;
  severity: TreasuryExceptionSeverity;
  responsibleUserId: string | null;
}): string {
  if (
    !(TREASURY_OPEN_EXCEPTION_STATUSES as readonly string[]).includes(
      input.status
    )
  ) {
    if (input.status === "RESOLVED") return "Causa resolvida — sem ação.";
    if (input.status === "IGNORED") return "Ignorada — sem ação.";
    if (input.status === "CANCELLED") return "Cancelada — sem ação.";
    return "Sem ação.";
  }
  if (!input.responsibleUserId) {
    return "Atribuir responsável.";
  }
  if (input.status === "OPEN" || input.status === "ACK") {
    return (
      RECOMMENDED_BY_TYPE[input.type] ??
      "Colocar em análise e tratar a causa."
    );
  }
  if (input.status === "WAITING_THIRD_PARTY") {
    return "Acompanhar retorno do terceiro.";
  }
  return (
    RECOMMENDED_BY_TYPE[input.type] ?? "Prosseguir tratamento da causa."
  );
}

export function buildTreasuryExceptionEntityHref(input: {
  entityKind: TreasuryExceptionEntityKind | null;
  entityId: string | null;
  accountId: string | null;
  nomusExternalId: string | null;
  companyCode?: string | null;
  closedCivilDate?: string | null;
}): string | null {
  const kind = input.entityKind;
  if (!kind) {
    if (input.accountId) {
      return `/finance/treasury/accounts/${encodeURIComponent(input.accountId)}/balances`;
    }
    return null;
  }
  switch (kind) {
    case "ACCOUNT": {
      const id = input.accountId ?? input.entityId;
      return id
        ? `/finance/treasury/accounts/${encodeURIComponent(id)}/balances`
        : "/finance/treasury/accounts";
    }
    case "RECEIVABLE": {
      const qs = new URLSearchParams();
      if (input.entityId) qs.set("officialTitleId", input.entityId);
      if (input.nomusExternalId) qs.set("nomusExternalId", input.nomusExternalId);
      const q = qs.toString();
      return q
        ? `/finance/treasury/receivables?${q}`
        : "/finance/treasury/receivables";
    }
    case "PAYABLE": {
      const qs = new URLSearchParams();
      if (input.entityId) qs.set("officialTitleId", input.entityId);
      if (input.nomusExternalId) qs.set("nomusExternalId", input.nomusExternalId);
      const q = qs.toString();
      return q ? `/finance/treasury/payables?${q}` : "/finance/treasury/payables";
    }
    case "TRANSFER":
      return input.entityId
        ? `/finance/treasury/transfers?id=${encodeURIComponent(input.entityId)}`
        : "/finance/treasury/transfers";
    case "PROJECTION":
    case "POSITION":
      return "/finance/treasury/projections";
    case "RECONCILIATION":
      return "/finance/treasury";
    case "CLOSING": {
      const qs = new URLSearchParams();
      if (input.closedCivilDate) qs.set("date", input.closedCivilDate);
      if (input.companyCode) qs.set("companyCode", input.companyCode);
      const q = qs.toString();
      return q
        ? `/finance/treasury/closing?${q}`
        : "/finance/treasury/closing";
    }
    case "LEDGER_ENTRY":
      return input.accountId
        ? `/finance/treasury/accounts/${encodeURIComponent(input.accountId)}/balances`
        : "/finance/treasury/accounts";
    default:
      return "/finance/treasury";
  }
}
