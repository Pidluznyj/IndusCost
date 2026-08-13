/**
 * Metas (OKR) — Dicionário de Metadados (a camada de governança).
 *
 * O usuário NUNCA vê banco de dados: ele escolhe frases em português
 * ("Valor total vendido em Pedidos de Venda"). Cada opção aqui é uma CHAVE
 * curada que o backend traduz para SQL parametrizado (goalRuleEngine).
 * O front-end monta os dropdowns a partir deste arquivo; se uma tabela do
 * Nomus mudar, altera-se só aqui e as regras salvas continuam válidas.
 *
 * Segurança: o ruleJson persiste APENAS chaves deste dicionário — nomes
 * reais de tabela/coluna nunca saem do backend nem entram do front-end.
 * Client-safe: sem Prisma, sem I/O.
 */

import type { GoalDomainValue } from "./goalContracts.js";

export const GOAL_METRIC_OPERATIONS = ["SUM", "COUNT", "AVG"] as const;
export type GoalMetricOperation = (typeof GOAL_METRIC_OPERATIONS)[number];

export const GOAL_METRIC_OPERATION_LABELS: Record<GoalMetricOperation, string> = {
  SUM: "Soma",
  COUNT: "Contagem",
  AVG: "Média",
};

export const GOAL_FILTER_OPERATORS = [
  "EQ",
  "NEQ",
  "GT",
  "LT",
  "CONTAINS",
  "IS_EMPTY",
] as const;
export type GoalFilterOperator = (typeof GOAL_FILTER_OPERATORS)[number];

export const GOAL_FILTER_OPERATOR_LABELS: Record<GoalFilterOperator, string> = {
  EQ: "for igual a",
  NEQ: "for diferente de",
  GT: "for maior que",
  LT: "for menor que",
  CONTAINS: "contiver",
  IS_EMPTY: "estiver vazio",
};

export const GOAL_FILTER_CONNECTORS = ["AND", "OR"] as const;
export type GoalFilterConnector = (typeof GOAL_FILTER_CONNECTORS)[number];

export const GOAL_FILTER_CONNECTOR_LABELS: Record<GoalFilterConnector, string> = {
  AND: "e também quando",
  OR: "ou então quando",
};

/** Tipo do campo filtrado — decide o input renderizado (RN-004). */
export type GoalFilterFieldType = "ENUM" | "TEXT" | "NUMBER";

export type GoalMetadataField = {
  /** Chave estável persistida no ruleJson. */
  key: string;
  /** Rótulo leigo exibido na frase. */
  label: string;
  type: GoalFilterFieldType;
  /** Nome REAL da coluna — só o backend usa; nunca exposto na API de metadados. */
  dbColumn: string;
  /**
   * Opções fixas. Em ENUM são o vocabulário FECHADO (validado no motor).
   * Em TEXT viram SUGESTÕES no wizard (datalist) — o usuário ainda pode
   * digitar livre, e CONTAINS segue tolerante a variações de grafia.
   */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Operadores permitidos para o tipo. */
  operators: readonly GoalFilterOperator[];
};

export type GoalMetadataMetric = {
  key: string;
  label: string;
  operation: GoalMetricOperation;
  /** Coluna agregada (null para COUNT de linhas). */
  dbColumn: string | null;
  /** Sugestão de unidade para o Passo 3 do wizard. */
  suggestedUnit: string | null;
  /**
   * Coluna de DATA usada para recortar o período do Objetivo (sempre
   * aplicada pelo motor — a meta só conta o que aconteceu na janela).
   */
  periodDbColumn: string;
  periodLabel: string;
};

export type GoalMetadataEntity = {
  key: string;
  label: string;
  domain: GoalDomainValue;
  /** Nome REAL da tabela (aspas do Postgres aplicadas pelo motor). */
  dbTable: string;
  metrics: readonly GoalMetadataMetric[];
  filterFields: readonly GoalMetadataField[];
  /**
   * Coluna que identifica a PESSOA da linha (desdobramento por colaborador —
   * RN-006). null = entidade sem recorte individual automático.
   */
  employeeDbColumn: string | null;
};

const ENUM_OPERATORS = ["EQ", "NEQ"] as const;
const TEXT_OPERATORS = ["EQ", "NEQ", "CONTAINS", "IS_EMPTY"] as const;

