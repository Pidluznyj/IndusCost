/**
 * Lib pura: regras de reclassificação de itens entre PRODUTO / COMPONENTE / MATERIAL.
 *
 * Fase: INDUSCOST-ITEM-RECLASSIFICATION-WORKFLOW-A.
 *
 * Princípios:
 *   - Toda decisão (allowed/blocked) é determinística a partir do snapshot de dependências.
 *   - Bloqueia mudanças destrutivas silenciosas. Mensagens explícitas e acionáveis.
 *   - O resultado é consumido pelo frontend (modal de impacto) e pelo backend
 *     (POST /reclassify) — o backend revalida com o mesmo motor antes de aplicar.
 *
 * Este arquivo NÃO importa Prisma e pode ser empacotado no bundle do Vite.
 */

import type {
  ItemReclassificationBlockingCode,
  ItemReclassificationBlockingReason,
  ItemReclassificationImpact,
  ItemReclassificationImpactCard,
  ItemReclassificationKind,
  ItemReclassificationPlan,
  ItemReclassificationSourceSnapshot,
  ItemReclassificationWarning,
} from "@/src/lib/itemReclassificationTypes";

export const ITEM_RECLASSIFICATION_LABELS = {
  cardCurrentKind: "Tipo atual",
  cardTargetKind: "Novo tipo",
  cardBomAsParent: "Estrutura própria (BOM)",
  cardBomAsChild: "Usado como componente em BOMs alheias",
  cardBomAsMaterial: "Usado como matéria-prima em BOMs",
  cardRouting: "Roteiro/processo cadastrado",
  cardPricing: "Premissas comerciais (ProductPricing)",
  cardProposals: "Propostas comerciais",
  cardSalesOrders: "Pedidos de venda",
  cardPriceTable: "Linhas em tabela de preço",
  cardCostLogs: "Registros de cálculo de custo",
  cardMaterialPrice: "Histórico de preço (Material)",
  cardPurchase: "Solicitações de compra",
  cardNomus: "Controlado pelo Nomus",
  cardHistory: "Histórico/auditoria",
} as const;

const KIND_LABEL: Record<ItemReclassificationKind, string> = {
  PRODUCT: "Produto",
  COMPONENT: "Componente",
  MATERIAL: "Material",
};

function formatNumberOrNo(n: number): string {
  return n > 0 ? String(n) : "Não";
}

function yesNo(b: boolean): string {
  return b ? "Sim" : "Não";
}

function dangerIfPositive(n: number): "danger" | "info" {
  return n > 0 ? "danger" : "info";
}

function warnIfPositive(n: number): "warning" | "info" {
  return n > 0 ? "warning" : "info";
}

function withMarker(prefix: string, text: string): string {
  return `${prefix} ${text}`;
}

function pushBlock(
  reasons: ItemReclassificationBlockingReason[],
  code: ItemReclassificationBlockingCode,
  message: string
): void {
  reasons.push({ code, message });
}

