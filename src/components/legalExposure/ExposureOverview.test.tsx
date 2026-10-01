import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExposureOverview } from "./ExposureOverview";

describe("ExposureOverview", () => {
  it("mostra cockpit jurídico, atenção agora e panorama por empresa", () => {
    const html = renderToStaticMarkup(
      <ExposureOverview
        dashboard={{
          cards: {
            actionRequired: 2,
            monitoredCases: 12,
            pendingCommunications: 1,
            newsToday: 1,
            news7Days: 4,
            passiveCases: 9,
            futureHearings: 3,
            knownClaimCount: 5,
            knownClaimTotalFormatted: "R$ 168.127,48",
          },
          lastUpdatedAt: "2026-09-30T17:50:00.000Z",
          dataQuality: {
            claimantIdentifiedPct: 78,
            groupPolesIdentifiedPct: 91,
            claimValuePct: 54,
            datajudEnrichedPct: 82,
          },
          attentionNow: [
            {
              id: "att-1",
              type: "Citação",
              company: "Lazarios",
              processNumber: "0001384-86.2026.5.09.0009",
              description: "Nova citação identificada no DJEN.",
              at: "2026-09-30T14:30:00.000Z",
              caseId: "case-1",
              channel: "LEGAL",
            },
          ],
          absenceIsNotClearance: "Ausência de processo conhecido não significa ausência de risco.",
          emptyState: null,
          entities: [
            {
              id: "ent-lazarios",
              legalName: "Lazarios",
              cnpj: "11.222.333/0001-81",
              monitoredCases: 7,
              polePassive: 6,
              poleActive: 0,
              actionRequired: 2,
              lastSuccessfulSyncAt: "2026-09-30T17:50:00.000Z",
              knownClaimTotalFormatted: "R$ 168.127,48",
            },
            {
              id: "ent-koppetel",
              legalName: "Koppetel",
              cnpj: "22.333.444/0001-92",
              monitoredCases: 4,
              polePassive: 3,
              poleActive: 1,
              actionRequired: 0,
              lastSuccessfulSyncAt: null,
              knownClaimTotalFormatted: null,
            },
            {
              id: "ent-sm",
              legalName: "SM",
              cnpj: "33.444.555/0001-03",
              monitoredCases: 1,
              polePassive: 0,
              poleActive: 0,
              actionRequired: 0,
              lastSuccessfulSyncAt: null,
              knownClaimTotalFormatted: null,
            },
          ],
        }}
        onOpenAction={() => {}}
        onOpenCases={() => {}}
        onOpenCase={() => {}}
        onExecutiveReport={() => {}}
      />
    );
    assert.ok(html.includes("Exposição jurídica"));
    assert.ok(html.includes("Processos únicos"));
    assert.ok(html.includes("Atenção agora"));
    assert.ok(html.includes("Panorama por empresa"));
    assert.ok(html.includes("Qualidade da informação"));
    assert.ok(html.includes("Reclamante identificado: 78%"));
    assert.ok(html.includes("Lazarios"));
    assert.ok(html.includes("Koppetel"));
    assert.ok(html.includes("SM"));
    assert.ok(html.includes("Ver processo"));
    assert.ok(html.includes("Ver processos"));
    assert.ok(html.includes("Relatório executivo"));
    assert.equal(html.includes("<table"), false);
  });
});
