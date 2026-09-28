/**
 * Catálogo do registro de contato: rótulos pt-BR, matrizes por motivo e a
 * validação canônica (a mesma do servidor e da tela). Numeração = lista de
 * testes obrigatórios do spec.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CRM_CONTACT_CHANNEL_OPTIONS,
  CRM_CONTACT_REASON_OPTIONS,
  CRM_CONTACT_RESULT_LABELS,
  CRM_CONTACT_RESULT_OPTIONS_BY_REASON,
  CRM_NEXT_ACTION_NONE,
  CRM_NEXT_ACTION_OPTIONS,
  crmActivityTypeLabel,
  crmContactChannelLabel,
  crmContactReasonLabel,
  crmContactResultLabel,
  crmContactResultOptions,
  crmContactStatusLabel,
  crmNextActionLabel,
  crmNextActionOptions,
  crmNextActionSummary,
  deriveCrmContactStatus,
  reconcileCrmContactReasonChange,
  validateCrmContactInput,
} from "./crmContactCatalog.js";

const labels = (reason: string) => crmContactResultOptions(reason).map((o) => o.label);
const actionLabels = (reason: string) => crmNextActionOptions(reason).map((o) => o.label);

/** Contato válido de referência — cada teste muda só o que interessa. */
function validInput(over: Record<string, unknown> = {}) {
  return {
    contactDate: "2026-09-28T13:00:00.000Z",
    channel: "WHATSAPP",
    reason: "PROPOSAL",
    result: "PROPOSAL_PRESENTED",
    summary: "Cliente pediu revisão do prazo de pagamento.",
    nextActionType: "SEND_PROPOSAL",
    nextActionAt: "2026-10-02T13:00:00.000Z",
    nextActionDescription: "Revisar prazo para 45 dias.",
    phoneUsed: "(11) 99999-0000",
    emailUsed: "compras@cliente.com.br",
    ...over,
  };
}

describe("12. rótulos pt-BR — nenhum código técnico na interface", () => {
  it("canal, motivo e status traduzidos (códigos internos continuam em inglês)", () => {
    assert.equal(crmContactChannelLabel("WHATSAPP"), "WhatsApp");
    assert.equal(crmContactChannelLabel("PHONE"), "Telefone");
    assert.equal(crmContactChannelLabel("EMAIL"), "E-mail");
    assert.equal(crmContactChannelLabel("VISIT"), "Visita");
    assert.equal(crmContactChannelLabel("MEETING"), "Reunião");
    assert.equal(crmContactChannelLabel("VIDEO_CALL"), "Videochamada");
    assert.deepEqual(
      CRM_CONTACT_REASON_OPTIONS.map((o) => o.label),
      [
        "Prospecção",
        "Acompanhamento",
        "Proposta",
        "Negociação",
        "Pós-venda",
        "Reativação",
        "Reclamação",
        "Relacionamento",
        "Outros",
      ]
    );
    assert.equal(crmContactStatusLabel("DONE"), "Concluído");
    assert.equal(crmContactStatusLabel("OPEN"), "Aberto");
    assert.equal(crmContactStatusLabel("PENDING"), "Pendente");
    assert.equal(crmContactStatusLabel("SCHEDULED"), "Agendado");
    assert.equal(crmContactStatusLabel("CANCELED"), "Cancelado");
    assert.equal(crmContactStatusLabel("CANCELLED"), "Cancelado");
    assert.equal(crmContactStatusLabel("WAITING"), "Aguardando");
  });

  it("nenhum rótulo do catálogo parece código (MAIÚSCULAS_COM_SUBLINHADO)", () => {
    const all = [
      ...CRM_CONTACT_CHANNEL_OPTIONS.map((o) => o.label),
      ...CRM_CONTACT_REASON_OPTIONS.map((o) => o.label),
      ...Object.values(CRM_CONTACT_RESULT_LABELS),
      ...Object.values(CRM_CONTACT_RESULT_OPTIONS_BY_REASON).flatMap((list) => list.map((o) => o.label)),
      ...CRM_NEXT_ACTION_OPTIONS.map((o) => o.label),
    ];
    for (const label of all) {
      assert.doesNotMatch(label, /^[A-Z0-9_]+$/, label);
      assert.doesNotMatch(label, /_/, label);
    }
  });

  it("código desconhecido (dado antigo) aparece como está; vazio vira null", () => {
    assert.equal(crmContactResultLabel("Cliente pediu desconto de 5%"), "Cliente pediu desconto de 5%");
    assert.equal(crmContactChannelLabel(""), null);
    assert.equal(crmContactReasonLabel(null), null);
    assert.equal(crmActivityTypeLabel("CONTACT"), "Contato");
    assert.equal(crmActivityTypeLabel("FOLLOW_UP"), "Acompanhamento");
    assert.equal(crmActivityTypeLabel(null), "Contato");
  });
});