function buildCardsForSource(
  source: ItemReclassificationSourceSnapshot
): ItemReclassificationImpactCard[] {
  const cards: ItemReclassificationImpactCard[] = [
    {
      key: "current_kind",
      label: ITEM_RECLASSIFICATION_LABELS.cardCurrentKind,
      value: KIND_LABEL[source.kind],
      severity: "info",
    },
  ];

  if (source.kind === "PRODUCT" || source.kind === "COMPONENT") {
    cards.push(
      {
        key: "bom_as_parent",
        label: ITEM_RECLASSIFICATION_LABELS.cardBomAsParent,
        value: formatNumberOrNo(source.bomLinesAsParent),
        severity: dangerIfPositive(source.bomLinesAsParent),
      },
      {
        key: "bom_as_child",
        label: ITEM_RECLASSIFICATION_LABELS.cardBomAsChild,
        value: formatNumberOrNo(source.bomLinesAsChild),
        severity: warnIfPositive(source.bomLinesAsChild),
      },
      {
        key: "routing",
        label: ITEM_RECLASSIFICATION_LABELS.cardRouting,
        value: formatNumberOrNo(source.routingSteps),
        severity: warnIfPositive(source.routingSteps),
      },
      {
        key: "pricing",
        label: ITEM_RECLASSIFICATION_LABELS.cardPricing,
        value: formatNumberOrNo(source.pricingRows),
        severity: warnIfPositive(source.pricingRows),
      },
      {
        key: "proposals",
        label: ITEM_RECLASSIFICATION_LABELS.cardProposals,
        value: formatNumberOrNo(source.proposalItems),
        severity: dangerIfPositive(source.proposalItems),
      },
      {
        key: "sales_orders",
        label: ITEM_RECLASSIFICATION_LABELS.cardSalesOrders,
        value: formatNumberOrNo(source.salesOrderItems),
        severity: dangerIfPositive(source.salesOrderItems),
      },
      {
        key: "price_table",
        label: ITEM_RECLASSIFICATION_LABELS.cardPriceTable,
        value: formatNumberOrNo(source.priceTableItems),
        severity: dangerIfPositive(source.priceTableItems),
      },
      {
        key: "cost_logs",
        label: ITEM_RECLASSIFICATION_LABELS.cardCostLogs,
        value: formatNumberOrNo(source.costCalculationLogs),
        severity: "info",
      }
    );
  }

  if (source.kind === "MATERIAL") {
    cards.push(
      {
        key: "bom_as_material",
        label: ITEM_RECLASSIFICATION_LABELS.cardBomAsMaterial,
        value: formatNumberOrNo(source.bomLinesAsMaterial),
        severity: warnIfPositive(source.bomLinesAsMaterial),
      },
      {
        key: "material_price",
        label: ITEM_RECLASSIFICATION_LABELS.cardMaterialPrice,
        value: formatNumberOrNo(source.materialPriceHistory),
        severity: "info",
      },
      {
        key: "purchase",
        label: ITEM_RECLASSIFICATION_LABELS.cardPurchase,
        value: formatNumberOrNo(source.purchaseRequestItems),
        severity: warnIfPositive(source.purchaseRequestItems),
      }
    );
  }

  cards.push(
    {
      key: "nomus",
      label: ITEM_RECLASSIFICATION_LABELS.cardNomus,
      value: yesNo(source.isNomusControlled),
      severity: source.isNomusControlled ? "warning" : "info",
    },
    {
      key: "history",
      label: ITEM_RECLASSIFICATION_LABELS.cardHistory,
      value: formatNumberOrNo(source.historyEntries),
      severity: "info",
    }
  );

  return cards;
}

/**
 * Texto que o usuário precisa digitar para confirmar. Mantemos curto e
 * facilmente verificável servidor-side.
 */
export function buildConfirmationText(
  source: ItemReclassificationSourceSnapshot,
  targetKind: ItemReclassificationKind
): string {
  if (
    (source.kind === "PRODUCT" && targetKind === "COMPONENT") ||
    (source.kind === "COMPONENT" && targetKind === "PRODUCT")
  ) {
    return "RECLASSIFICAR ITEM";
  }
  if (
    (source.kind === "PRODUCT" || source.kind === "COMPONENT") &&
    targetKind === "MATERIAL"
  ) {
    return `RECLASSIFICAR PARA MATERIAL ${source.sku}`;
  }
  if (source.kind === "MATERIAL" && targetKind === "PRODUCT") {
    return `RECLASSIFICAR PARA PRODUTO ${source.sku}`;
  }
  if (source.kind === "MATERIAL" && targetKind === "COMPONENT") {
    return `RECLASSIFICAR PARA COMPONENTE ${source.sku}`;
  }
  return "";
}

/** Confirmação extra exigida quando a operação pode desvincular estrutura. */
export const EXTRA_CONFIRMATION_DETACH_STRUCTURE =
  "ENTENDO QUE A ESTRUTURA PODE SER DESVINCULADA";

/**
 * Decide bloqueios para PRODUCT/COMPONENT → MATERIAL.
 * Conservador: bloqueia qualquer uso comercial ou estrutural ativo.
 */
