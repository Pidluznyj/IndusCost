/**
 * Tipos compartilhados (server + frontend) para o fluxo de reclassificação
 * de itens entre PRODUTO, COMPONENTE e MATERIAL no IndusCost.
 *
 * Fase: INDUSCOST-ITEM-RECLASSIFICATION-WORKFLOW-A.
 *
 * Este arquivo NÃO importa Prisma. Pode ser consumido pelo bundle do Vite.
 */

/** Kind operacional usado no IndusCost: PRODUCT e COMPONENT moram em Product; MATERIAL em Material. */
export type ItemReclassificationKind = "PRODUCT" | "COMPONENT" | "MATERIAL";

/**
 * Snapshot de dependências reais usado para decidir se a reclassificação
 * é segura, exige confirmação ou deve ser bloqueada.
 *
 * Os contadores devem refletir o estado atual do banco (read-only).
 */
export type ItemReclassificationSourceSnapshot = {
  /** Kind atual: PRODUCT/COMPONENT mora em Product; MATERIAL mora em Material. */
  kind: ItemReclassificationKind;
  /** Identidade no IndusCost. Para PRODUCT/COMPONENT é Product.id; para MATERIAL é Material.id. */
  id: string;
  /** sku (Product) OU code (Material). */
  sku: string;
  /** Nome do Product OU description do Material. */
  name: string;
  /** "ACTIVE" / "INACTIVE" (string livre no schema). */
  status: string;
  /** Apenas Product. */
  isNomusControlled: boolean;
  /** Origem do registro (sourceSystem do Product, opcional). */
  sourceSystem: string | null;
  /** Apenas COMPONENT: indica presença de Processo Padrão preenchido. */
  hasProcessFields: boolean;

  /* Dependências PRODUCT/COMPONENT (Product) */
  /** ProductBOM rows onde productId = este (este item tem estrutura). */
  bomLinesAsParent: number;
  /** ProductBOM rows onde childProductId = este (este item é filho de BOMs alheias). */
  bomLinesAsChild: number;
  /** ProductRouting rows. */
  routingSteps: number;
  /** ProductPricing rows (premissas comerciais). */
  pricingRows: number;
  /** ProposalItem rows. */
  proposalItems: number;
  /** SalesOrderItem rows. */
  salesOrderItems: number;
  /** PriceTableItem rows (versões publicadas em tabelas de preço). */
  priceTableItems: number;
  /** CostCalculationLog rows. */
  costCalculationLogs: number;

  /* Dependências MATERIAL (Material) */
  /** ProductBOM rows onde materialId = este (uso como MP em BOMs). */
  bomLinesAsMaterial: number;
  materialPriceHistory: number;
  purchaseRequestItems: number;

  /** Histórico/auditoria já existente (EngineeringChangeLog para esta entidade). */
  historyEntries: number;
};

/** Card visual exibido no modal de impacto. */
export type ItemReclassificationImpactCard = {
  key: string;
  label: string;
  value: string;
  severity: "info" | "warning" | "danger";
};

/** Texto de uma seção da análise de impacto. */
export type ItemReclassificationImpactBullet = string;

/** Plano executável que descreve a operação que o backend irá realizar. */
export type ItemReclassificationPlan =
  | { kind: "NOOP" }
  | {
      kind: "UPDATE_PRODUCT_TYPE";
      productId: string;
      from: "PRODUCT" | "COMPONENT";
      to: "PRODUCT" | "COMPONENT";
      /** Quando alvo = PRODUCT, zerar Processo Padrão (cycle/cavities/setup/efficiency). */
      clearProcessFields: boolean;
    }
  | {
      kind: "CONVERT_PRODUCT_TO_MATERIAL";
      productId: string;
      materialCode: string;
      description: string;
      /** Inativar (status = INACTIVE) o Product original em vez de apagar. */
      deactivateOriginalProduct: true;
    }
  | {
      kind: "CONVERT_MATERIAL_TO_PRODUCT";
      materialId: string;
      productSku: string;
      productName: string;
      targetType: "PRODUCT" | "COMPONENT";
      /** Inativar (status = INACTIVE) o Material original em vez de apagar. */
      deactivateOriginalMaterial: true;
    };

/** Estado de decisão calculado pela lib pura para o frontend exibir e o backend reforçar. */
export type ItemReclassificationStatus =
  | "ALLOWED"
  | "REQUIRES_CONFIRMATION"
  | "BLOCKED";

/** Modo de aplicação solicitado pelo usuário. */
export type ItemReclassificationMode = "SAFE" | "FORCE_WITH_CONFIRMATION";

