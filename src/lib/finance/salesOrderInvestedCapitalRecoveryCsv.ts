/**
 * Exportação CSV do detalhamento por pedido da Recuperação do Dinheiro
 * Investido — função pura, sem DOM. Só transcreve os campos do DTO (nenhum
 * valor é calculado aqui); números em pt-BR com 2 casas, separador ";",
 * BOM UTF-8 para o Excel abrir com acentos.
 */
import type { InvestedCapitalRecoveryRow } from "../../components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes.js";

export const INVESTED_CAPITAL_RECOVERY_CSV_FILENAME = "recuperacao-dinheiro-investido.csv";

const STATUS_LABELS: Record<InvestedCapitalRecoveryRow["status"], string> = {
  SEM_RECUPERACAO: "Sem recuperação",
  EM_RECUPERACAO: "Em recuperação",
  CAPITAL_RECUPERADO: "Capital recuperado",
  DADOS_INSUFICIENTES: "Dados insuficientes",
};

const COLUMNS: Array<[string, (row: InvestedCapitalRecoveryRow) => string]> = [
  ["PV", (row) => row.orderCode],
  ["Cliente", (row) => row.customerName ?? ""],
  ["Vendido", (row) => num(row.saleValue)],
  ["Capital investido", (row) => num(row.investedCapital)],
  ["Custo industrial", (row) => num(row.industrialCost)],
  ["Imposto", (row) => num(row.totalTaxes)],
  ["Margem econômica", (row) => num(row.economicMargin)],
  ["Recebido", (row) => num(row.actualReceived)],
  ["Capital recuperado", (row) => num(row.capitalRecovered)],
  ["Ganho realizado", (row) => num(row.realizedGain ?? null)],
  ["Capital na rua", (row) => num(row.moneyOnStreet)],
  ["Falta receber", (row) => num(row.outstandingReceivable)],
  ["Capital a recuperar", (row) => num(row.capitalReceivableCovered)],
  ["Ganho a receber", (row) => num(row.gainReceivable)],
  ["Capital sem CR", (row) => num(row.capitalWithoutOpenReceivable)],
  ["% recuperado", (row) => num(row.recoveryPercent)],
  ["Status", (row) => STATUS_LABELS[row.status] ?? row.status],
  ["Recuperado em", (row) => row.capitalRecoveryDate ?? ""],
  ["Previsão de recuperação", (row) => row.forecastCapitalRecoveryDate ?? ""],
];

function num(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildInvestedCapitalRecoveryCsv(rows: readonly InvestedCapitalRecoveryRow[]): string {
  const header = COLUMNS.map(([label]) => cell(label)).join(";");
  const lines = rows.map((row) => COLUMNS.map(([, pick]) => cell(pick(row))).join(";"));
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
}
