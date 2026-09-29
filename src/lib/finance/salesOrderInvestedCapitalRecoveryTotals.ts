/**
 * Totais COMPARÁVEIS da Recuperação do Dinheiro Investido — função pura.
 *
 * Os KPIs históricos da tela somam populações diferentes: venda e "falta
 * receber" sobre TODOS os pedidos, capital/recuperado/na rua só sobre pedidos
 * com capital válido. Subtrair um do outro não é margem de nada. Este módulo
 * calcula, sobre a MESMA população (pedidos com capital válido — a definição
 * única de `isValidInvestedCapital`), os totais que fecham entre si centavo a
 * centavo:
 *
 *   comparableSaleValueTotal            = investedCapital(comparável) + economicMarginTotal
 *   actualReceivedComparableTotal       = capitalRecovered(comparável) + realizedGainTotal
 *   outstandingReceivableComparableTotal= capitalReceivableCoveredTotal + gainReceivableTotal
 *   moneyOnStreet(comparável)           = capitalReceivableCoveredTotal + capitalWithoutOpenReceivableTotal
 *   totalOutstandingReceivable (todos)  = outstandingReceivableComparableTotal + outstandingReceivableUnclassifiedTotal
 *
 * Tudo somado em centavos inteiros a partir dos valores JÁ arredondados de
 * cada snapshot (mesmo acumulador da agregação por cliente) — nunca uma conta
 * agregada que possa quebrar por float ou mistura de população. Nada é
 * recalculado aqui: só soma o que o snapshot decidiu.
 */
import { isValidInvestedCapital } from "./salesOrderInvestedCapitalRecoveryMath.js";
import type { SalesOrderInvestedCapitalRecoverySnapshot } from "./salesOrderInvestedCapitalRecoverySnapshot.js";

export type InvestedCapitalRecoveryComparableTotals = {
  /** Pedidos com capital válido (os mesmos de investedCapitalAnalyzedTotal). */
  ordersComparableCount: number;
  /** Venda dos pedidos com capital válido — base comparável de economicMarginTotal. */
  comparableSaleValueTotal: number;
  /** Σ (saleValue − investedCapital) dos pedidos com capital válido; pode ser negativa. */
  economicMarginTotal: number;
  /** Recebido de TODOS os pedidos (inclusive sem capital válido). */
  actualReceivedTotal: number;
  /** Recebido só dos pedidos com capital válido = capitalRecoveredTotal + realizedGainTotal. */
  actualReceivedComparableTotal: number;
  /** Σ MAX(recebido − capital, 0) dos pedidos com capital válido. */
  realizedGainTotal: number;
  /** CR real aberto dos pedidos com capital válido = coberto + ganho a receber. */
  outstandingReceivableComparableTotal: number;
  /** CR real aberto dos pedidos SEM capital válido — não classificável em capital/ganho. */
  outstandingReceivableUnclassifiedTotal: number;
  /** Σ MIN(CR aberto, capital na rua). */
  capitalReceivableCoveredTotal: number;
  /** Σ MAX(CR aberto − capital na rua, 0). */
  gainReceivableTotal: number;
  /** Σ MAX(capital na rua − CR aberto, 0). */
  capitalWithoutOpenReceivableTotal: number;
  /** capital recuperado / capital investido × 100 (população comparável). Null sem capital. */
  capitalRecoveredPercent: number | null;
  /** capital na rua / capital investido × 100 (população comparável). Null sem capital. */
  moneyOnStreetPercent: number | null;
};

function toCents(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

function percent(numeratorCents: number, denominatorCents: number): number | null {
  if (denominatorCents <= 0) return null;
  return Math.round((numeratorCents / denominatorCents) * 10000) / 100;
}

export function buildInvestedCapitalRecoveryComparableTotals(
  rows: readonly SalesOrderInvestedCapitalRecoverySnapshot[]
): InvestedCapitalRecoveryComparableTotals {
  let ordersComparableCount = 0;
  let comparableSaleValue = 0;
  let economicMargin = 0;
  let actualReceived = 0;
  let actualReceivedComparable = 0;
  let realizedGain = 0;
  let outstandingComparable = 0;
  let outstandingUnclassified = 0;
  let capitalReceivableCovered = 0;
  let gainReceivable = 0;
  let capitalWithoutOpenReceivable = 0;
  let investedCapital = 0;
  let capitalRecovered = 0;
  let moneyOnStreet = 0;

  for (const row of rows) {
    actualReceived += toCents(row.actualReceived);
    if (!isValidInvestedCapital(row.investedCapital)) {
      outstandingUnclassified += toCents(row.outstandingReceivable);
      continue;
    }
    ordersComparableCount += 1;
    comparableSaleValue += toCents(row.saleValue);
    economicMargin += toCents(row.economicMargin);
    actualReceivedComparable += toCents(row.actualReceived);
    realizedGain += toCents(row.realizedGain);
    outstandingComparable += toCents(row.outstandingReceivable);
    capitalReceivableCovered += toCents(row.capitalReceivableCovered);
    gainReceivable += toCents(row.gainReceivable);
    capitalWithoutOpenReceivable += toCents(row.capitalWithoutOpenReceivable);
    investedCapital += toCents(row.investedCapital);
    capitalRecovered += toCents(row.capitalRecovered);
    moneyOnStreet += toCents(row.moneyOnStreet);
  }

  return {
    ordersComparableCount,
    comparableSaleValueTotal: fromCents(comparableSaleValue),
    economicMarginTotal: fromCents(economicMargin),
    actualReceivedTotal: fromCents(actualReceived),
    actualReceivedComparableTotal: fromCents(actualReceivedComparable),
    realizedGainTotal: fromCents(realizedGain),
    outstandingReceivableComparableTotal: fromCents(outstandingComparable),
    outstandingReceivableUnclassifiedTotal: fromCents(outstandingUnclassified),
    capitalReceivableCoveredTotal: fromCents(capitalReceivableCovered),
    gainReceivableTotal: fromCents(gainReceivable),
    capitalWithoutOpenReceivableTotal: fromCents(capitalWithoutOpenReceivable),
    capitalRecoveredPercent: percent(capitalRecovered, investedCapital),
    moneyOnStreetPercent: percent(moneyOnStreet, investedCapital),
  };
}
