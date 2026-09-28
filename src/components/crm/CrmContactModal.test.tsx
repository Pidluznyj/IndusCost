/**
 * Modal "Registrar contato": formulário puro (crmContactForm) e a tela
 * (CrmContactModalView) renderizada estaticamente. Numeração = lista de testes
 * obrigatórios do spec.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CrmContactModalView, type CrmContactModalViewProps } from "./CrmContactModal";
import {
  applyCrmContactFieldChange,
  buildCrmContactPayload,
  crmContactDerivedStatusText,
  initialCrmContactForm,
  validateCrmContactForm,
  type CrmContactFormState,
  type CrmContactModalContext,
} from "./crmContactForm";

const CONTEXT: CrmContactModalContext = {
  customer: {
    id: "0f0f0f0f-0000-4000-8000-000000000001",
    displayName: "Metalúrgica Alfa Ltda",
    taxId: "12.345.678/0001-90",
    phone: "(11) 3333-4444",
    email: "compras@alfa.com.br",
  },
  commercialOwner: { name: "Carla Mendes", identityKey: "CARLA MENDES", externalSellerId: 17 },
  registeredBy: { id: "a1a1a1a1-0000-4000-8000-000000000001", name: "Ana Souza" },
};

const NOW = new Date(2026, 8, 28, 10, 0);

function form(over: Partial<CrmContactFormState> = {}): CrmContactFormState {
  return { ...initialCrmContactForm(CONTEXT, NOW), ...over };
}

function render(over: Partial<CrmContactModalViewProps> = {}): string {
  return renderToStaticMarkup(
    <CrmContactModalView
      idPrefix="t"
      customer={{ id: CONTEXT.customer.id }}
      load={{ phase: "ready", context: CONTEXT }}
      form={form()}
      errors={{}}
      submitError={null}
      saving={false}
      onChange={() => {}}
      onSubmit={() => {}}
      onCancel={() => {}}
      onRetry={() => {}}
      {...over}
    />
  );
}

/** Tag de abertura do elemento com o id (atributos na ordem do React). */
function tagOf(html: string, id: string): string {
  const match = html.match(new RegExp(`<(input|select|textarea)[^>]*id="${id}"[^>]*>`));
  assert.ok(match, `elemento #${id} não encontrado`);
  return match[0];
}

function optionTexts(html: string, id: string): string[] {
  const start = html.indexOf(`id="${id}"`);
  const end = html.indexOf("</select>", start);
  return [...html.slice(start, end).matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]!);
}

describe("formulário (regras sem React)", () => {
  it("7/8. telefone e e-mail vêm do cadastro; resultado e próxima ação começam vazios", () => {
    const state = initialCrmContactForm(CONTEXT, NOW);
    assert.equal(state.phoneUsed, "(11) 3333-4444");
    assert.equal(state.emailUsed, "compras@alfa.com.br");
    assert.equal(state.result, "");
    assert.equal(state.nextActionType, "");
    assert.equal(state.contactDate, "2026-09-28T10:00");
  });

  it("21. trocar o motivo limpa resultado e próxima ação incompatíveis", () => {
    const before = form({ reason: "PROPOSAL", result: "PROPOSAL_ACCEPTED", nextActionType: "SEND_PROPOSAL" });
    const after = applyCrmContactFieldChange(before, "reason", "COMPLAINT");
    assert.equal(after.reason, "COMPLAINT");
    assert.equal(after.result, "");
    assert.equal(after.nextActionType, "");
  });

  it("26/27. 'Nenhuma ação necessária' limpa a data e o payload leva null", () => {
    const withDate = form({ nextActionType: "CALL_AGAIN", nextActionAt: "2026-10-02T10:00" });
    const none = applyCrmContactFieldChange(withDate, "nextActionType", "NONE");
    assert.equal(none.nextActionAt, "");
    assert.equal(buildCrmContactPayload(none).nextActionAt, null);
  });

  it("4/6. o payload nunca leva responsável, usuário ou status", () => {
    const payload = buildCrmContactPayload(form());
    for (const key of [
      "assignedTo",
      "commercialOwnerIdentityKey",
      "commercialOwnerExternalSellerId",
      "createdByUserId",
      "createdByName",
      "status",
    ]) {
      assert.equal(key in payload, false, key);
    }
  });

  it("22/24/25. obrigatórios apontados antes de enviar", () => {
    const errors = validateCrmContactForm(form({ nextActionType: "CALL_AGAIN" }));
    assert.ok(errors.result);
    assert.ok(errors.summary);
    assert.ok(errors.nextActionAt);
    assert.ok(errors.nextActionDescription);
    assert.deepEqual(validateCrmContactForm(form({ nextActionType: "" })).nextActionType, "Selecione a próxima ação.");
  });

  it("33. status mostrado = status que o servidor grava", () => {
    assert.equal(crmContactDerivedStatusText("SEND_PROPOSAL"), "Aberto — próxima ação pendente");
    assert.equal(crmContactDerivedStatusText("NONE"), "Concluído — sem próxima ação");
    assert.equal(crmContactDerivedStatusText(""), null);
  });
});

