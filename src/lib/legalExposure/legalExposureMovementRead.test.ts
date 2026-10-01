import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyExposureAction, extractExplicitDeadline } from "./legalExposureActionClassifier.js";
import {
  compareTimelineAsc,
  compareTimelineDesc,
  enrichTimelineItems,
  isMovementNew,
  LEGAL_EXPOSURE_MOVEMENT_NOVELTY_BASELINE,
} from "./legalExposureMovementExecutive.js";
import type { ExposureTimelineItem } from "./legalExposureContracts.js";

function item(partial: Partial<ExposureTimelineItem> & Pick<ExposureTimelineItem, "id" | "at" | "title">): ExposureTimelineItem {
  return {
    kind: "movement",
    description: null,
    source: "DATAJUD",
    sourceCode: null,
    courtUnit: null,
    complements: null,
    communicationType: null,
    subject: null,
    status: null,
    detectedAt: partial.detectedAt ?? partial.at,
    occurredAt: partial.occurredAt ?? partial.at,
    ...partial,
  };
}

describe("legalExposure movement order", () => {
  it("UI descende A B C e PDF sobe C B A", () => {
    const rows = enrichTimelineItems([
      item({ id: "a", at: "2026-10-01T10:00:00.000Z", title: "A" }),
      item({ id: "b", at: "2026-09-30T10:00:00.000Z", title: "B" }),
      item({ id: "c", at: "2026-09-29T10:00:00.000Z", title: "C" }),
    ]);
    const ui = rows.slice().sort(compareTimelineDesc).map((row) => row.title);
    const pdf = rows.slice().sort(compareTimelineAsc).map((row) => row.title);
    assert.deepEqual(ui, ["A", "B", "C"]);
    assert.deepEqual(pdf, ["C", "B", "A"]);
  });
});

describe("legalExposure isNew", () => {
  it("marca novo quando firstSeenAt é posterior à última revisão", () => {
    assert.equal(
      isMovementNew({ firstSeenAt: "2026-10-01T09:00:00.000Z", lastMovementsReadAt: "2026-10-01T08:00:00.000Z" }),
      true
    );
    assert.equal(
      isMovementNew({ firstSeenAt: "2026-09-30T10:00:00.000Z", lastMovementsReadAt: "2026-10-01T08:00:00.000Z" }),
      false
    );
  });

  it("movimento antigo descoberto hoje é novo", () => {
    assert.equal(
      isMovementNew({
        firstSeenAt: "2026-10-01T10:00:00.000Z",
        lastMovementsReadAt: "2026-10-01T08:00:00.000Z",
      }),
      true
    );
    const rows = enrichTimelineItems(
      [
        item({
          id: "old",
          at: "2026-09-20T10:00:00.000Z",
          occurredAt: "2026-09-20T10:00:00.000Z",
          detectedAt: "2026-10-01T10:00:00.000Z",
          title: "Intimação antiga descoberta hoje",
        }),
      ],
      { lastMovementsReadAt: "2026-10-01T08:00:00.000Z" }
    );
    assert.equal(rows[0]?.isNew, true);
  });

  it("estado de leitura é por usuário", () => {
    const movement = item({
      id: "m1",
      at: "2026-10-01T12:00:00.000Z",
      detectedAt: "2026-10-01T12:00:00.000Z",
      title: "Intimação",
    });
    const userA = enrichTimelineItems([movement], { lastMovementsReadAt: "2026-10-01T13:00:00.000Z" });
    const userB = enrichTimelineItems([movement], { lastMovementsReadAt: null, baseline: "2026-10-01T11:00:00.000Z" });
    assert.equal(userA[0]?.isNew, false);
    assert.equal(userB[0]?.isNew, true);
  });

  it("histórico pré-implantação não aparece todo como novo", () => {
    const rows = enrichTimelineItems(
      [
        item({
          id: "hist",
          at: "2025-01-10T10:00:00.000Z",
          detectedAt: "2025-01-10T10:00:00.000Z",
          title: "Distribuição antiga",
        }),
      ],
      { lastMovementsReadAt: null, baseline: LEGAL_EXPOSURE_MOVEMENT_NOVELTY_BASELINE }
    );
    assert.equal(rows[0]?.isNew, false);
  });
});

describe("legalExposure action classifier", () => {
  it("classifica conclusos, intimação, audiência e prazo sem calcular dias úteis", () => {
    assert.equal(classifyExposureAction({ title: "Conclusos para decisão" }).actionLevel, "NONE");
    assert.equal(classifyExposureAction({ title: "Intimação" }).actionLevel, "REVIEW");
    const hearing = classifyExposureAction({
      kind: "hearing",
      title: "Audiência designada para 12/11/2026",
      scheduledAt: "2026-11-12T14:18:00.000Z",
    });
    assert.equal(hearing.actionLevel, "DEADLINE_OR_EVENT");
    const prazo = classifyExposureAction({ title: "Intimação no prazo de 5 dias úteis" });
    assert.equal(prazo.actionLevel, "DEADLINE_OR_EVENT");
    assert.equal(prazo.deadlineText, "5 dias úteis");
    assert.equal(prazo.deadlineAt, null);
    const extracted = extractExplicitDeadline("apresentar defesa até 12/11/2026");
    assert.equal(extracted?.deadlineAt, "2026-11-12T12:00:00.000-03:00");
  });
});