/** Catálogo curado — mantido pelo backend (nunca gerado do schema cru). */
export const GOAL_METADATA_ENTITIES: readonly GoalMetadataEntity[] = [
  {
    key: "SALES_ORDERS",
    label: "Pedidos de Venda",
    domain: "COMERCIAL",
    dbTable: "SalesOrder",
    employeeDbColumn: "externalSellerId",
    metrics: [
      {
        key: "SALES_NET_TOTAL",
        label: "Valor total vendido (líquido)",
        operation: "SUM",
        dbColumn: "totalNetValue",
        suggestedUnit: "R$",
        periodDbColumn: "issueDate",
        periodLabel: "data de emissão do pedido",
      },
      {
        key: "SALES_GROSS_TOTAL",
        label: "Valor bruto vendido",
        operation: "SUM",
        dbColumn: "totalGrossValue",
        suggestedUnit: "R$",
        periodDbColumn: "issueDate",
        periodLabel: "data de emissão do pedido",
      },
      {
        key: "SALES_ORDER_COUNT",
        label: "Quantidade de pedidos",
        operation: "COUNT",
        dbColumn: null,
        suggestedUnit: "pedidos",
        periodDbColumn: "issueDate",
        periodLabel: "data de emissão do pedido",
      },
      {
        key: "SALES_AVG_TICKET",
        label: "Valor médio por pedido",
        operation: "AVG",
        dbColumn: "totalNetValue",
        suggestedUnit: "R$",
        periodDbColumn: "issueDate",
        periodLabel: "data de emissão do pedido",
      },
      {
        key: "SALES_DISCOUNT_TOTAL",
        label: "Descontos concedidos",
        operation: "SUM",
        dbColumn: "totalDiscount",
        suggestedUnit: "R$",
        periodDbColumn: "issueDate",
        periodLabel: "data de emissão do pedido",
      },
      {
        key: "SALES_ITEMS_TOTAL",
        label: "Itens vendidos (linhas de pedido)",
        operation: "SUM",
        dbColumn: "totalItems",
        suggestedUnit: "itens",
        periodDbColumn: "issueDate",
        periodLabel: "data de emissão do pedido",
      },
    ],
    filterFields: [
      {
        key: "SALES_STATUS",
        label: "situação do pedido",
        type: "ENUM",
        dbColumn: "status",
        operators: ENUM_OPERATORS,
        options: [
          { value: "SENT_TO_NOMUS", label: "Enviado (oficial)" },
          { value: "READY_TO_SEND", label: "Pronto para envio" },
          { value: "DRAFT", label: "Rascunho" },
          { value: "CANCELLED", label: "Cancelado" },
          { value: "ERROR", label: "Com erro" },
        ],
      },
      {
        key: "SALES_COMPANY",
        label: "empresa emissora",
        type: "TEXT",
        dbColumn: "companyIssuer",
        operators: TEXT_OPERATORS,
        // Sugestões (datalist) — digitação livre continua valendo; CONTAINS
        // tolera variações de grafia entre pedidos antigos.
        options: [
          { value: "Lazarios", label: "Lazarios" },
          { value: "Koppetel", label: "Koppetel" },
          { value: "SM", label: "SM" },
        ],
      },
      {
        key: "SALES_RESPONSIBLE",
        label: "vendedor (nome)",
        type: "TEXT",
        dbColumn: "responsible",
        operators: TEXT_OPERATORS,
      },
    ],
  },
  {
    key: "PROPOSALS",
    label: "Propostas Comerciais",
    domain: "COMERCIAL",
    dbTable: "Proposal",
    employeeDbColumn: "externalSellerId",
    metrics: [
      {
        key: "PROPOSAL_COUNT",
        label: "Quantidade de propostas",
        operation: "COUNT",
        dbColumn: null,
        suggestedUnit: "propostas",
        periodDbColumn: "commercialDate",
        periodLabel: "data comercial",
      },
      {
        key: "PROPOSAL_NET_TOTAL",
        label: "Valor das propostas (líquido)",
        operation: "SUM",
        dbColumn: "totalNetValue",
        suggestedUnit: "R$",
        periodDbColumn: "commercialDate",
        periodLabel: "data comercial",
      },
    ],
    filterFields: [
      {
        key: "PROPOSAL_STATUS",
        label: "situação da proposta",
        type: "ENUM",
        dbColumn: "status",
        operators: ENUM_OPERATORS,
        options: [
          { value: "APPROVED", label: "Aprovada" },
          { value: "SENT", label: "Enviada" },
          { value: "ANALYSIS", label: "Em análise" },
          { value: "DRAFT", label: "Rascunho" },
          { value: "REJECTED", label: "Rejeitada" },
          { value: "EXPIRED", label: "Expirada" },
          { value: "CANCELED", label: "Cancelada" },
        ],
      },
      {
        key: "PROPOSAL_COMPANY",
        label: "empresa emissora",
        type: "TEXT",
        dbColumn: "companyIssuer",
        operators: TEXT_OPERATORS,
      },
    ],
  },
  {
    key: "CUSTOMERS",
    label: "Clientes",
    domain: "COMERCIAL",
    dbTable: "Customer",
    employeeDbColumn: null,
    metrics: [
      {
        key: "NEW_CUSTOMER_COUNT",
        label: "Novos clientes cadastrados",
        operation: "COUNT",
        dbColumn: null,
        suggestedUnit: "clientes",
        periodDbColumn: "createdAt",
        periodLabel: "data de cadastro",
      },
    ],
    filterFields: [
      {
        key: "CUSTOMER_STATE",
        label: "estado (UF)",
        type: "TEXT",
        dbColumn: "state",
        operators: TEXT_OPERATORS,
      },
      {
        key: "CUSTOMER_CITY",
        label: "cidade",
        type: "TEXT",
        dbColumn: "city",
        operators: TEXT_OPERATORS,
      },
      {
        key: "CUSTOMER_SEGMENT",
        label: "segmento",
        type: "TEXT",
        dbColumn: "segment",
        operators: TEXT_OPERATORS,
      },
    ],
  },
  {
    key: "RECEIVABLES",
    label: "Recebimentos (Contas a Receber)",
    domain: "FINANCEIRO",
    dbTable: "NomusAccountsReceivable",
    employeeDbColumn: null,
    metrics: [
      {
        key: "AR_RECEIVED_TOTAL",
        label: "Valor efetivamente recebido",
        operation: "SUM",
        dbColumn: "amountReceived",
        suggestedUnit: "R$",
        periodDbColumn: "settlementDate",
        periodLabel: "data da baixa",
      },
      {
        key: "AR_OPEN_BALANCE",
        label: "Valor em aberto (a receber)",
        operation: "SUM",
        dbColumn: "balanceReceivable",
        suggestedUnit: "R$",
        periodDbColumn: "dueDate",
        periodLabel: "vencimento",
      },
      {
        key: "AR_TITLE_COUNT",
        label: "Quantidade de títulos a receber",
        operation: "COUNT",
        dbColumn: null,
        suggestedUnit: "títulos",
        periodDbColumn: "dueDate",
        periodLabel: "vencimento",
      },
    ],
    filterFields: [
      {
        key: "AR_COMPANY",
        label: "empresa",
        type: "TEXT",
        dbColumn: "companyName",
        operators: TEXT_OPERATORS,
      },
      {
        key: "AR_PERSON",
        label: "cliente (nome)",
        type: "TEXT",
        dbColumn: "personName",
        operators: TEXT_OPERATORS,
      },
    ],
  },
  {
    key: "PAYABLES",
    label: "Pagamentos (Contas a Pagar)",
    domain: "FINANCEIRO",
    dbTable: "NomusAccountsPayable",
    employeeDbColumn: null,
    metrics: [
      {
        key: "AP_PAID_TOTAL",
        label: "Valor efetivamente pago",
        operation: "SUM",
        dbColumn: "amountPaid",
        suggestedUnit: "R$",
        periodDbColumn: "settlementDate",
        periodLabel: "data do pagamento",
      },
      {
        key: "AP_OPEN_BALANCE",
        label: "Valor em aberto (a pagar)",
        operation: "SUM",
        dbColumn: "amountPayable",
        suggestedUnit: "R$",
        periodDbColumn: "dueDate",
        periodLabel: "vencimento",
      },
      {
        key: "AP_TITLE_COUNT",
        label: "Quantidade de títulos a pagar",
        operation: "COUNT",
        dbColumn: null,
        suggestedUnit: "títulos",
        periodDbColumn: "dueDate",
        periodLabel: "vencimento",
      },
    ],
    filterFields: [
      {
        key: "AP_COMPANY",
        label: "empresa",
        type: "TEXT",
        dbColumn: "companyName",
        operators: TEXT_OPERATORS,
      },
      {
        key: "AP_PERSON",
        label: "fornecedor (nome)",
        type: "TEXT",
        dbColumn: "personName",
        operators: TEXT_OPERATORS,
      },
    ],
  },
  {
    key: "INVENTORY_MOVEMENTS",
    label: "Movimentações de Estoque",
    domain: "SUPRIMENTOS",
    dbTable: "InventoryMovement",
    employeeDbColumn: null,
    metrics: [
      {
        key: "INV_QUANTITY_TOTAL",
        label: "Quantidade movimentada",
        operation: "SUM",
        dbColumn: "quantity",
        suggestedUnit: "un",
        periodDbColumn: "movementDate",
        periodLabel: "data da movimentação",
      },
      {
        key: "INV_MOVEMENT_COUNT",
        label: "Número de movimentações",
        operation: "COUNT",
        dbColumn: null,
        suggestedUnit: "movimentações",
        periodDbColumn: "movementDate",
        periodLabel: "data da movimentação",
      },
    ],
    filterFields: [
      {
        key: "INV_MOVEMENT_TYPE",
        label: "tipo de movimentação",
        type: "ENUM",
        dbColumn: "movementType",
        operators: ENUM_OPERATORS,
        options: [
          { value: "PURCHASE_RECEIPT", label: "Recebimento de compra" },
          { value: "PURCHASE_ENTRY", label: "Entrada por compra" },
          { value: "PRODUCTION_ENTRY", label: "Entrada de produção" },
          { value: "PRODUCTION_EXIT", label: "Saída para produção" },
          { value: "REQUISITION_EXIT", label: "Saída por requisição" },
          { value: "MANUAL_ENTRY", label: "Entrada manual" },
          { value: "MANUAL_EXIT", label: "Saída manual" },
          { value: "TRANSFER", label: "Transferência" },
          { value: "POSITIVE_ADJUSTMENT", label: "Ajuste para mais" },
          { value: "NEGATIVE_ADJUSTMENT", label: "Ajuste para menos" },
          { value: "LOSS", label: "Perda" },
        ],
      },
      {
        key: "INV_MATERIAL",
        label: "matéria-prima (descrição)",
        type: "TEXT",
        dbColumn: "materialDescriptionSnapshot",
        operators: TEXT_OPERATORS,
      },
      {
        key: "INV_REASON",
        label: "motivo",
        type: "TEXT",
        dbColumn: "reason",
        operators: TEXT_OPERATORS,
      },
    ],
  },
];