describe("13–20. resultados por motivo (matriz comercial)", () => {
  it("13. Prospecção", () => {
    assert.deepEqual(labels("PROSPECTION"), [
      "Cliente demonstrou interesse",
      "Sem interesse no momento",
      "Solicitar retorno posterior",
      "Solicita apresentação ou catálogo",
      "Solicita orçamento",
      "Não foi possível contato",
      "Contato inválido",
    ]);
  });
  it("14. Acompanhamento", () => {
    assert.deepEqual(labels("FOLLOW_UP"), [
      "Cliente respondeu",
      "Aguardando decisão do cliente",
      "Solicita novo contato",
      "Solicita revisão de proposta",
      "Negociação avançou",
      "Negociação encerrada",
      "Não foi possível contato",
    ]);
  });
  it("15. Proposta", () => {
    assert.deepEqual(labels("PROPOSAL"), [
      "Proposta apresentada",
      "Proposta aceita",
      "Proposta recusada",
      "Solicita revisão de preço",
      "Solicita revisão de prazo",
      "Solicita alteração de quantidade",
      "Aguardando aprovação interna do cliente",
      "Aguardando retorno",
    ]);
  });
  it("16. Negociação", () => {
    assert.deepEqual(labels("NEGOTIATION"), [
      "Negociação avançou",
      "Negociação fechada",
      "Negociação perdida",
      "Cliente solicitou desconto",
      "Cliente solicitou condição de pagamento",
      "Cliente solicitou prazo de entrega",
      "Aguardando decisão",
      "Retomar posteriormente",
    ]);
  });
  it("17. Pós-venda", () => {
    assert.deepEqual(labels("POST_SALE"), [
      "Cliente satisfeito",
      "Cliente com dúvida",
      "Cliente relatou problema",
      "Necessita suporte",
      "Nova oportunidade identificada",
      "Solicita novo pedido",
      "Sem ação necessária",
    ]);
  });
  it("18. Reativação", () => {
    assert.deepEqual(labels("REACTIVATION"), [
      "Cliente reativado / interessado",
      "Solicita orçamento",
      "Solicita contato posterior",
      "Sem demanda no momento",
      "Não deseja retomar",
      "Não foi possível contato",
    ]);
  });
  it("19. Reclamação", () => {
    assert.deepEqual(labels("COMPLAINT"), [
      "Reclamação resolvida",
      "Em análise",
      "Encaminhada para qualidade",
      "Encaminhada para logística",
      "Encaminhada para financeiro",
      "Necessita retorno ao cliente",
    ]);
  });
  it("20. Outros (e Relacionamento)", () => {
    assert.deepEqual(labels("OTHER"), [
      "Assunto resolvido",
      "Necessita acompanhamento",
      "Necessita encaminhamento interno",
      "Aguardando cliente",
      "Outro resultado",
    ]);
    assert.deepEqual(labels("RELATIONSHIP"), [
      "Relacionamento mantido",
      "Nova oportunidade identificada",
      "Cliente solicita contato posterior",
      "Cliente sem demanda no momento",
      "Necessita acompanhamento",
    ]);
  });
  it("mesmo sentido = mesmo código entre motivos (relatórios agregam)", () => {
    const code = (reason: string, label: string) =>
      crmContactResultOptions(reason).find((o) => o.label === label)?.code;
    assert.equal(code("PROSPECTION", "Não foi possível contato"), "UNREACHABLE");
    assert.equal(code("FOLLOW_UP", "Não foi possível contato"), "UNREACHABLE");
    assert.equal(code("REACTIVATION", "Não foi possível contato"), "UNREACHABLE");
    assert.equal(code("RELATIONSHIP", "Cliente sem demanda no momento"), "NO_DEMAND_NOW");
    assert.equal(code("REACTIVATION", "Sem demanda no momento"), "NO_DEMAND_NOW");
    // O rótulo acompanha a redação do motivo do contato.
    assert.equal(crmContactResultLabel("NO_DEMAND_NOW", "RELATIONSHIP"), "Cliente sem demanda no momento");
    assert.equal(crmContactResultLabel("NO_DEMAND_NOW", "REACTIVATION"), "Sem demanda no momento");
    assert.equal(crmContactResultLabel("UNREACHABLE"), "Não foi possível contato");
  });
});

