import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerCreditOccurrenceHistoryView } from "./CustomerCreditOccurrenceHistory";
import { presentCommercialCreditOccurrence } from "@/src/lib/commercial/commercialCreditOccurrence";

const TODAY = new Date(2026, 9, 19, 12, 0, 0);

function row(kind: "PROTEST_FORWARDED" | "PROTEST_CONFIRMED", status: "OPEN" | "CONFIRMED_PENDING") {
  return presentCommercialCreditOccurrence({
    id: kind === "PROTEST_FORWARDED" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    kind,
    status,
    origin: "MANUAL",
    occurredAt: TODAY,
    titleExternalId: 9,
    responsibleUserId: "44444444-4444-4444-8444-444444444444",
    justification: "Registro do financeiro sobre o título oficial.",
    closedAt: null,
  });
}

describe("histórico de ocorrências de crédito", () => {
  it("mostra encaminhamento e protesto confirmado sem formulário para quem não gere", () => {
    const html = renderToStaticMarkup(
      <CustomerCreditOccurrenceHistoryView
        occurrences={[row("PROTEST_FORWARDED", "OPEN"), row("PROTEST_CONFIRMED", "CONFIRMED_PENDING")]}
        canManage={false}
      />
    );
    assert.match(html, /Título encaminhado para protesto/);
    assert.match(html, /Protesto confirmado/);
    assert.match(html, /Pendência crítica de crédito/);
    assert.match(html, /Título 9/);
    assert.equal(html.includes("Registrar ocorrência"), false);
    assert.equal((html.match(/Pendência crítica de crédito/g) ?? []).length, 1);
  });

  it("exibe o registro apenas para permissão atribuída de Financeiro ou Diretoria", () => {
    const html = renderToStaticMarkup(
      <CustomerCreditOccurrenceHistoryView
        occurrences={[]}
        canManage
        onCreate={async () => undefined}
      />
    );
    assert.match(html, /Registrar ocorrência/);
    assert.match(html, /Sem ocorrência registrada/);
  });
});