export function findGoalMetadataEntity(entityKey: string): GoalMetadataEntity | null {
  return GOAL_METADATA_ENTITIES.find((e) => e.key === entityKey) ?? null;
}

export function findGoalMetadataMetric(
  entity: GoalMetadataEntity,
  metricKey: string
): GoalMetadataMetric | null {
  return entity.metrics.find((m) => m.key === metricKey) ?? null;
}

export function findGoalMetadataField(
  entity: GoalMetadataEntity,
  fieldKey: string
): GoalMetadataField | null {
  return entity.filterFields.find((f) => f.key === fieldKey) ?? null;
}

/**
 * Projeção CLIENT-SAFE dos metadados para a API/wizard: labels, chaves,
 * tipos e opções — NUNCA os nomes reais de tabela/coluna.
 */
export function buildGoalMetadataPublicView() {
  return GOAL_METADATA_ENTITIES.map((entity) => ({
    key: entity.key,
    label: entity.label,
    domain: entity.domain,
    supportsQuotaSplit: entity.employeeDbColumn != null,
    metrics: entity.metrics.map((m) => ({
      key: m.key,
      label: m.label,
      operation: m.operation,
      operationLabel: GOAL_METRIC_OPERATION_LABELS[m.operation],
      suggestedUnit: m.suggestedUnit,
      periodLabel: m.periodLabel,
    })),
    filterFields: entity.filterFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      operators: f.operators.map((op) => ({
        value: op,
        label: GOAL_FILTER_OPERATOR_LABELS[op],
      })),
      options: f.options ?? null,
    })),
  }));
}