function buildBlockingForProductToMaterial(
  source: ItemReclassificationSourceSnapshot
): ItemReclassificationBlockingReason[] {
  const reasons: ItemReclassificationBlockingReason[] = [];

  if (source.bomLinesAsParent > 0) {
    pushBlock(
      reasons,
      "BOM_AS_PARENT_PRESENT",
      `Este item possui estrutura própria (BOM) com ${source.bomLinesAsParent} linha(s). Materiais não podem ter BOM. Remova ou revise a estrutura antes de reclassificar.`
    );
  }
  if (source.routingSteps > 0) {
    pushBlock(
      reasons,
      "ROUTING_PRESENT",
      `Este item possui ${source.routingSteps} etapa(s) de roteiro/processo. Materiais não possuem roteiro produtivo. Remova o roteiro antes de reclassificar.`
    );
  }
  if (source.proposalItems > 0) {
    pushBlock(
      reasons,
      "PROPOSAL_HISTORY_PRESENT",
      "Este item já foi usado em propostas comerciais. Para preservar o histórico, ele não pode ser convertido em Material. Crie um Material equivalente manualmente e inative o produto."
    );
  }
  if (source.salesOrderItems > 0) {
    pushBlock(
      reasons,
      "SALES_ORDER_HISTORY_PRESENT",
      "Este item já foi usado em pedidos de venda. Para preservar o histórico, ele não pode ser convertido em Material."
    );
  }
  if (source.priceTableItems > 0) {
    pushBlock(
      reasons,
      "PRICE_TABLE_HISTORY_PRESENT",
      `Este item tem ${source.priceTableItems} linha(s) em tabelas de preço publicadas. Despublique ou crie um Material novo manualmente.`
    );
  }
  if (source.pricingRows > 0) {
    pushBlock(
      reasons,
      "PRICING_PRESENT",
      "Este item possui premissas comerciais (ProductPricing) cadastradas. Limpe a precificação antes de reclassificar como Material."
    );
  }
  if (source.bomLinesAsChild > 0) {
    pushBlock(
      reasons,
      "USED_AS_CHILD_IN_BOM",
      `Este item é usado como componente em ${source.bomLinesAsChild} linha(s) de BOM de outros produtos. Trocá-lo por Material exige reapontamento manual via tela de BOM.`
    );
  }
  return reasons;
}

/**
 * MATERIAL → PRODUCT/COMPONENT: implementação adiada para fase futura.
 * Mantemos análise read-only para o frontend orientar o usuário, mas o plano
 * é NOOP e bloqueia o apply.
 */
function buildBlockingForMaterialToProduct(): ItemReclassificationBlockingReason[] {
  const reasons: ItemReclassificationBlockingReason[] = [];
  pushBlock(
    reasons,
    "TARGET_KIND_NOT_IMPLEMENTED",
    "A conversão de Material em Produto/Componente ainda não está disponível por este fluxo. Crie um novo Produto/Componente manualmente em Engenharia e inative o Material no módulo de Suprimentos."
  );
  return reasons;
}

/**
 * PRODUCT ↔ COMPONENT — bloqueios brandos: nunca bloqueia, mas pode exigir
 * confirmação quando há vínculos comerciais ativos.
 */
function detectProductComponentSwapWarnings(
  source: ItemReclassificationSourceSnapshot,
  targetKind: "PRODUCT" | "COMPONENT"
): {
  warnings: ItemReclassificationWarning[];
  requireConfirmation: boolean;
} {
  const warnings: ItemReclassificationWarning[] = [];
  let requireConfirmation = false;

  if (source.isNomusControlled) {
    warnings.push({
      code: "NOMUS_CONTROLLED",
      message:
        "Este item é controlado pelo Nomus. Reclassificações manuais podem ser sobrescritas em próximas sincronizações; confirme apenas se for a regra correta para o IndusCost.",
    });
    requireConfirmation = true;
  }

  if (source.kind === "COMPONENT" && targetKind === "PRODUCT" && source.hasProcessFields) {
    warnings.push({
      code: "PROCESS_FIELDS_WILL_BE_CLEARED",
      message:
        "O Processo Padrão (ciclo/cavidades/setup/eficiência) será apagado: produtos finais usam roteiro, não processo padrão.",
    });
    requireConfirmation = true;
  }

  if (source.proposalItems > 0 || source.salesOrderItems > 0 || source.priceTableItems > 0) {
    warnings.push({
      code: "HAS_HISTORY",
      message:
        "Este item já tem histórico comercial (propostas/pedidos/tabela de preço). A reclassificação não apaga nada, mas a regra de uso muda; confirme apenas se for a decisão correta.",
    });
    requireConfirmation = true;
  }

  if (source.bomLinesAsChild > 0 && targetKind === "PRODUCT") {
    warnings.push({
      code: "BOM_PRESERVED_NEW_KIND",
      message: `Este item é usado como componente em ${source.bomLinesAsChild} BOM(s) de outros produtos. Como Produto, ele continuará válido como filho, mas confirme se a regra comercial é compatível.`,
    });
    requireConfirmation = true;
  }

  return { warnings, requireConfirmation };
}

