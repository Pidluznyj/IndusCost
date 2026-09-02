/**
 * "Aqui porque / Para sair" da Cadeia de Compras — lógica pura, sem JSX e sem rede.
 *
 * Existe porque a tela sabia o status e mesmo assim não dizia nada: o operador
 * via botões nus e precisava adivinhar em que fase estava, o que faltava para
 * avançar e por que o botão esperado não aparecia. Pior, quando a fase seguinte
 * dependia de um módulo desligado por feature flag, a tela simplesmente
 * silenciava — o caso real que originou este trabalho.
 *
 * Três regras de desenho, nesta ordem de prioridade:
 *
 *  1. TERMINAL vence tudo. Pedido cancelado ou encerrado não tem próximo passo;
 *     inventar um seria mentir.
 *  2. MÓDULO DESLIGADO é dito em voz alta, com o nome da flag. Esconder a fase
 *     deixaria o usuário exatamente onde ele estava: sem entender por que o
 *     pedido não avança.
 *  3. FALTA DE PERMISSÃO não é falha de fluxo. A fase segue sendo a próxima; só
 *     não é este usuário que a executa.
 *
 * As frases de bloqueio reaproveitam o texto literal dos erros de domínio já
 * existentes (purchaseOrderWorkflow / purchaseReceiptService), para que a tela
 * antecipe exatamente a mensagem que o servidor daria.
 */
import { PURCHASING_PIPELINE_STAGES, type PurchasingPipelineStage } from "./purchasingWorkstationEngine.js";
import type { PurchaseOrderStatusName } from "./purchaseOrderWorkflow.js";

export type PurchaseChainFlags = {
  receiving: boolean;
  supplierPerformance: boolean;
};

export type PurchaseChainPermissions = {
  canUpdate: boolean;
  canApprove: boolean;
};

/** Ação que a tela pode oferecer; `endpoint` é sufixo da rota do pedido. */
export type PurchaseChainAction = {
  label: string;
  endpoint: "approve" | "send" | "confirm" | "close";
  /** Exige motivo digitado antes de enviar. */
  requiresReason?: boolean;
};

export type PurchaseChainBlock = {
  reason: string;
  /** Detalhe para quem administra o ambiente — nunca substitui `reason`. */
  hint?: string;
};

export type PurchaseChainGuidance = {
  /** Por que o pedido está parado nesta fase. */
  stayReason: string;
  /** O que precisa acontecer para ele sair dela. */
  nextAction: string;
  /** Presente só quando ESTE usuário pode executar agora. */
  action?: PurchaseChainAction;
  /** Presente quando a fase seguinte existe mas está impedida. */
  blocked?: PurchaseChainBlock;
  /** Fim de linha legítimo — não há próximo passo. */
  terminal?: boolean;
};

export const PURCHASE_RECEIVING_FLAG = "SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED";

/** Fase do funil correspondente a um status de pedido. */
export function stageForPurchaseOrderStatus(
  status: PurchaseOrderStatusName
): PurchasingPipelineStage {
  if (status === "PARCIALMENTE_RECEBIDO" || status === "RECEBIDO") return "RECEBIDO";
  if (status === "CONFIRMADO") return "CONFIRMADO";
  return "PEDIDO";
}

/** Índice da fase na trilha (para marcar concluídas / atual / futuras). */
export function pipelineStageIndex(stage: PurchasingPipelineStage): number {
  return PURCHASING_PIPELINE_STAGES.indexOf(stage);
}

const NO_PERMISSION = "Você não tem permissão para executar esta etapa.";

