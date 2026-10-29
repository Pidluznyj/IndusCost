import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreditScoreDashboard,
  EMPTY_BUREAU_SNAPSHOT,
  bureauSourceRows,
  pickHeadlineScore,
  scoreBand,
  type BureauSnapshot,
} from "./CreditScoreDashboard";
import { buildCommercialCreditIntelligenceView, notConsultedCommercialCreditView } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import { decideCommercialCredit } from "@/src/lib/commercial/commercialCreditDecision";
import type { CommercialDelinquencyAnalysis } from "@/src/lib/commercial/customerDelinquencyAnalysis";

function clear(): CommercialDelinquencyAnalysis {
  return {
    status: "REGULAR",
    unknownReason: null,
    overdueTitleCount: 0,
    overdueAmount: 0,
    openAmount: 0,
    maxDaysOverdue: 0,
    lastSyncedAt: "2026-10-19T12:00:00.000Z",
    overdueTitles: [],
    evidence: {
      source: "NomusAccountsReceivable",
      toleranceDays: 0,
      toleranceUnit: "CALENDAR_DAYS",
      referenceDate: "2026-10-19",
      cnpj: "11444777000161",
      nomusPersonId: 100,
      identity: "RESOLVED",
      syncRunStatus: "SUCCESS",
      payloadComplete: true,
      sourceMaxSyncedAt: "2026-10-19T12:00:00.000Z",
      includedTitleIds: [],
      overdueTitleIds: [],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
    },
  };
}

function releasedCredit() {
  const delinquency = clear();
  const decision = decideCommercialCredit({
    customerId: "11111111-1111-4111-8111-111111111111",
    enforcement: "CREDIT_GRANT",
    paymentTerms: "30",
    delinquency,
    cadastral: { score: 74, verdict: null },
    now: new Date(2026, 9, 19, 12, 0, 0),
  });
  return buildCommercialCreditIntelligenceView({ decision, delinquency, externalProtest: "ABSENT", revealFinancial: true });
}

const boaVista = (over: Partial<NonNullable<BureauSnapshot["boaVista"]>> = {}): BureauSnapshot["boaVista"] => ({
  state: "VALID",
  stateLabel: "Válida",
  simulated: false,
  score: 812,
  scoreRaw: "812",
  scoreClass: "B",
  defaultProbability: "3,2%",
  suggestedLimitCents: 4_500_000,
  consultedAt: "2026-10-28T13:00:00.000Z",
  ...over,
});

describe("Painel de crédito da Ficha CNPJ", () => {
  it("faixas de referência 0–1000; fora da faixa ou sem número não posiciona o ponteiro", () => {
    assert.equal(scoreBand(120)?.label, "Risco muito alto");
    assert.equal(scoreBand(300)?.label, "Risco muito alto");
    assert.equal(scoreBand(301)?.label, "Risco alto");
    assert.equal(scoreBand(650)?.label, "Risco moderado");
    assert.equal(scoreBand(701)?.label, "Risco baixo");
    assert.equal(scoreBand(1000)?.label, "Risco baixo");
    assert.equal(scoreBand(1001), null);
    assert.equal(scoreBand(-1), null);
    assert.equal(scoreBand(null), null);
  });

  it("score principal: Boa Vista válida > QUOD válido > nenhum; simulação identificada", () => {
    assert.equal(pickHeadlineScore(EMPTY_BUREAU_SNAPSHOT), null);
    const quodOnly: BureauSnapshot = { ...EMPTY_BUREAU_SNAPSHOT, quod: { state: "VALID", score: 540, consultedAt: null } };
    assert.equal(pickHeadlineScore(quodOnly)?.provider, "QUOD");
    const both: BureauSnapshot = { ...quodOnly, boaVista: boaVista() };
    assert.equal(pickHeadlineScore(both)?.provider, "Boa Vista · LIKE SERASA");
    assert.equal(pickHeadlineScore(both)?.raw, "812");
    const expired: BureauSnapshot = { ...quodOnly, boaVista: boaVista({ state: "EXPIRED" }) };
    assert.equal(pickHeadlineScore(expired)?.provider, "QUOD", "Boa Vista vencida não vira score principal");
    const demo: BureauSnapshot = { ...EMPTY_BUREAU_SNAPSHOT, boaVista: boaVista({ simulated: true }) };
    assert.match(pickHeadlineScore(demo)!.provider, /simulação/);
  });

  it("renderiza velocímetro, decisão do motor, limite sugerido e as fontes por tipo de consulta", () => {
    const snapshot: BureauSnapshot = {
      boaVista: boaVista(),
      quod: { state: "NOT_CONSULTED", score: null, consultedAt: null },
      ieptb: { state: "VALID", label: "Ocorrência encontrada", count: 2, totalAmount: 1500.5, consultedAt: null },
    };
    const html = renderToStaticMarkup(
      <CreditScoreDashboard credit={releasedCredit()} creditLoading={false} creditError={null} snapshot={snapshot} cadastralScore="74/100" />
    );
    assert.match(html, /data-testid="credit-score-gauge" data-score-band="Risco baixo"/);
    assert.match(html, /data-testid="credit-score-value"[^>]*>812</);
    assert.match(html, /credit-score-marker/, "marcador posicionado na faixa");
    assert.match(html, /Classe B/);
    assert.match(html, /o provedor não declara a escala no retorno/);
    assert.match(html, /R\$\s?45\.000,00/);
    assert.match(html, /3,2%/);
    assert.match(html, /data-testid="credit-source-ieptb" data-source-state="alert"/);
    assert.match(html, /data-testid="credit-source-quod" data-source-state="na"/);
    assert.match(html, /data-testid="credit-source-cadastral" data-source-state="ok"/);
    for (const group of ["Interna", "Bureau", "Protestos", "Cadastral"]) assert.match(html, new RegExp(`>${group}<`));
  });

  it("sem bureau e com erro de crédito: sem ponteiro, 'Sem score externo' e decisão não determinada", () => {
    const html = renderToStaticMarkup(
      <CreditScoreDashboard credit={null} creditLoading={false} creditError="falhou" snapshot={EMPTY_BUREAU_SNAPSHOT} cadastralScore={null} />
    );
    assert.match(html, /data-score-band="SEM_FAIXA"/);
    assert.match(html, /Sem score externo/);
    assert.doesNotMatch(html, /credit-score-marker/, "nenhum marcador");
    assert.match(html, /data-decision-state="NAO_DETERMINADO"/);
    assert.match(html, /CRÉDITO NÃO DETERMINADO/);
    const rows = bureauSourceRows(null, "falhou", EMPTY_BUREAU_SNAPSHOT, null);
    assert.deepEqual(rows.map((r) => r.state), ["pending", "na", "na", "na", "na"]);
  });

  it("score fora de 0–1000 é exibido como veio, sem ponteiro", () => {
    const html = renderToStaticMarkup(
      <CreditScoreDashboard
        credit={notConsultedCommercialCreditView()}
        creditLoading={false}
        creditError={null}
        snapshot={{ ...EMPTY_BUREAU_SNAPSHOT, quod: { state: "VALID", score: 4321, consultedAt: null } }}
        cadastralScore={null}
      />
    );
    assert.match(html, />4321</);
    assert.match(html, /Fora da faixa de referência/);
    assert.doesNotMatch(html, /credit-score-marker/);
  });
});
