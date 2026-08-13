/**
 * Metas (OKR) — receitas prontas do assistente ("comece por aqui").
 *
 * Cada receita preenche a frase de medição inteira com UM clique (área +
 * medição + filtros típicos + direção sugerida). O usuário ajusta depois se
 * quiser — a frase continua editável. As chaves referenciam o dicionário
 * (goalMetadata) e são validadas por teste: receita quebrada não compila o
 * deploy.
 *
 * Client-safe: sem Prisma, sem I/O.
 */

import type { GoalTrackingTypeValue } from "./goalContracts.js";
import type { GoalFilterConnector, GoalFilterOperator } from "./goalMetadata.js";

export type GoalRecipeFilter = {
  fieldKey: string;
  operator: GoalFilterOperator;
  value: string | null;
  connector: GoalFilterConnector;
};

export type GoalRecipe = {
  key: string;
  /** Emoji do card (visual, sem lib de ícones). */
  emoji: string;
  title: string;
  /** Frase curta de leigo explicando o que a receita mede. */
  description: string;
  entityKey: string;
  metricKey: string;
  filters: GoalRecipeFilter[];
  /** Direção sugerida no passo do alvo. */
  suggestedTrackingType: GoalTrackingTypeValue;
};

export const GOAL_RECIPES: readonly GoalRecipe[] = [
  {
    key: "REVENUE_SALES_ORDERS",
    emoji: "💰",
    title: "Faturamento (Pedidos de Venda)",
    description: "Soma do valor líquido dos pedidos oficiais no período.",
    entityKey: "SALES_ORDERS",
    metricKey: "SALES_NET_TOTAL",
    filters: [
      { fieldKey: "SALES_STATUS", operator: "EQ", value: "SENT_TO_NOMUS", connector: "AND" },
    ],
    suggestedTrackingType: "INCREASE",
  },
  {
    key: "RECEIVED_TOTAL",
    emoji: "📈",
    title: "Valor recebido no período",
    description: "Quanto efetivamente entrou no caixa (baixas do contas a receber).",
    entityKey: "RECEIVABLES",
    metricKey: "AR_RECEIVED_TOTAL",
    filters: [],
    suggestedTrackingType: "INCREASE",
  },
  {
    key: "NEW_CUSTOMERS",
    emoji: "👥",
    title: "Novos clientes",
    description: "Quantos clientes novos foram cadastrados no período.",
    entityKey: "CUSTOMERS",
    metricKey: "NEW_CUSTOMER_COUNT",
    filters: [],
    suggestedTrackingType: "INCREASE",
  },
  {
    key: "APPROVED_PROPOSALS",
    emoji: "📋",
    title: "Propostas aprovadas",
    description: "Quantidade de propostas que o cliente aprovou no período.",
    entityKey: "PROPOSALS",
    metricKey: "PROPOSAL_COUNT",
    filters: [
      { fieldKey: "PROPOSAL_STATUS", operator: "EQ", value: "APPROVED", connector: "AND" },
    ],
    suggestedTrackingType: "INCREASE",
  },
  {
    key: "REDUCE_OPEN_PAYABLES",
    emoji: "🧾",
    title: "Reduzir contas a pagar em aberto",
    description: "Valor a pagar ainda em aberto — quanto menor, melhor.",
    entityKey: "PAYABLES",
    metricKey: "AP_OPEN_BALANCE",
    filters: [],
    suggestedTrackingType: "DECREASE",
  },
  {
    key: "REDUCE_DISCOUNTS",
    emoji: "✂️",
    title: "Reduzir descontos concedidos",
    description: "Soma dos descontos dados nos pedidos — quanto menor, melhor.",
    entityKey: "SALES_ORDERS",
    metricKey: "SALES_DISCOUNT_TOTAL",
    filters: [
      { fieldKey: "SALES_STATUS", operator: "EQ", value: "SENT_TO_NOMUS", connector: "AND" },
    ],
    suggestedTrackingType: "DECREASE",
  },
  {
    key: "REDUCE_INVENTORY_LOSS",
    emoji: "📦",
    title: "Reduzir perdas de estoque",
    description: "Quantidade registrada como perda nas movimentações de estoque.",
    entityKey: "INVENTORY_MOVEMENTS",
    metricKey: "INV_QUANTITY_TOTAL",
    filters: [
      { fieldKey: "INV_MOVEMENT_TYPE", operator: "EQ", value: "LOSS", connector: "AND" },
    ],
    suggestedTrackingType: "DECREASE",
  },
];

export function findGoalRecipe(key: string): GoalRecipe | null {
  return GOAL_RECIPES.find((r) => r.key === key) ?? null;
}