export function resolvePurchaseOrderGuidance(input: {
  status: PurchaseOrderStatusName;
  flags: PurchaseChainFlags;
  permissions: PurchaseChainPermissions;
}): PurchaseChainGuidance {
  const { status, flags, permissions } = input;

  // 1. Terminal — nada a fazer, e dizer isso é a informação útil.
  if (status === "CANCELADO") {
    return {
      stayReason: "O pedido foi cancelado.",
      nextAction: "Nenhuma ação disponível. Gere um novo pedido se a compra continua necessária.",
      terminal: true,
    };
  }
  if (status === "ENCERRADO") {
    return {
      stayReason: "O pedido foi encerrado e saiu do fluxo operacional.",
      nextAction: "Nenhuma ação pendente.",
      terminal: true,
    };
  }

  if (status === "RASCUNHO") {
    return {
      stayReason: "O pedido foi gerado pela adjudicação, mas ainda não foi aprovado.",
      nextAction:
        "Aprovar o pedido. A aprovação cria o compromisso operacional — não gera estoque nem Contas a Pagar.",
      ...(permissions.canApprove
        ? { action: { label: "Aprovar pedido", endpoint: "approve" as const } }
        : { blocked: { reason: NO_PERMISSION } }),
    };
  }

  if (status === "APROVADO") {
    return {
      stayReason: "O pedido está aprovado, mas ainda não foi enviado ao fornecedor.",
      nextAction: "Enviar ao fornecedor e, quando ele responder, confirmar o pedido.",
      ...(permissions.canUpdate
        ? { action: { label: "Marcar como enviado", endpoint: "send" as const } }
        : { blocked: { reason: NO_PERMISSION } }),
    };
  }

  if (status === "ENVIADO") {
    return {
      stayReason: "O pedido foi enviado e aguarda a confirmação do fornecedor.",
      nextAction: "Confirmar o pedido. Só pedidos CONFIRMADOS aceitam recebimento.",
      ...(permissions.canUpdate
        ? { action: { label: "Confirmar fornecedor", endpoint: "confirm" as const } }
        : { blocked: { reason: NO_PERMISSION } }),
    };
  }

  if (status === "CONFIRMADO") {
    const base = {
      stayReason: "O fornecedor confirmou. O material ainda não foi recebido.",
      nextAction:
        "Registrar o recebimento na Estação de Recebimento. Confirmar o recebimento é o que altera o saldo de estoque.",
    };
    // 2. Módulo desligado é dito em voz alta.
    if (!flags.receiving) {
      return {
        ...base,
        blocked: {
          reason: "O módulo de Recebimento está desabilitado neste ambiente.",
          hint: `Ligue a feature flag ${PURCHASE_RECEIVING_FLAG} e reinicie a aplicação.`,
        },
      };
    }
    return base;
  }

  if (status === "PARCIALMENTE_RECEBIDO") {
    const base = {
      stayReason: "Parte do pedido foi recebida; ainda há saldo em aberto.",
      nextAction:
        "Receber o saldo restante, ou encerrar o pedido informando o motivo se o restante não virá.",
    };
    if (!flags.receiving) {
      return {
        ...base,
        blocked: {
          reason: "O módulo de Recebimento está desabilitado neste ambiente.",
          hint: `Ligue a feature flag ${PURCHASE_RECEIVING_FLAG} e reinicie a aplicação.`,
        },
        ...(permissions.canApprove
          ? {
              action: {
                label: "Encerrar pedido",
                endpoint: "close" as const,
                requiresReason: true,
              },
            }
          : {}),
      };
    }
    return {
      ...base,
      ...(permissions.canApprove
        ? {
            action: {
              label: "Encerrar pedido",
              endpoint: "close" as const,
              requiresReason: true,
            },
          }
        : {}),
    };
  }

  // RECEBIDO
  return {
    stayReason: "Todo o pedido foi recebido.",
    nextAction: flags.supplierPerformance
      ? "Avaliar o fornecedor e encerrar o pedido."
      : "Encerrar o pedido para tirá-lo do fluxo operacional.",
    ...(permissions.canApprove
      ? { action: { label: "Encerrar pedido", endpoint: "close" as const } }
      : { blocked: { reason: NO_PERMISSION } }),
  };
}

/* ------------------------------------------------------------------ *
 * Solicitação de compra — a porta de entrada da cadeia
 * ------------------------------------------------------------------ */

export type PurchaseRequestStatusName =
  | "RASCUNHO"
  | "AGUARDANDO_APROVACAO"
  | "ABERTA"
  | "REJEITADA"
  | "EM_COTACAO"
  | "CANCELADA"
  | "ENCERRADA";

/**
 * Mesma disciplina do pedido: toda solicitação diz por que está parada e o que
 * precisa acontecer. `ENCERRADA` é o caso que mais confunde — o rótulo na tela
 * é "Pedido emitido", então o texto precisa dizer que a bola passou para o
 * pedido de compra, e não que a solicitação morreu.
 */
export function resolvePurchaseRequestGuidance(
  status: PurchaseRequestStatusName
): PurchaseChainGuidance {
  switch (status) {
    case "RASCUNHO":
      return {
        stayReason: "A solicitação ainda é um rascunho e ninguém a recebeu.",
        nextAction: "Enviar a solicitação para o comprador avaliar.",
      };
    case "ABERTA":
      return {
        stayReason: "A solicitação chegou ao comprador e aguarda triagem.",
        nextAction: "O comprador valida a demanda e leva para orçamentação.",
      };
    case "EM_COTACAO":
      return {
        stayReason: "A demanda está em orçamentação com os fornecedores.",
        nextAction:
          "Registrar os orçamentos, marcar o vencedor e enviar para aprovação do gestor.",
      };
    case "AGUARDANDO_APROVACAO":
      return {
        stayReason: "Os orçamentos estão prontos e aguardam decisão do gestor.",
        nextAction:
          "Aprovar — a aprovação emite o pedido de compra a partir do orçamento vencedor.",
      };
    case "REJEITADA":
      return {
        stayReason: "O gestor rejeitou a solicitação.",
        nextAction:
          "Reabrir como rascunho para corrigir, ou voltar para orçamentação com novos preços.",
      };
    case "ENCERRADA":
      return {
        stayReason: "A solicitação virou pedido de compra — o trabalho seguiu adiante.",
        nextAction: "Acompanhar o pedido de compra até o recebimento.",
      };
    case "CANCELADA":
    default:
      return {
        stayReason: "A solicitação foi cancelada.",
        nextAction: "Nenhuma ação disponível. Abra outra se a demanda continua.",
        terminal: true,
      };
  }
}
