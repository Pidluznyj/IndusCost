/**
 * Adaptador canônico do Apoio ao Caixa (CS-002).
 *
 * Consome exclusivamente a saída oficial de `treasuryCaixaService.getBoard`
 * (fonte canônica da Linha do tempo — ver `01-current-state-audit.md`).
 *
 * PROIBIDO: consultar Proposal, SalesOrder, DS, NF-e, AR ou AP diretamente
 * para reconstruir valor monetário. Este arquivo só projeta o que o motor
 * único-de-dia (`treasuryCaixaCanonicalDay.ts`) já entregou pronto — mesma
 * regra do resto do módulo ("NÃO recalcula fluxo — apenas COMPÕE").
 *
 * Identidade (ADR 001): `externalId > 0` é título real do Nomus (estável);
 * `externalId <= 0` é previsão sintética do FIN-08 (instável, id embute
 * dueDate/parcela). O board devolve só `externalId` nas grids — não há
 * `lineKind`/`orderCode` no contrato atual (ver `03-...gap-matrix.md` #11).
 * Por isso a classificação FORECAST x OFFICIAL_* usa exclusivamente o sinal
 * de `externalId`, que é o único dado disponível e é suficiente para a
 * regra que importa: só título real pode ser conciliável.
 */

import type {
  TreasuryCaixaCanonicalDay,
  TreasuryCaixaCanonicalDayPayableTitle,
  TreasuryCaixaCanonicalDayReceivableTitle,
} from "../domain/treasuryCaixaCanonicalDay.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";
import {
  buildCashSupportOfficialTitleKey,
  buildCashSupportForecastContextKey,
  type CashSupportUnifiedRow,
  type CashSupportWarning,
} from "../contracts/cashSupportContracts.js";