/**
 * Entrada principal. Calcula o impacto da reclassificação a partir do
 * snapshot read-only de dependências.
 */
export function analyzeItemReclassificationImpact(
  source: ItemReclassificationSourceSnapshot,
  targetKind: ItemReclassificationKind
): ItemReclassificationImpact {
  const cards = buildCardsForSource(source);
  cards.unshift({
    key: "target_kind",
    label: ITEM_RECLASSIFICATION_LABELS.cardTargetKind,
    value: KIND_LABEL[targetKind],
    severity: "info",
  });

  // Caso 1: tipo igual → NOOP.
  if (targetKind === source.kind) {
    return {
      source,
      targetKind,
      status: "BLOCKED",
      cards,
      recommendedAction: "O item já está classificado neste tipo. Nenhuma alteração necessária.",
      summary: `O item já é ${KIND_LABEL[source.kind]}.`,
      sectionsKept: ["Tudo permanece como está."],
      sectionsChanged: [],
      sectionsPreserved: [],
      sectionsBlocked: ["Nenhuma operação executada."],
      sectionsAtRisk: [],
      blockingReasons: [{ code: "NO_OP", message: "Tipo de origem e destino são iguais." }],
      warnings: [],
      requiredConfirmationText: "",
      extraConfirmationText: null,
      plan: { kind: "NOOP" },
    };
  }

  const isProductOrComponent = source.kind === "PRODUCT" || source.kind === "COMPONENT";

  // Caso 2: PRODUCT ↔ COMPONENT.
  if (
    isProductOrComponent &&
    (targetKind === "PRODUCT" || targetKind === "COMPONENT")
  ) {
    const fromType = source.kind as "PRODUCT" | "COMPONENT";
    const toType = targetKind;
    const { warnings, requireConfirmation } = detectProductComponentSwapWarnings(
      source,
      toType
    );
    const clearProcessFields = fromType === "COMPONENT" && toType === "PRODUCT";

    const sectionsKept: string[] = [
      `Identificador (sku/código) e nome mantidos: ${source.sku}.`,
      "Histórico, propostas, pedidos e tabelas de preço preservados.",
    ];
    if (source.bomLinesAsParent > 0) {
      sectionsKept.push(`Estrutura própria (BOM) com ${source.bomLinesAsParent} linha(s) preservada.`);
    }
    if (source.routingSteps > 0 && !clearProcessFields) {
      sectionsKept.push(`Roteiro (${source.routingSteps} etapa(s)) preservado.`);
    }
    if (source.bomLinesAsChild > 0) {
      sectionsKept.push(
        `Continua usado como componente em ${source.bomLinesAsChild} BOM(s) de outros itens.`
      );
    }

    const sectionsChanged: string[] = [
      `Product.type passa de ${KIND_LABEL[fromType]} para ${KIND_LABEL[toType]}.`,
    ];
    if (clearProcessFields) {
      sectionsChanged.push(
        "Processo Padrão (ciclo/cavidades/setup/eficiência) será apagado — não é permitido em Produto."
      );
    }

    const sectionsAtRisk: string[] = [];
    if (toType === "PRODUCT" && source.bomLinesAsChild > 0) {
      sectionsAtRisk.push(
        "Este item continuará válido como filho em outras BOMs, mas verifique se faz sentido comercialmente."
      );
    }
    if (source.isNomusControlled) {
      sectionsAtRisk.push(
        "Próxima sincronização Nomus pode reverter esta reclassificação, dependendo do cadastro Nomus."
      );
    }

    const requiredConfirmationText = buildConfirmationText(source, toType);

    return {
      source,
      targetKind,
      status: requireConfirmation ? "REQUIRES_CONFIRMATION" : "ALLOWED",
      cards,
      recommendedAction: requireConfirmation
        ? "Confirme com cuidado: este item tem vínculos que mudam de significado após a reclassificação."
        : "Reclassificação segura. Pode confirmar.",
      summary: `${KIND_LABEL[fromType]} → ${KIND_LABEL[toType]} no mesmo registro (Product.id preservado).`,
      sectionsKept,
      sectionsChanged,
      sectionsPreserved: [
        "EngineeringChangeLog registrará origem MANUAL_EDIT com motivo ITEM_RECLASSIFICATION.",
      ],
      sectionsBlocked: [],
      sectionsAtRisk,
      blockingReasons: [],
      warnings,
      requiredConfirmationText,
      extraConfirmationText: null,
      plan: {
        kind: "UPDATE_PRODUCT_TYPE",
        productId: source.id,
        from: fromType,
        to: toType,
        clearProcessFields,
      },
    };
  }

  // Caso 3: PRODUCT/COMPONENT → MATERIAL.
  if (isProductOrComponent && targetKind === "MATERIAL") {
    const blocking = buildBlockingForProductToMaterial(source);
    const warnings: ItemReclassificationWarning[] = [];
    if (source.isNomusControlled) {
      warnings.push({
        code: "NOMUS_CONTROLLED",
        message:
          "Este item é controlado pelo Nomus. Confirme apenas se esta decisão representa a regra correta para o IndusCost.",
      });
    }

    if (blocking.length > 0) {
      return {
        source,
        targetKind,
        status: "BLOCKED",
        cards,
        recommendedAction:
          "Resolva os bloqueios listados acima antes de tentar reclassificar. Para preservar histórico, considere criar um Material equivalente manualmente e inativar este produto.",
        summary: `Conversão de ${KIND_LABEL[source.kind]} para Material bloqueada por dependências.`,
        sectionsKept: ["Produto e todas as suas dependências permanecem intactos."],
        sectionsChanged: [],
        sectionsPreserved: [],
        sectionsBlocked: blocking.map((b) => withMarker("•", b.message)),
        sectionsAtRisk: [],
        blockingReasons: blocking,
        warnings,
        requiredConfirmationText: "",
        extraConfirmationText: null,
        plan: { kind: "NOOP" },
      };
    }

    // Caminho permitido: item "limpo" sem dependências críticas.
    const requiredConfirmationText = buildConfirmationText(source, "MATERIAL");
    const extraConfirmationText =
      source.bomLinesAsChild > 0 ? EXTRA_CONFIRMATION_DETACH_STRUCTURE : null;

    const sectionsChanged: string[] = [
      `Material criado com código ${source.sku} e descrição "${source.name}".`,
      `Produto original mantido inativo (status=INACTIVE) para preservar histórico e referências.`,
    ];

    const sectionsPreserved: string[] = [
      "EngineeringChangeLog registrará origem MANUAL_EDIT com motivo ITEM_RECLASSIFICATION.",
      "Nenhum registro de BOM, proposta, pedido, preço ou roteiro é alterado.",
    ];

    return {
      source,
      targetKind,
      status: "REQUIRES_CONFIRMATION",
      cards,
      recommendedAction:
        "Crie o Material e mantenha o Produto original inativo para preservar identidade e histórico. Confirme o código exato exibido.",
      summary: `${KIND_LABEL[source.kind]} → Material (novo registro em Material, Product inativado).`,
      sectionsKept: ["SKU/código mantido para rastreabilidade entre Product e Material."],
      sectionsChanged,
      sectionsPreserved,
      sectionsBlocked: [],
      sectionsAtRisk: [
        "Esta operação não apaga o Product original — apenas o inativa. Reverter implica reativar o Product e remover o Material recém-criado.",
      ],
      blockingReasons: [],
      warnings,
      requiredConfirmationText,
      extraConfirmationText,
      plan: {
        kind: "CONVERT_PRODUCT_TO_MATERIAL",
        productId: source.id,
        materialCode: source.sku,
        description: source.name,
        deactivateOriginalProduct: true,
      },
    };
  }

  // Caso 4: MATERIAL → PRODUCT/COMPONENT — não implementado nesta fase.
  if (
    source.kind === "MATERIAL" &&
    (targetKind === "PRODUCT" || targetKind === "COMPONENT")
  ) {
    const blocking = buildBlockingForMaterialToProduct();
    return {
      source,
      targetKind,
      status: "BLOCKED",
      cards,
      recommendedAction:
        "Crie o novo Produto/Componente manualmente no módulo de Engenharia e inative o Material no módulo de Suprimentos. Esta fase não converte Material em Produto automaticamente.",
      summary: "Conversão de Material para Produto/Componente ainda não disponível.",
      sectionsKept: ["Material e todas as suas dependências permanecem intactos."],
      sectionsChanged: [],
      sectionsPreserved: [],
      sectionsBlocked: blocking.map((b) => withMarker("•", b.message)),
      sectionsAtRisk: [],
      blockingReasons: blocking,
      warnings: [],
      requiredConfirmationText: "",
      extraConfirmationText: null,
      plan: { kind: "NOOP" },
    };
  }

  // Fallback defensivo — nunca deveria cair aqui.
  return {
    source,
    targetKind,
    status: "BLOCKED",
    cards,
    recommendedAction:
      "Combinação de origem/destino não reconhecida. Verifique se o tipo escolhido é válido.",
    summary: "Combinação inválida.",
    sectionsKept: [],
    sectionsChanged: [],
    sectionsPreserved: [],
    sectionsBlocked: ["Combinação de origem/destino não suportada."],
    sectionsAtRisk: [],
    blockingReasons: [
      { code: "INVALID_TARGET_KIND", message: "Combinação não suportada." },
    ],
    warnings: [],
    requiredConfirmationText: "",
    extraConfirmationText: null,
    plan: { kind: "NOOP" },
  };
}