describe("tela do modal", () => {
  it("1/2/3/5. cliente no cabeçalho; responsável e 'registrado por' preenchidos e bloqueados", () => {
    const html = render();
    assert.match(html, /Registrar contato/);
    assert.match(html, /Metalúrgica Alfa Ltda · 12\.345\.678\/0001-90/);
    const ownerTag = tagOf(html, "t-commercialOwner");
    assert.match(ownerTag, /readOnly=""|readonly=""/);
    assert.match(ownerTag, /value="Carla Mendes"/);
    const userTag = tagOf(html, "t-registeredBy");
    assert.match(userTag, /readOnly=""|readonly=""/);
    assert.match(userTag, /value="Ana Souza"/);
  });

  it("cliente sem responsável mostra o estado claro", () => {
    const html = render({ load: { phase: "ready", context: { ...CONTEXT, commercialOwner: null } } });
    assert.match(tagOf(html, "t-commercialOwner"), /value="Cliente sem responsável comercial"/);
  });

  it("7/8/9/10. telefone e e-mail preenchidos, editáveis e avisando que não mudam o cadastro", () => {
    const html = render();
    const phone = tagOf(html, "t-phoneUsed");
    assert.match(phone, /value="\(11\) 3333-4444"/);
    assert.doesNotMatch(phone, / (readOnly|readonly|disabled)=""/);
    const email = tagOf(html, "t-emailUsed");
    assert.match(email, /value="compras@alfa.com.br"/);
    assert.doesNotMatch(email, / (readOnly|readonly|disabled)=""/);
    assert.match(html, /Alterar aqui vale só para este contato\./);
  });

  it("12. selects em pt-BR, sem nenhum código técnico visível", () => {
    const html = render({ form: form({ nextActionType: "SEND_PROPOSAL", reason: "PROPOSAL" }) });
    assert.deepEqual(optionTexts(html, "t-channel"), [
      "WhatsApp",
      "Telefone",
      "E-mail",
      "Reunião",
      "Visita",
      "Videochamada",
      "Outro",
    ]);
    assert.ok(optionTexts(html, "t-reason").includes("Pós-venda"));
    const visibleText = html.replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(
      visibleText,
      /\b(WHATSAPP|VIDEO_CALL|PROSPECTION|FOLLOW_UP|PROPOSAL|NEGOTIATION|POST_SALE|REACTIVATION|COMPLAINT|RELATIONSHIP|DONE|OPEN|NONE|SEND_PROPOSAL|PROPOSAL_PRESENTED)\b/
    );
  });

  it("15/23. resultado e próxima ação seguem o motivo", () => {
    const html = render({ form: form({ reason: "PROPOSAL" }) });
    assert.deepEqual(optionTexts(html, "t-result"), [
      "Selecione o resultado…",
      "Proposta apresentada",
      "Proposta aceita",
      "Proposta recusada",
      "Solicita revisão de preço",
      "Solicita revisão de prazo",
      "Solicita alteração de quantidade",
      "Aguardando aprovação interna do cliente",
      "Aguardando retorno",
    ]);
    assert.equal(optionTexts(html, "t-nextActionType")[1], "Enviar proposta");
    assert.equal(optionTexts(html, "t-nextActionType").at(-1), "Nenhuma ação necessária");
  });

  it("24/25. ação real: data e detalhamento obrigatórios e habilitados", () => {
    const html = render({ form: form({ nextActionType: "SEND_PROPOSAL" }) });
    assert.doesNotMatch(tagOf(html, "t-nextActionAt"), / disabled=""/);
    assert.match(html, /Data\/hora da próxima ação<span[^>]*> \*<\/span>/);
    assert.match(html, /Detalhamento da próxima ação<span[^>]*> \*<\/span>/);
    assert.match(tagOf(html, "t-status"), /value="Aberto — próxima ação pendente"/);
  });

  it("26. 'Nenhuma ação necessária': data vazia e desabilitada, detalhamento opcional", () => {
    const html = render({ form: form({ nextActionType: "NONE", nextActionAt: "2026-10-02T10:00" }) });
    const date = tagOf(html, "t-nextActionAt");
    assert.match(date, / disabled=""/);
    assert.match(date, /value=""/);
    assert.match(html, /Detalhamento da próxima ação \(opcional\)/);
    assert.match(tagOf(html, "t-status"), /value="Concluído — sem próxima ação"/);
  });

  it("erros ficam junto do campo (aria-invalid + mensagem ligada)", () => {
    const html = render({ errors: { result: "Selecione o resultado do contato." } });
    const select = tagOf(html, "t-result");
    assert.match(select, /aria-invalid="true"/);
    assert.match(select, /aria-describedby="t-result-error"/);
    assert.match(html, /<p id="t-result-error" role="alert"[^>]*>Selecione o resultado do contato\.<\/p>/);
  });

  it("salvando: botões travados (sem dupla submissão)", () => {
    const html = render({ saving: true });
    assert.match(html, /<button type="submit" disabled=""[^>]*>.*Salvando…<\/button>/);
    assert.match(html, /<button type="button" disabled=""[^>]*>Cancelar<\/button>/);
  });

  it("carregando e erro de carga", () => {
    assert.match(render({ load: { phase: "loading" }, form: null }), /Carregando dados do cliente…/);
    const failed = render({ load: { phase: "error", message: "Cliente não encontrado." }, form: null });
    assert.match(failed, /Cliente não encontrado\./);
    assert.match(failed, /Tentar novamente/);
  });
});