describe("21–23. próxima ação por motivo e troca de motivo", () => {
  it("23. lista sugerida por motivo, sempre com 'Nenhuma ação necessária'", () => {
    assert.deepEqual(actionLabels("PROSPECTION"), [
      "Telefonar novamente",
      "Enviar WhatsApp",
      "Enviar e-mail",
      "Enviar catálogo",
      "Enviar apresentação",
      "Preparar orçamento",
      "Visitar cliente",
      "Aguardar retorno do cliente",
      "Nenhuma ação necessária",
    ]);
    assert.deepEqual(actionLabels("FOLLOW_UP"), [
      "Telefonar novamente",
      "Enviar WhatsApp",
      "Enviar e-mail",
      "Revisar proposta",
      "Aguardar retorno do cliente",
      "Visitar cliente",
      "Nenhuma ação necessária",
    ]);
    assert.deepEqual(actionLabels("PROPOSAL"), [
      "Enviar proposta",
      "Revisar proposta",
      "Negociar preço",
      "Negociar prazo de pagamento",
      "Telefonar novamente",
      "Aguardar retorno do cliente",
      "Confirmar pedido",
      "Nenhuma ação necessária",
    ]);
    assert.deepEqual(actionLabels("NEGOTIATION"), [
      "Negociar preço",
      "Negociar prazo de pagamento",
      "Revisar proposta",
      "Telefonar novamente",
      "Confirmar pedido",
      "Aguardar retorno do cliente",
      "Nenhuma ação necessária",
    ]);
    assert.deepEqual(actionLabels("POST_SALE"), [
      "Realizar pós-venda",
      "Acompanhar pedido",
      "Verificar entrega",
      "Encaminhar para suporte",
      "Telefonar novamente",
      "Nenhuma ação necessária",
    ]);
    assert.deepEqual(actionLabels("REACTIVATION"), [
      "Telefonar novamente",
      "Enviar WhatsApp",
      "Enviar catálogo",
      "Preparar orçamento",
      "Reativar cliente",
      "Visitar cliente",
      "Aguardar retorno do cliente",
      "Nenhuma ação necessária",
    ]);
    assert.deepEqual(actionLabels("COMPLAINT"), [
      "Encaminhar para suporte",
      "Encaminhar para qualidade",
      "Encaminhar para logística",
      "Encaminhar para financeiro",
      "Telefonar novamente",
      "Aguardar retorno do cliente",
      "Nenhuma ação necessária",
    ]);
    for (const reason of CRM_CONTACT_REASON_OPTIONS) {
      assert.ok(
        crmNextActionOptions(reason.code).some((o) => o.code === CRM_NEXT_ACTION_NONE),
        reason.code
      );
    }
    assert.equal(crmNextActionOptions("OTHER").length, CRM_NEXT_ACTION_OPTIONS.length);
    assert.equal(crmNextActionLabel("ROUTE_TO_ENGINEERING"), "Encaminhar para engenharia");
  });

  it("21. trocar o motivo limpa resultado e ação que não valem mais", () => {
    assert.deepEqual(
      reconcileCrmContactReasonChange({
        reason: "COMPLAINT",
        result: "PROPOSAL_PRESENTED",
        nextActionType: "SEND_PROPOSAL",
      }),
      { result: "", nextActionType: "" }
    );
    // O que continua válido é preservado.
    assert.deepEqual(
      reconcileCrmContactReasonChange({
        reason: "NEGOTIATION",
        result: "NEGOTIATION_ADVANCED",
        nextActionType: CRM_NEXT_ACTION_NONE,
      }),
      { result: "NEGOTIATION_ADVANCED", nextActionType: CRM_NEXT_ACTION_NONE }
    );
  });

  it("linha da próxima ação combina rótulo e detalhamento", () => {
    assert.equal(crmNextActionSummary("SEND_PROPOSAL", "Prazo 45 dias"), "Enviar proposta — Prazo 45 dias");
    assert.equal(crmNextActionSummary(null, "Ligar sexta"), "Ligar sexta");
    assert.equal(crmNextActionSummary("NONE", null), "Nenhuma ação necessária");
    assert.equal(crmNextActionSummary(null, "  "), null);
  });
});
