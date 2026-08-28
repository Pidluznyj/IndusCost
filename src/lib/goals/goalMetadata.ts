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

/**
 * Predicados CURADOS que não são "coluna comparada com valor".
 *
 * Existem porque conceitos de negócio reais não moram numa coluna só:
 *  - INVOICED_ORDER: "pedido faturado" mora em SalesOrderNfeLink (NF-e
 *    autorizada de saída) — mesma definição oficial do módulo de Comissões;
 *  - CUSTOMER_MOMENT: "situação do cliente neste pedido" (primeira compra,
 *    reativação, recompra) exige olhar o HISTÓRICO do cliente antes da linha
 *    — resolvido por window function no compilador de conceitos.
 *
 * O usuário nunca escolhe um predicado: ele escolhe uma frase; a chave do
 * predicado é que decide qual SQL o motor monta.
 */
export const GOAL_FIELD_PREDICATES = ["INVOICED_ORDER", "CUSTOMER_MOMENT"] as const;
export type GoalFieldPredicate = (typeof GOAL_FIELD_PREDICATES)[number];

export type GoalMetadataField = {
  /** Chave estável persistida no ruleJson. */
  key: string;
  /** Rótulo leigo exibido na frase. */
  label: string;
  type: GoalFilterFieldType;
  /** Nome REAL da coluna — só o backend usa; nunca exposto na API de metadados. */
  dbColumn: string;
  /**
   * Quando presente, o filtro NÃO é uma comparação de coluna: o motor delega
   * a montagem do SQL ao predicado curado (dbColumn fica vazio).
   */
  predicate?: GoalFieldPredicate;
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
  /**
   * MÉTRICA OFICIAL (P2): quando presente, o motor NÃO monta SQL próprio —
   * delega a execução ao GoalMetricProvider canônico (que reutiliza o motor
   * oficial do domínio dono do número). Métricas oficiais não aceitam
   * filtros personalizados: a regra é a do domínio, fechada.
   */
  providerKey?: string;
  /** Fonte oficial em texto leigo ("Financeiro > Faturamento (NF-e)"). */
  sourceLabel?: string;
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
  // ─── MEDIÇÕES OFICIAIS (providers canônicos — P2) ─────────────────────────
  // Não têm filtros: a regra é a do domínio dono do número, fechada. O motor
  // delega a execução ao provider (que chama a função oficial do módulo).
  {
    key: "FISCAL_BILLING",
    label: "Faturamento (Notas Fiscais)",
    domain: "FINANCEIRO",
    // Informativo — o provider é quem executa (nunca SQL próprio do Goals).
    dbTable: "NomusNfe",
    employeeDbColumn: null,
    metrics: [
      {
        key: "NFE_NET_TOTAL",
        label: "Valor líquido faturado (NF-e autorizadas)",
        operation: "SUM",
        dbColumn: null,
        suggestedUnit: "R$",
        periodDbColumn: "xmlDhEmi",
        periodLabel: "data de emissão da NF-e",
        providerKey: "NFE_FISCAL_BILLING",
        sourceLabel: "Financeiro > Faturamento (NF-e)",
      },
    ],
    filterFields: [],
  },
  {
    key: "SALES_OFFICIAL",
    label: "Pedidos de Venda (regra oficial)",
    domain: "COMERCIAL",
    dbTable: "SalesOrder",
    employeeDbColumn: null,
    metrics: [
      {
        key: "SALES_OFFICIAL_NET_TOTAL",
        label: "Valor líquido de pedidos (população oficial do Comercial)",
        operation: "SUM",
        dbColumn: null,
        suggestedUnit: "R$",
        periodDbColumn: "issueDate",
        periodLabel: "data de emissão do pedido",
        providerKey: "SALES_ORDERS_OFFICIAL",
        sourceLabel: "Comercial > Pedidos de Venda",
      },
    ],
    filterFields: [],
  },
  // ─── MEDIÇÕES PERSONALIZADAS (motor curado) ───────────────────────────────
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
      {
        // "Faturado" não é status do pedido: é ter NF-e autorizada de saída.
        // Mesma definição oficial do módulo de Comissões (uma verdade só).
        key: "SALES_INVOICED",
        label: "faturamento do pedido",
        type: "ENUM",
        dbColumn: "",
        predicate: "INVOICED_ORDER",
        operators: ENUM_OPERATORS,
        options: [
          { value: "INVOICED", label: "Já faturado (com nota fiscal)" },
          { value: "NOT_INVOICED", label: "Ainda não faturado" },
        ],
      },
      {
        // Variável calculada: depende do HISTÓRICO do cliente antes deste
        // pedido (window function no compilador de conceitos).
        key: "SALES_CUSTOMER_MOMENT",
        label: "situação do cliente neste pedido",
        type: "ENUM",
        dbColumn: "",
        predicate: "CUSTOMER_MOMENT",
        operators: ENUM_OPERATORS,
        options: [
          { value: "NEW_CUSTOMER", label: "Primeira compra (cliente novo)" },
          { value: "REACTIVATION", label: "Reativação (voltou a comprar)" },
          { value: "REPEAT", label: "Recompra (já comprava)" },
        ],
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

/**
 * Relações CURADAS entre entidades — a dependência "olhar o Cliente, mas
 * contar os Pedidos" nunca pode vir do input do usuário (viraria identificador
 * SQL). Aqui ela é whitelist, como tabela e coluna.
 */
export type GoalMetadataLink = {
  key: string;
  /** Frase leiga ("os pedidos deste cliente"). */
  label: string;
  /** Lado "um" (Cliente) e lado "muitos" (Pedido). */
  ownerEntityKey: string;
  eventEntityKey: string;
  /** Coluna do evento que aponta para o dono — usada no PARTITION BY. */
  eventOwnerDbColumn: string;
  /** Coluna do dono referenciada (para o caminho ENTITY_STATE, fase 2). */
  ownerDbColumn: string;
  /** Eixo temporal do histórico (data de negócio do evento). */
  eventPeriodDbColumn: string;
};

export const GOAL_METADATA_LINKS: readonly GoalMetadataLink[] = [
  {
    key: "ORDER_CUSTOMER",
    label: "os pedidos deste cliente",
    ownerEntityKey: "CUSTOMERS",
    eventEntityKey: "SALES_ORDERS",
    eventOwnerDbColumn: "customerId",
    ownerDbColumn: "id",
    eventPeriodDbColumn: "issueDate",
  },
];

export function findGoalMetadataLink(linkKey: string): GoalMetadataLink | null {
  return GOAL_METADATA_LINKS.find((l) => l.key === linkKey) ?? null;
}

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
      // Métrica oficial: a UI mostra "Fonte: …" (nunca tabela/coluna/SQL).
      isOfficial: m.providerKey != null,
      sourceLabel: m.sourceLabel ?? null,
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