/** Resultado da análise pura. Frontend usa para renderizar; backend usa para validar. */
export type ItemReclassificationImpact = {
  source: ItemReclassificationSourceSnapshot;
  targetKind: ItemReclassificationKind;
  status: ItemReclassificationStatus;
  /** Cards de contagem/atributo. */
  cards: ItemReclassificationImpactCard[];
  /** Texto curto orientando a próxima ação (recomendação). */
  recommendedAction: string;
  /** Resumo curto exibido no topo do modal. */
  summary: string;
  /** Seções de explicação. */
  sectionsKept: ItemReclassificationImpactBullet[];
  sectionsChanged: ItemReclassificationImpactBullet[];
  sectionsPreserved: ItemReclassificationImpactBullet[];
  sectionsBlocked: ItemReclassificationImpactBullet[];
  sectionsAtRisk: ItemReclassificationImpactBullet[];
  /** Motivos de bloqueio (status = BLOCKED). */
  blockingReasons: ItemReclassificationBlockingReason[];
  /** Avisos não bloqueantes (incluindo aviso de item controlado pelo Nomus). */
  warnings: ItemReclassificationWarning[];
  /** Texto exato que o usuário deve digitar. Vazio quando status = BLOCKED. */
  requiredConfirmationText: string;
  /** Confirmação adicional sensível (perda/desvinculação). null se não aplicável. */
  extraConfirmationText: string | null;
  /** Operação que o backend executará caso confirmada (transacional). */
  plan: ItemReclassificationPlan;
};

/** Código + mensagem humana do motivo de bloqueio. */
export type ItemReclassificationBlockingReason = {
  code: ItemReclassificationBlockingCode;
  message: string;
};

export type ItemReclassificationBlockingCode =
  | "NO_OP"
  | "INVALID_TARGET_KIND"
  | "BOM_AS_PARENT_PRESENT"
  | "ROUTING_PRESENT"
  | "USED_AS_CHILD_IN_BOM"
  | "USED_AS_MATERIAL_IN_BOM"
  | "PROPOSAL_HISTORY_PRESENT"
  | "SALES_ORDER_HISTORY_PRESENT"
  | "PRICING_PRESENT"
  | "PRICE_TABLE_HISTORY_PRESENT"
  | "PURCHASE_REQUEST_PRESENT"
  | "TARGET_KIND_NOT_IMPLEMENTED"
  | "SKU_OR_CODE_CONFLICT";

/** Códigos de aviso (não bloqueiam). */
export type ItemReclassificationWarning = {
  code: ItemReclassificationWarningCode;
  message: string;
};

export type ItemReclassificationWarningCode =
  | "NOMUS_CONTROLLED"
  | "HAS_HISTORY"
  | "PROCESS_FIELDS_WILL_BE_CLEARED"
  | "BOM_PRESERVED_NEW_KIND"
  | "MATERIAL_PRICE_HISTORY_KEPT_ON_LEGACY"
  | "MATERIAL_USED_AS_BOM_INPUT";

/** Confirmação que o caller envia ao endpoint POST de reclassificação. */
export type ItemReclassificationConfirmation = {
  targetKind: ItemReclassificationKind;
  mode: ItemReclassificationMode;
  /** Texto que o usuário digitou; deve casar com requiredConfirmationText. */
  confirmationText: string;
  /** Confirmação adicional (quando extraConfirmationText !== null). */
  extraConfirmationText?: string;
};

/** Resposta padrão do POST /api/products/:id/reclassify (e equivalentes). */
export type ItemReclassificationApplyResult = {
  ok: true;
  appliedPlan: ItemReclassificationPlan;
  /** Identidade do registro principal após reclassificação. */
  productId: string | null;
  materialId: string | null;
  /** sku/code resultante. */
  identifier: string;
  /** EngineeringChangeLog id (auditoria). */
  changeLogId: string | null;
  /** Mensagem amigável para a UI. */
  message: string;
};

/** Resposta padronizada de falha (ex.: confirmação inválida, bloqueio detectado tarde, etc.). */
export type ItemReclassificationApplyError = {
  ok: false;
  error: string;
  code: ItemReclassificationApplyErrorCode;
  message: string;
  /** Quando o backend recalcula e descobre bloqueio que o frontend não detectou. */
  blockingReasons?: ItemReclassificationBlockingReason[];
};

export type ItemReclassificationApplyErrorCode =
  | "CONFIRMATION_MISMATCH"
  | "EXTRA_CONFIRMATION_MISSING"
  | "RECLASSIFICATION_BLOCKED"
  | "INVALID_TARGET_KIND"
  | "SOURCE_NOT_FOUND"
  | "TARGET_IDENTIFIER_CONFLICT"
  | "NOT_IMPLEMENTED"
  | "INTERNAL_ERROR";
