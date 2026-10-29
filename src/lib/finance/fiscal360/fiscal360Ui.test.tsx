/**
 * Inteligência Fiscal 360° — componentes visuais compartilhados e formulário de revisão (render estático).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Fiscal360DecisionForm } from "../../../components/finance/fiscal360/Fiscal360Decisions.js";
import { Badge, Callout, DataTable, Drawer, EmptyState, KeyValue, KpiCard, Meter, Pagination, money, pct, statusTone } from "../../../components/finance/fiscal360/Fiscal360Shared.js";

describe("peças visuais da Inteligência Fiscal 360°", () => {
  it("KPI mostra rótulo, valor, dica e fonte (rastreabilidade)", () => {
    const html = renderToStaticMarkup(<KpiCard label="Impostos efetivamente pagos" value="R$ 10,00" hint="contados uma vez" source="FiscalPaymentFact" testId="k" />);
    assert.match(html, /Impostos efetivamente pagos/);
    assert.match(html, /contados uma vez/);
    assert.match(html, /Fonte: FiscalPaymentFact/);
  });

  it("tabela vazia mostra estado vazio explícito (não zero); com linhas, rolagem horizontal e cabeçalhos", () => {
    const empty = renderToStaticMarkup(<DataTable rows={[]} rowKey={() => "x"} columns={[{ key: "a", header: "A", render: () => "" }]} empty="Sem registros." />);
    assert.match(empty, /Sem registros\./);
    const html = renderToStaticMarkup(
      <DataTable
        rows={[{ id: "1", v: 5 }]}
        rowKey={(r) => r.id}
        onRowClick={() => undefined}
        columns={[
          { key: "id", header: "Id", render: (r) => r.id },
          { key: "v", header: "Valor", align: "right", render: (r) => money(r.v) },
        ]}
      />
    );
    assert.match(html, /overflow-x-auto/);
    assert.match(html, /<th[^>]*>Valor<\/th>/);
    assert.match(html, /tabindex="0"/, "linha clicável acessível por teclado");
  });

  it("valores indisponíveis aparecem como traço, nunca como zero", () => {
    assert.equal(money(null), "—");
    assert.equal(pct(undefined), "—");
    assert.notEqual(money(0), "—");
  });

  it("tons de situação: comprovado verde, vencido vermelho, parcial/declarado âmbar", () => {
    assert.equal(statusTone("PAID_PROVEN"), "good");
    assert.equal(statusTone("OVERDUE"), "danger");
    assert.equal(statusTone("PARTIAL"), "warn");
    assert.equal(statusTone("PAID_DECLARED"), "warn");
    assert.equal(statusTone("OPEN"), "info");
    assert.match(renderToStaticMarkup(<Badge tone="danger">x</Badge>), /text-\[#B91C1C\]/);
  });

  it("paginação mostra intervalo e total; botões desabilitam nas bordas", () => {
    const html = renderToStaticMarkup(<Pagination page={1} pageSize={50} total={120} onPage={() => undefined} />);
    assert.match(html, /1–50 de 120/);
    assert.match(html, /1\/3/);
    assert.match(html, /disabled=""[^>]*aria-label="Página anterior"|aria-label="Página anterior"[^>]*disabled=""/);
    assert.match(renderToStaticMarkup(<Pagination page={1} pageSize={50} total={0} onPage={() => undefined} />), /0 registros/);
  });

  it("gaveta é um diálogo modal acessível e só renderiza aberta", () => {
    assert.equal(renderToStaticMarkup(<Drawer open={false} title="t" onClose={() => undefined}>c</Drawer>), "");
    const html = renderToStaticMarkup(<Drawer open title="Detalhe" subtitle="rastro" onClose={() => undefined}>corpo</Drawer>);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-label="Fechar"/);
  });

  it("medidor, chave-valor e avisos", () => {
    assert.match(renderToStaticMarkup(<Meter label="Conciliado" value={82.5} tone="good" />), /role="meter"[^>]*aria-valuenow="82.5"|aria-valuenow="82.5"/);
    assert.match(renderToStaticMarkup(<Meter label="Sem base" value={null} />), /—/);
    assert.match(renderToStaticMarkup(<KeyValue items={[["Empresa", "Koppetel"]]} />), /Koppetel/);
    assert.match(renderToStaticMarkup(<Callout tone="warn">atenção</Callout>), /FFFBEB/);
    assert.match(renderToStaticMarkup(<EmptyState>vazio</EmptyState>), /vazio/);
  });
});

describe("formulário de revisão manual", () => {
  const html = (type: Parameters<typeof Fiscal360DecisionForm>[0]["target"]["decisionType"], extra = {}) =>
    renderToStaticMarkup(<Fiscal360DecisionForm target={{ decisionType: type, ...extra }} onDone={() => undefined} onCancel={() => undefined} />);

  it("exige motivo e avisa que não altera o Nomus; botão de envio começa desabilitado", () => {
    const out = html("AP_CONFIRM_TAX", { apExternalId: 10, suggestedTaxType: "COFINS" });
    assert.match(out, /Motivo e evidência \(obrigatório\)/);
    assert.match(out, /não altera lançamentos do Nomus/);
    assert.match(out, /data-testid="fiscal360-decision-submit"[^>]*disabled=""|disabled=""[^>]*data-testid="fiscal360-decision-submit"/);
  });

  it("campos por tipo: tributo/código/competência; empresa só do grupo; vínculo pede AP/guia faltante", () => {
    assert.match(html("AP_CONFIRM_TAX", { apExternalId: 10 }), /Código de receita/);
    const company = html("ASSIGN_GUIDE_COMPANY", { guideId: "g" });
    assert.match(company, /Lazarios|Koppetel|SM/);
    assert.ok(!/Código de receita/.test(company));
    assert.match(html("LINK_GUIDE_AP", { guideId: "g" }), /Título AP \(id Nomus\)/);
    assert.match(html("LINK_GUIDE_AP", { apExternalId: 10 }), /Guia \(identificador\)/);
  });
});
