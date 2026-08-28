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
  /** Medição OFICIAL (provider canônico) — exibida antes das personalizadas. */
  official?: boolean;
};

export const GOAL_RECIPES: readonly GoalRecipe[] = [
  // ─── MEDIÇÕES OFICIAIS primeiro (providers canônicos — P2) ────────────────
  // Faturamento passa OBRIGATORIAMENTE pelo provider NF-e (motor oficial do
  // Financeiro); Pedidos de Venda seguem a população oficial do Comercial.
  // Faturamento ≠ Pedido: um pedido de 100k com NF-e parcial de 20k vale
  // 100k em Pedidos e 20k em Faturamento — cada número com o seu dono.
  {
    key: "FISCAL_BILLING_TOTAL",
    emoji: "🧾",
    title: "Faturamento (Notas Fiscais)",
    description:
      "Valor líquido das NF-e de venda autorizadas — a MESMA regra da tela Financeiro > Faturamento.",
    entityKey: "FISCAL_BILLING",
    metricKey: "NFE_NET_TOTAL",
    filters: [],
    suggestedTrackingType: "INCREASE",
    official: true,
  },
  {
    key: "OFFICIAL_SALES_ORDERS",
    emoji: "💰",
    title: "Pedidos de Venda (regra oficial)",
    description:
      "Valor líquido dos pedidos pela MESMA regra da listagem do Comercial (sem cancelados e sem empresas do grupo). Valor de pedido, não de nota.",
    entityKey: "SALES_OFFICIAL",
    metricKey: "SALES_OFFICIAL_NET_TOTAL",
    filters: [],
    suggestedTrackingType: "INCREASE",
    official: true,
  },
  // ─── MEDIÇÕES PERSONALIZADAS (motor curado) ───────────────────────────────
  // Semântica defensiva: receitas que somam VALOR DE PEDIDO (SalesOrder)
  // nunca se chamam "faturamento" — faturamento é NF-e (receita oficial
  // acima). As antigas "Valor de Pedidos de Venda" e "Pedidos já com nota
  // fiscal" foram REMOVIDAS por ambiguidade com as medições oficiais.
  {
    key: "REVENUE_NEW_CUSTOMERS",
    emoji: "🌱",
    title: "Pedidos de clientes novos",
    description:
      "Soma o VALOR DO PEDIDO da primeira compra de cada cliente — conta só pedidos que já têm nota fiscal vinculada.",
    entityKey: "SALES_ORDERS",
    metricKey: "SALES_NET_TOTAL",
    filters: [
      {
        fieldKey: "SALES_CUSTOMER_MOMENT",
        operator: "EQ",
        value: "NEW_CUSTOMER",
        connector: "AND",
      },
      // Mede só o que virou nota — o "novo cliente" olha o passado dele;
      // este filtro diz o que entra na conta agora (editável na frase).
      { fieldKey: "SALES_INVOICED", operator: "EQ", value: "INVOICED", connector: "AND" },
    ],
    suggestedTrackingType: "INCREASE",
  },
  {
    key: "REACTIVATED_CUSTOMERS",
    emoji: "🔁",
    title: "Clientes reativados",
    description:
      "Quantos pedidos vieram de clientes parados há mais de 3 meses.",
    entityKey: "SALES_ORDERS",
    metricKey: "SALES_ORDER_COUNT",
    filters: [
      {
        fieldKey: "SALES_CUSTOMER_MOMENT",
        operator: "EQ",
        value: "REACTIVATION",
        connector: "AND",
      },
      { fieldKey: "SALES_INVOICED", operator: "EQ", value: "INVOICED", connector: "AND" },
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
