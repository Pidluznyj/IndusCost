/**
 * Contrato do drill-down por linha do DRE Gerencial.
 * Totais do detalhe devem reconciliar com a linha do DRE (mesmos motores).
 */

import type { FinanceDreCompany, FinanceDreLineId } from "@/src/lib/financeDreTypes.js";

export type FinanceDreDrilldownScope = "highlight" | "ytd";

export type FinanceDreDrilldownKind = "nfe" | "cmv" | "cost_center" | "composition";

export type FinanceDreDrilldownColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type FinanceDreDrilldownRow = {
  id: string;
  /** Pedido de venda (quando houver vínculo NF-e). */
  orderCode: string | null;
  customerName: string | null;
  nfeNumber: string | null;
  nfeSerie: string | null;
  /** Documento AP / CC / composição. */
  documentLabel: string | null;
  amount: number;
  competenceDate: string | null;
  /** Para composição: linha filha navegável. */
  childLineId?: FinanceDreLineId;
  extra?: string | null;
};

export type FinanceDreDrilldownPayload = {
  schemaVersion: 1;
  lineId: FinanceDreLineId;
  lineLabel: string;
  kind: FinanceDreDrilldownKind;
  scope: FinanceDreDrilldownScope;
  year: number;
  highlightMonth: number;
  company: FinanceDreCompany;
  companyLabel: string;
  periodLabel: string;
  /** Total da linha no DRE (valor absoluto da fonte, sinal gerencial à parte). */
  expectedTotal: number;
  /** Soma das linhas de detalhe (universo completo, mesmo se truncado na UI). */
  rowsTotal: number;
  totalsMatch: boolean;
  rowCount: number;
  truncated: boolean;
  columns: FinanceDreDrilldownColumn[];
  rows: FinanceDreDrilldownRow[];
  sourceNote: string;
  disclaimer: string;
};