/**
 * Verifica se a confirmação textual digitada pelo usuário corresponde
 * exatamente ao requerido pelo impacto. Comparação case-sensitive — esse
 * é o padrão dos demais fluxos críticos do IndusCost (apply Nomus etc.).
 */
export function checkReclassificationConfirmation(
  impact: ItemReclassificationImpact,
  payload: { confirmationText: string; extraConfirmationText?: string }
): { ok: true } | { ok: false; code: "CONFIRMATION_MISMATCH" | "EXTRA_CONFIRMATION_MISSING"; message: string } {
  if (impact.status === "BLOCKED") {
    return {
      ok: false,
      code: "CONFIRMATION_MISMATCH",
      message: "Reclassificação bloqueada — não é possível confirmar.",
    };
  }
  if (impact.requiredConfirmationText.length === 0) {
    return {
      ok: false,
      code: "CONFIRMATION_MISMATCH",
      message: "Esta reclassificação não tem texto de confirmação calculado.",
    };
  }
  const typed = (payload.confirmationText ?? "").trim();
  if (typed !== impact.requiredConfirmationText) {
    return {
      ok: false,
      code: "CONFIRMATION_MISMATCH",
      message: `Confirmação não confere. Digite exatamente: ${impact.requiredConfirmationText}`,
    };
  }
  if (impact.extraConfirmationText) {
    const extra = (payload.extraConfirmationText ?? "").trim();
    if (extra !== impact.extraConfirmationText) {
      return {
        ok: false,
        code: "EXTRA_CONFIRMATION_MISSING",
        message: `Confirmação adicional não confere. Digite exatamente: ${impact.extraConfirmationText}`,
      };
    }
  }
  return { ok: true };
}

/**
 * Resumo do plano em texto curto para gravação em EngineeringChangeLog.reason.
 * Backend prefixa com "ITEM_RECLASSIFICATION:".
 */
export function describePlanForAudit(plan: ItemReclassificationPlan): string {
  switch (plan.kind) {
    case "NOOP":
      return "NOOP";
    case "UPDATE_PRODUCT_TYPE":
      return `UPDATE_PRODUCT_TYPE ${plan.from}→${plan.to}${
        plan.clearProcessFields ? " (clear process fields)" : ""
      }`;
    case "CONVERT_PRODUCT_TO_MATERIAL":
      return `CONVERT_PRODUCT_TO_MATERIAL code=${plan.materialCode} deactivateProduct=true`;
    case "CONVERT_MATERIAL_TO_PRODUCT":
      return `CONVERT_MATERIAL_TO_PRODUCT sku=${plan.productSku} type=${plan.targetType} deactivateMaterial=true`;
  }
}
