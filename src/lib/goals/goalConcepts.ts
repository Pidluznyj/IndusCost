/**
 * Metas (OKR) — Variáveis calculadas ("momento do cliente").
 *
 * Um filtro comum compara UMA COLUNA da linha. Estes conceitos comparam a
 * linha com o HISTÓRICO do dono dela:
 *
 *   "Primeira compra"  → antes deste pedido, o cliente não tinha nenhum
 *                        pedido faturado;
 *   "Reativação"       → tinha pedidos, mas o último foi há mais de 3 meses;
 *   "Recompra"         → tinha pedidos e comprou dentro dos últimos 3 meses.
 *
 * Modelagem: a classificação pertence ao PEDIDO (evento), não ao cadastro do
 * cliente — "cliente novo" é uma propriedade da venda, e é isso que permite
 * responder "quanto vendi para clientes novos no 3º trimestre".
 *
 * Fase 1: catálogo curado (as três definições abaixo). A fase 2 abre o mesmo
 * DSL para o usuário criar as suas variáveis na tela — por isso a definição
 * já nasce como DADO (JSON validável), não como código.
 *
 * Client-safe: sem Prisma, sem I/O.
 */

import type { GoalFilterConnector, GoalFilterOperator } from "./goalMetadata.js";

/** Unidade das expressões temporais relativas. */
export const GOAL_TIME_UNITS = ["DAY", "MONTH", "YEAR"] as const;
export type GoalTimeUnit = (typeof GOAL_TIME_UNITS)[number];

export const GOAL_TIME_UNIT_LABELS: Record<GoalTimeUnit, string> = {
  DAY: "dias",
  MONTH: "meses",
  YEAR: "anos",
};

/**
 * Data ANCORADA, nunca absoluta: uma variável escrita com data fixa
 * envelheceria em silêncio. EVENT_DATE = a data do próprio pedido.
 */
export type GoalTimeExpr = {
  anchor: "EVENT_DATE";
  offset: { amount: number; unit: GoalTimeUnit; direction: "BACK" } | null;
};

/** Agregações do histórico suportadas na fase 1. */
export const GOAL_HISTORY_AGGREGATES = ["COUNT", "MAX_DATE"] as const;
export type GoalHistoryAggregate = (typeof GOAL_HISTORY_AGGREGATES)[number];

/**
 * Agregação sobre o histórico do dono, sempre com a moldura "tudo que
 * aconteceu ANTES desta linha" (a janela da meta não entra aqui — ver
 * goalConceptCompiler).
 */
export type GoalHistoryRef = {
  type: "HISTORY_AGGREGATE";
  aggregate: GoalHistoryAggregate;
};

export type GoalConceptOperand =
  | GoalHistoryRef
  | { type: "NUMBER"; value: string }
  | ({ type: "TIME_EXPR" } & GoalTimeExpr);

export type GoalConceptCondition = {
  left: GoalHistoryRef;
  operator: Extract<GoalFilterOperator, "EQ" | "NEQ" | "GT" | "LT">;
  right: GoalConceptOperand;
  connector: GoalFilterConnector;
};

export type GoalConceptDefinition = {
  key: string;
  label: string;
  /** Frase leiga completa — é o que a UI mostra e o que auditamos. */
  summary: string;
  /** Fase 1: só classificador de evento. ENTITY_STATE chega na fase 2. */
  kind: "EVENT_CLASSIFIER";
  /** Entidade da linha classificada (o evento). */
  subjectEntityKey: string;
  /** Relação curada que define o dono do histórico (PARTITION BY). */
  partitionLinkKey: string;
  /**
   * Quais linhas contam como histórico. Decisão do negócio (13/08/2026):
   * só pedidos FATURADOS — pedido sem nota não conta como compra.
   */
  historyFilters: ReadonlyArray<{
    fieldKey: string;
    operator: GoalFilterOperator;
    value: string | null;
    connector: GoalFilterConnector;
  }>;
  conditions: readonly GoalConceptCondition[];
};

/** Histórico = pedidos faturados (NF-e autorizada de saída). */
const INVOICED_HISTORY = [
  {
    fieldKey: "SALES_INVOICED",
    operator: "EQ" as const,
    value: "INVOICED",
    connector: "AND" as const,
  },
];

/** Janela de "esfriamento" que separa recompra de reativação. */
const DORMANCY: GoalTimeExpr = {
  anchor: "EVENT_DATE",
  offset: { amount: 3, unit: "MONTH", direction: "BACK" },
};

const HISTORY_COUNT: GoalHistoryRef = { type: "HISTORY_AGGREGATE", aggregate: "COUNT" };
const HISTORY_LAST: GoalHistoryRef = { type: "HISTORY_AGGREGATE", aggregate: "MAX_DATE" };

export const GOAL_CONCEPTS: readonly GoalConceptDefinition[] = [
  {
    key: "NEW_CUSTOMER",
    label: "Primeira compra (cliente novo)",
    summary:
      "Pedidos em que, antes deste pedido, o cliente não tinha nenhuma compra faturada.",
    kind: "EVENT_CLASSIFIER",
    subjectEntityKey: "SALES_ORDERS",
    partitionLinkKey: "ORDER_CUSTOMER",
    historyFilters: INVOICED_HISTORY,
    conditions: [
      {
        left: HISTORY_COUNT,
        operator: "EQ",
        right: { type: "NUMBER", value: "0" },
        connector: "AND",
      },
    ],
  },
  {
    key: "REACTIVATION",
    label: "Reativação (voltou a comprar)",
    summary:
      "Pedidos de clientes que já compraram antes, mas cuja última compra faturada foi há mais de 3 meses.",
    kind: "EVENT_CLASSIFIER",
    subjectEntityKey: "SALES_ORDERS",
    partitionLinkKey: "ORDER_CUSTOMER",
    historyFilters: INVOICED_HISTORY,
    conditions: [
      {
        left: HISTORY_COUNT,
        operator: "GT",
        right: { type: "NUMBER", value: "0" },
        connector: "AND",
      },
      {
        left: HISTORY_LAST,
        operator: "LT",
        right: { type: "TIME_EXPR", ...DORMANCY },
        connector: "AND",
      },
    ],
  },
  {
    key: "REPEAT",
    label: "Recompra (já comprava)",
    summary:
      "Pedidos de clientes que já compraram antes e cuja última compra faturada foi nos últimos 3 meses.",
    kind: "EVENT_CLASSIFIER",
    subjectEntityKey: "SALES_ORDERS",
    partitionLinkKey: "ORDER_CUSTOMER",
    historyFilters: INVOICED_HISTORY,
    conditions: [
      {
        left: HISTORY_COUNT,
        operator: "GT",
        right: { type: "NUMBER", value: "0" },
        connector: "AND",
      },
      {
        left: HISTORY_LAST,
        // >= data-limite: o complemento exato de REACTIVATION, para que as
        // três classificações sejam mutuamente exclusivas e cubram tudo.
        operator: "GT",
        right: { type: "TIME_EXPR", ...DORMANCY },
        connector: "AND",
      },
    ],
  },
];

export function findGoalConcept(key: string): GoalConceptDefinition | null {
  return GOAL_CONCEPTS.find((c) => c.key === key) ?? null;
}

/** Conceitos aplicáveis a uma entidade (o wizard só oferece os válidos). */
export function goalConceptsForEntity(entityKey: string): GoalConceptDefinition[] {
  return GOAL_CONCEPTS.filter((c) => c.subjectEntityKey === entityKey);
}
