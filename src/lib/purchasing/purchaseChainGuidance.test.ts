/**
 * O que está sob prova: A TELA NUNCA FICA MUDA.
 *
 * Para todo status possível de um pedido, tem de existir uma frase dizendo por
 * que ele está parado e o que precisa acontecer para sair dali — inclusive
 * quando não há nada a fazer, quando falta permissão e quando o módulo seguinte
 * está desligado por feature flag. Este último era exatamente o buraco: o
 * Recebimento desabilitado deixava o pedido travado e a tela em silêncio.
 *
 * Também prova que o encerramento existe de verdade. Antes disto o status
 * ENCERRADO era lido pelos indicadores e pela elegibilidade da avaliação, mas
 * nenhuma transição o produzia — o pedido prometia uma fase inalcançável.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TERMINAL_STATUSES,
  PurchaseOrderWorkflowError,
  assertPurchaseOrderCloseReason,
  closeRequiresReason,
  resolvePurchaseOrderTransition,
  type PurchaseOrderStatusName,
} from "./purchaseOrderWorkflow.js";
import {
  PURCHASE_RECEIVING_FLAG,
  pipelineStageIndex,
  resolvePurchaseOrderGuidance,
  resolvePurchaseRequestGuidance,
  type PurchaseRequestStatusName,
  stageForPurchaseOrderStatus,
} from "./purchaseChainGuidance.js";

const ALL_ON = { receiving: true, supplierPerformance: true };
const ALL_OFF = { receiving: false, supplierPerformance: false };
const FULL = { canUpdate: true, canApprove: true };
const READONLY = { canUpdate: false, canApprove: false };

function guide(
  status: PurchaseOrderStatusName,
  flags = ALL_ON,
  permissions = FULL
) {
  return resolvePurchaseOrderGuidance({ status, flags, permissions });
}

// ===========================================================================
// 1) Encerrar pedido — a fase que não existia
// ===========================================================================

describe("encerramento do pedido", () => {
  it("1. ENCERRADO deixou de ser inalcançável", () => {
    assert.equal(resolvePurchaseOrderTransition("RECEBIDO", "CLOSE"), "ENCERRADO");
    assert.equal(
      resolvePurchaseOrderTransition("PARCIALMENTE_RECEBIDO", "CLOSE"),
      "ENCERRADO"
    );
  });

  it("2. só encerra o que já foi recebido, no todo ou em parte", () => {
    // Encerrar um pedido que nem chegou a ser confirmado esconderia trabalho
    // por fazer — para desistir antes disso existe CANCELAR.
    for (const status of ["RASCUNHO", "APROVADO", "ENVIADO", "CONFIRMADO"] as const) {
      assert.throws(
        () => resolvePurchaseOrderTransition(status, "CLOSE"),
        (e: unknown) => (e as PurchaseOrderWorkflowError).code === "INVALID_TRANSITION",
        `não deveria encerrar a partir de ${status}`
      );
    }
  });

  it("3. terminal não volta atrás", () => {
    for (const status of ["CANCELADO", "ENCERRADO"] as const) {
      assert.throws(() => resolvePurchaseOrderTransition(status, "CLOSE"));
      assert.throws(() => resolvePurchaseOrderTransition(status, "CONFIRM"));
    }
  });

  it("4. encerrar com saldo pendente exige motivo; sem saldo, não", () => {
    assert.equal(closeRequiresReason("PARCIALMENTE_RECEBIDO"), true);
    assert.equal(closeRequiresReason("RECEBIDO"), false);

    assert.throws(
      () => assertPurchaseOrderCloseReason("PARCIALMENTE_RECEBIDO", "   "),
      (e: unknown) => (e as PurchaseOrderWorkflowError).code === "CLOSE_REASON"
    );
    assert.throws(() => assertPurchaseOrderCloseReason("PARCIALMENTE_RECEBIDO", "ok"));
    assert.doesNotThrow(() =>
      assertPurchaseOrderCloseReason("PARCIALMENTE_RECEBIDO", "fornecedor descontinuou")
    );
    // Recebido por inteiro não sobrou nada a justificar.
    assert.doesNotThrow(() => assertPurchaseOrderCloseReason("RECEBIDO", null));
  });

  it("5. o estorno do recebimento agora é transição declarada", () => {
    // O serviço de recebimento já devolvia o pedido a CONFIRMADO gravando
    // status direto, por fora da máquina de estados.
    assert.equal(
      resolvePurchaseOrderTransition("RECEBIDO", "REOPEN_FROM_RECEIPT"),
      "CONFIRMADO"
    );
    assert.equal(
      resolvePurchaseOrderTransition("PARCIALMENTE_RECEBIDO", "REOPEN_FROM_RECEIPT"),
      "CONFIRMADO"
    );
  });

  it("6. EMITIDO deixou de ser origem de transição", () => {
    // Era legado inalcançável: nenhuma transição o produz e nenhuma criação o
    // usa. Aceitá-lo como origem só gerava botão morto na tela.
    for (const action of ["SEND", "CONFIRM", "CANCEL"] as const) {
      assert.throws(
        () => resolvePurchaseOrderTransition("EMITIDO", action),
        (e: unknown) => (e as PurchaseOrderWorkflowError).code === "INVALID_TRANSITION",
        `${action} não deveria mais aceitar EMITIDO`
      );
    }
  });
});

// ===========================================================================
// 2) A tela nunca fica muda
// ===========================================================================

describe("orientação da cadeia", () => {
  it("7. TODO status produz motivo e próximo passo", () => {
    for (const status of PURCHASE_ORDER_STATUSES) {
      if (status === "EMITIDO") continue; // legado inalcançável
      const g = guide(status);
      assert.ok(g.stayReason.trim().length > 0, `${status} sem stayReason`);
      assert.ok(g.nextAction.trim().length > 0, `${status} sem nextAction`);
    }
  });

  it("8. status terminal diz que acabou, e não oferece ação", () => {
    for (const status of PURCHASE_ORDER_TERMINAL_STATUSES) {
      const g = guide(status);
      assert.equal(g.terminal, true, `${status} deveria ser terminal`);
      assert.equal(g.action, undefined, `${status} não pode oferecer ação`);
    }
  });

  it("9. Recebimento desligado é DITO, não escondido", () => {
    const g = guide("CONFIRMADO", ALL_OFF);
    assert.ok(g.blocked, "confirmado sem recebimento tem de reportar bloqueio");
    assert.match(g.blocked!.reason, /Recebimento está desabilitado/);
    // O nome da flag vai na dica de administrador, nunca no motivo principal.
    assert.match(g.blocked!.hint ?? "", new RegExp(PURCHASE_RECEIVING_FLAG));
    assert.doesNotMatch(g.blocked!.reason, new RegExp(PURCHASE_RECEIVING_FLAG));
    // E o próximo passo continua descrito — a fase existe, só está impedida.
    assert.match(g.nextAction, /Estação de Recebimento/);
  });

  it("10. com o módulo ligado, confirmado não reporta bloqueio", () => {
    assert.equal(guide("CONFIRMADO", ALL_ON).blocked, undefined);
  });

  it("11. pedido parcial continua encerrável mesmo com recebimento desligado", () => {
    // É justamente o pedido preso: sem esta saída ele ficaria eterno no funil.
    const g = guide("PARCIALMENTE_RECEBIDO", ALL_OFF);
    assert.equal(g.action?.endpoint, "close");
    assert.equal(g.action?.requiresReason, true);
    assert.ok(g.blocked, "o bloqueio do recebimento continua sendo reportado");
  });

  it("12. falta de permissão vira bloqueio, não some com a fase", () => {
    for (const status of ["RASCUNHO", "APROVADO", "ENVIADO", "RECEBIDO"] as const) {
      const g = guide(status, ALL_ON, READONLY);
      assert.equal(g.action, undefined, `${status} não pode oferecer ação sem permissão`);
      assert.match(g.blocked?.reason ?? "", /permissão/i, `${status} sem aviso de permissão`);
      assert.ok(g.nextAction.trim().length > 0, `${status} perdeu o próximo passo`);
    }
  });

  it("13. cada ação oferecida exige a permissão certa", () => {
    // Aprovar e encerrar são decisão (approve); enviar e confirmar são edição.
    assert.equal(guide("RASCUNHO", ALL_ON, { canUpdate: true, canApprove: false }).action, undefined);
    assert.equal(guide("RECEBIDO", ALL_ON, { canUpdate: true, canApprove: false }).action, undefined);
    assert.equal(
      guide("APROVADO", ALL_ON, { canUpdate: true, canApprove: false }).action?.endpoint,
      "send"
    );
    assert.equal(
      guide("ENVIADO", ALL_ON, { canUpdate: true, canApprove: false }).action?.endpoint,
      "confirm"
    );
  });

  it("14. o texto antecipa a regra real do servidor", () => {
    // Se a tela disser algo diferente do que o motor exige, o usuário tenta e
    // toma erro — a dica tem de bater com a mensagem de domínio.
    assert.match(guide("ENVIADO").nextAction, /Só pedidos CONFIRMADOS aceitam recebimento/);
  });

  it("15. avaliação de fornecedor só é sugerida quando o módulo está ligado", () => {
    assert.match(guide("RECEBIDO", ALL_ON).nextAction, /Avaliar o fornecedor/);
    assert.doesNotMatch(guide("RECEBIDO", ALL_OFF).nextAction, /Avaliar o fornecedor/);
  });
});

// ===========================================================================
// 3) Trilha de fases
// ===========================================================================

describe("posição na trilha", () => {
  it("16. status do pedido mapeia para a fase canônica do funil", () => {
    assert.equal(stageForPurchaseOrderStatus("RASCUNHO"), "PEDIDO");
    assert.equal(stageForPurchaseOrderStatus("APROVADO"), "PEDIDO");
    assert.equal(stageForPurchaseOrderStatus("ENVIADO"), "PEDIDO");
    assert.equal(stageForPurchaseOrderStatus("CONFIRMADO"), "CONFIRMADO");
    assert.equal(stageForPurchaseOrderStatus("PARCIALMENTE_RECEBIDO"), "RECEBIDO");
    assert.equal(stageForPurchaseOrderStatus("RECEBIDO"), "RECEBIDO");
  });

  it("17. a trilha avança e nunca retrocede ao longo do fluxo feliz", () => {
    const caminho = [
      "RASCUNHO",
      "APROVADO",
      "ENVIADO",
      "CONFIRMADO",
      "PARCIALMENTE_RECEBIDO",
      "RECEBIDO",
    ] as const;
    let anterior = -1;
    for (const status of caminho) {
      const idx = pipelineStageIndex(stageForPurchaseOrderStatus(status));
      assert.ok(idx >= anterior, `${status} retrocedeu na trilha`);
      anterior = idx;
    }
  });
});


// ===========================================================================
// 4) Solicitação de compra
// ===========================================================================

describe("orientação da solicitação", () => {
  const TODOS: PurchaseRequestStatusName[] = [
    "RASCUNHO",
    "AGUARDANDO_APROVACAO",
    "ABERTA",
    "REJEITADA",
    "EM_COTACAO",
    "CANCELADA",
    "ENCERRADA",
  ];

  it("18. TODO status de solicitação produz motivo e próximo passo", () => {
    for (const status of TODOS) {
      const g = resolvePurchaseRequestGuidance(status);
      assert.ok(g.stayReason.trim().length > 0, status + " sem stayReason");
      assert.ok(g.nextAction.trim().length > 0, status + " sem nextAction");
    }
  });

  it("19. ENCERRADA explica que virou pedido, não que morreu", () => {
    // A tela rotula ENCERRADA como "Pedido emitido" — sem esta frase o
    // usuário lê "encerrada" e acha que o pedido não existe.
    const g = resolvePurchaseRequestGuidance("ENCERRADA");
    assert.match(g.stayReason, /pedido de compra/i);
    assert.notEqual(g.terminal, true, "ainda há pedido para acompanhar");
  });

  it("20. só CANCELADA é terminal", () => {
    for (const status of TODOS) {
      const terminal = resolvePurchaseRequestGuidance(status).terminal === true;
      assert.equal(terminal, status === "CANCELADA", status + " terminal errado");
    }
  });
});