/** `number` canônico (já com 2 casas — `roundMoney` do motor) → string monetária. */
function moneyFromCanonical(value: number): string {
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

const NO_COMPANY_CONTEXT_WARNING: CashSupportWarning = {
  code: "COMPANY_CONTEXT_UNAVAILABLE",
  message:
    "A Linha do tempo canônica não expõe empresa por título — board é monoempresa (ver 01-current-state-audit.md §7 / matriz #41).",
};
const NO_ACCOUNT_CONTEXT_WARNING: CashSupportWarning = {
  code: "ACCOUNT_CONTEXT_UNAVAILABLE",
  message:
    "O título canônico não carrega accountId — só bankAccountName em texto livre, sem vínculo confiável com a conta (matriz #42).",
};

/**
 * Uma linha de recebível é REAL quando `externalId > 0`; caso contrário é
 * previsão sintética do FIN-08 (`syntheticExternalId`, sempre negativo).
 */
function isRealTitleExternalId(externalId: number): boolean {
  return Number.isInteger(externalId) && externalId > 0;
}

function receivableTitleToRow(
  title: TreasuryCaixaCanonicalDayReceivableTitle,
  civilDate: string,
  dimension: "DUE" | "RECEIVED",
  companyCode: string | null
): CashSupportUnifiedRow {
  const real = isRealTitleExternalId(title.externalId);
  const grossAmount = moneyFromCanonical(title.amountReceivable);
  const receivedAmount = moneyFromCanonical(title.amountReceived);
  const balanceAmount = moneyFromCanonical(title.balanceReceivable);

  const warnings: CashSupportWarning[] = [NO_ACCOUNT_CONTEXT_WARNING];
  if (!companyCode) warnings.push(NO_COMPANY_CONTEXT_WARNING);
  if (!real) {
    warnings.push({
      code: "FORECAST_CONTEXT_ONLY",
      message:
        "Previsão do Pedido (FIN-08) — id sintético instável, muda com reagendamento. Contexto informativo apenas.",
    });
  }

  // Título real sem empresa conhecida não pode formar chave — não inventa
  // companyCode; fica sem identidade conciliável até o contexto existir.
  const officialTitleKey =
    real && companyCode
      ? buildCashSupportOfficialTitleKey({
          companyCode,
          side: "ACCOUNTS_RECEIVABLE",
          externalId: title.externalId,
        })
      : null;

  return {
    displayId: `receivable:${dimension.toLowerCase()}:${title.externalId}:${civilDate}`,
    resourceType: real ? "OFFICIAL_RECEIVABLE" : "FORECAST",
    officialTitleKey,
    bankMovementKey: null,
    forecastContextKey: real
      ? null
      : buildCashSupportForecastContextKey({
          orderCode: null,
          lineKind: "ORDER_FORECAST",
          syntheticId: title.externalId,
        }),
    reconcilable: false, // CS-002 é read-only; conciliação real entra no orquestrador (CS-008).
    direction: "IN",
    description: title.personName,
    expectedDate: real ? null : title.dueDate,
    dueDate: title.dueDate,
    bankDate: null,
    occurredAt: dimension === "RECEIVED" ? title.settlementDate : null,
    sourceUpdatedAt: null,
    expectedAmount: real ? null : grossAmount,
    officialAmount: real ? grossAmount : null,
    bankAmount: null,
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: dimension === "RECEIVED" ? receivedAmount : balanceAmount,
    reconciliationState: "NOT_APPLICABLE",
    sourceState: title.calculatedStatus,
    companyContext: companyCode ? { companyCode } : null,
    accountContext: null,
    currencyContext: { currency: "BRL", assumed: true },
    sourceReferences: [
      {
        source: "FinanceAccountsReceivableGridRow",
        id: String(title.externalId),
        label: title.documentNumber ?? null,
      },
    ],
    warnings,
    availableActions: [
      {
        kind: "RECONCILE",
        enabled: false,
        disabledReason: real
          ? "Conciliação é exposta pelo orquestrador (CS-008), não por este adaptador."
          : "Previsão nunca é conciliável (ADR 001).",
      },
    ],
  };
}

function payableTitleToRow(
  title: TreasuryCaixaCanonicalDayPayableTitle,
  civilDate: string,
  dimension: "DUE" | "PAID",
  companyCode: string | null
): CashSupportUnifiedRow {
  const real = isRealTitleExternalId(title.externalId);
  const grossAmount = moneyFromCanonical(title.amountPayable);
  const paidAmount = moneyFromCanonical(title.amountPaid);
  const balanceAmount = moneyFromCanonical(title.balancePayable);

  const warnings: CashSupportWarning[] = [NO_ACCOUNT_CONTEXT_WARNING];
  if (!companyCode) warnings.push(NO_COMPANY_CONTEXT_WARNING);
  if (!real) {
    warnings.push({
      code: "FORECAST_CONTEXT_ONLY",
      message: "Previsão de pagamento — contexto informativo apenas.",
    });
  }

  const officialTitleKey =
    real && companyCode
      ? buildCashSupportOfficialTitleKey({
          companyCode,
          side: "ACCOUNTS_PAYABLE",
          externalId: title.externalId,
        })
      : null;

  return {
    displayId: `payable:${dimension.toLowerCase()}:${title.externalId}:${civilDate}`,
    resourceType: real ? "OFFICIAL_PAYABLE" : "FORECAST",
    officialTitleKey,
    bankMovementKey: null,
    forecastContextKey: real
      ? null
      : buildCashSupportForecastContextKey({
          orderCode: null,
          lineKind: "PAYABLE_FORECAST",
          syntheticId: title.externalId,
        }),
    reconcilable: false,
    direction: "OUT",
    description: title.personName,
    expectedDate: real ? null : title.dueDate,
    dueDate: title.dueDate,
    // Regra canônica: CP realizado usa a data de VENCIMENTO (Nomus raramente
    // informa a data real do pagamento) — NÃO é bankDate. bankDate só existe
    // quando há movimento bancário evidenciando (adaptador bancário, CS-003).
    bankDate: null,
    occurredAt: dimension === "PAID" ? title.paymentDate : null,
    sourceUpdatedAt: null,
    expectedAmount: real ? null : grossAmount,
    officialAmount: real ? grossAmount : null,
    bankAmount: null,
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: dimension === "PAID" ? paidAmount : balanceAmount,
    reconciliationState: "NOT_APPLICABLE",
    sourceState: title.calculatedStatus,
    companyContext: companyCode ? { companyCode } : null,
    accountContext: null,
    currencyContext: { currency: "BRL", assumed: true },
    sourceReferences: [
      {
        source: "FinanceAccountsPayableGridRow",
        id: String(title.externalId),
        label: title.documentNumber ?? null,
      },
    ],
    warnings,
    availableActions: [
      {
        kind: "RECONCILE",
        enabled: false,
        disabledReason: real
          ? "Conciliação é exposta pelo orquestrador (CS-008), não por este adaptador."
          : "Previsão nunca é conciliável (ADR 001).",
      },
    ],
  };
}

/**
 * Projeta os dias canônicos em linhas do Apoio ao Caixa.
 *
 * Populações disjuntas por construção do motor de origem (documentado em
 * `treasuryCaixaCanonicalDay.ts`): um título nunca aparece em `Due` e
 * `Received`/`Paid` no mesmo dia — preserva a regra de substituição
 * previsão→realizado sem reimplementá-la aqui.
 */
export function adaptTreasuryCaixaCanonicalDaysToCashSupportRows(
  days: readonly TreasuryCaixaCanonicalDay[],
  /**
   * Empresa resolvida pela camada de serviço (ex.: `companyAccounts[0].companyCode`
   * em `treasuryCaixaService.server.ts`) — não existe por título no DTO
   * canônico. `null` quando genuinamente indisponível: gera warning, nunca
   * inventa o valor.
   */
  companyCode: string | null
): CashSupportUnifiedRow[] {
  const rows: CashSupportUnifiedRow[] = [];
  for (const day of days) {
    for (const t of day.receivableDueTitles) {
      rows.push(receivableTitleToRow(t, day.civilDate, "DUE", companyCode));
    }
    for (const t of day.receivableReceivedTitles) {
      rows.push(receivableTitleToRow(t, day.civilDate, "RECEIVED", companyCode));
    }
    for (const t of day.payableDueTitles) {
      rows.push(payableTitleToRow(t, day.civilDate, "DUE", companyCode));
    }
    for (const t of day.payablePaidTitles) {
      rows.push(payableTitleToRow(t, day.civilDate, "PAID", companyCode));
    }
  }
  return rows;
}

/**
 * Totais diários derivados das linhas adaptadas — deve fechar no centavo
 * com `TreasuryCaixaCanonicalDay.receivableDue`/etc. (testado). Não
 * recalcula: apenas soma o que já veio pronto, para provar paridade.
 */
export function sumCashSupportCanonicalRowsByDimension(
  rows: readonly CashSupportUnifiedRow[]
): {
  receivableDue: string;
  receivableReceived: string;
  payableDue: string;
  payablePaid: string;
} {
  let receivableDue = 0;
  let receivableReceived = 0;
  let payableDue = 0;
  let payablePaid = 0;
  for (const row of rows) {
    const id = row.displayId;
    const amount = Number(row.residualAmount);
    if (id.startsWith("receivable:due:")) receivableDue += amount;
    else if (id.startsWith("receivable:received:")) receivableReceived += amount;
    else if (id.startsWith("payable:due:")) payableDue += amount;
    else if (id.startsWith("payable:paid:")) payablePaid += amount;
  }
  return {
    receivableDue: receivableDue.toFixed(2),
    receivableReceived: receivableReceived.toFixed(2),
    payableDue: payableDue.toFixed(2),
    payablePaid: payablePaid.toFixed(2),
  };
}
