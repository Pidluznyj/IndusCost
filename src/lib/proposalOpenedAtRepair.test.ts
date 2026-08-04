/**
 * Reparo de `externalOpenedAt` invertido — CP 01341..01349 e CP 01350 são os
 * casos reais: payload "03/08/2026", gravado 2026-03-08.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideProposalOpenedAtRepair,
  summarizeProposalOpenedAtRepair,
  type ProposalOpenedAtRepairDecision,
} from "./proposalOpenedAtRepair.js";

function row(over: Partial<Parameters<typeof decideProposalOpenedAtRepair>[0]> = {}) {
  return {
    id: "p-1",
    externalProposalCode: "CP 01350",
    sourceSystem: "NOMUS",
    externalOpenedAt: new Date(2026, 2, 8), // 08/03/2026 — o valor corrompido
    externalRawPayload: { dataHoraAbertura: "03/08/2026 00:00:00" },
    ...over,
  };
}

describe("proposalOpenedAtRepair — o defeito real", () => {
  it("CP 01350: payload 03/08 contra gravado 08/03 → reparo", () => {
    const d = decideProposalOpenedAtRepair(row());
    assert.equal(d.kind, "REPAIR");
    if (d.kind !== "REPAIR") return;
    assert.equal(d.storedCivilDate, "2026-03-08");
    assert.equal(d.correctCivilDate, "2026-08-03");
    assert.equal(d.isDayMonthSwap, true);
  });

  it("o valor corrigido é um Date no dia certo", () => {
    const d = decideProposalOpenedAtRepair(row());
    if (d.kind !== "REPAIR") return assert.fail("esperava REPAIR");
    assert.equal(d.correctValue.getDate(), 3);
    assert.equal(d.correctValue.getMonth(), 7); // agosto
    assert.equal(d.correctValue.getFullYear(), 2026);
  });

  it("data já correta não é tocada", () => {
    const d = decideProposalOpenedAtRepair(
      row({ externalOpenedAt: new Date(2026, 7, 3) })
    );
    assert.equal(d.kind, "OK");
  });

  it("divergência que NÃO é inversão dia/mês ainda repara, mas sem a marca", () => {
    const d = decideProposalOpenedAtRepair(
      row({
        externalOpenedAt: new Date(2026, 0, 15),
        externalRawPayload: { dataHoraAbertura: "03/08/2026 00:00:00" },
      })
    );
    assert.equal(d.kind, "REPAIR");
    if (d.kind !== "REPAIR") return;
    assert.equal(d.isDayMonthSwap, false);
  });

  it("dia igual ao mês não é falso positivo de inversão", () => {
    // 08/08 invertido é 08/08 — nada a reparar.
    const d = decideProposalOpenedAtRepair(
      row({
        externalOpenedAt: new Date(2026, 7, 8),
        externalRawPayload: { dataHoraAbertura: "08/08/2026 00:00:00" },
      })
    );
    assert.equal(d.kind, "OK");
  });
});

describe("proposalOpenedAtRepair — nunca reparar no escuro", () => {
  it("proposta sem sourceSystem é ignorada (nasceu no IndusCost)", () => {
    const d = decideProposalOpenedAtRepair(row({ sourceSystem: null }));
    assert.equal(d.kind, "SKIP");
    if (d.kind !== "SKIP") return;
    assert.match(d.reason, /sourceSystem/);
  });

  it("payload sem dataHoraAbertura é ignorado", () => {
    const d = decideProposalOpenedAtRepair(row({ externalRawPayload: {} }));
    assert.equal(d.kind, "SKIP");
    if (d.kind !== "SKIP") return;
    assert.match(d.reason, /não recuperável/i);
  });

  it("payload nulo é ignorado", () => {
    const d = decideProposalOpenedAtRepair(row({ externalRawPayload: null }));
    assert.equal(d.kind, "SKIP");
  });

  it("data inválida no payload é ignorada com o motivo", () => {
    const d = decideProposalOpenedAtRepair(
      row({ externalRawPayload: { dataHoraAbertura: "31/02/2026 00:00:00" } })
    );
    assert.equal(d.kind, "SKIP");
    if (d.kind !== "SKIP") return;
    assert.match(d.reason, /inválida/i);
  });

  it("externalOpenedAt nulo com payload válido é reparo, não skip", () => {
    const d = decideProposalOpenedAtRepair(row({ externalOpenedAt: null }));
    assert.equal(d.kind, "REPAIR");
    if (d.kind !== "REPAIR") return;
    assert.equal(d.storedCivilDate, null);
    assert.equal(d.isDayMonthSwap, false);
  });
});

describe("proposalOpenedAtRepair — resumo", () => {
  it("conta cada categoria e agrupa motivos de skip", () => {
    const decisions: ProposalOpenedAtRepairDecision[] = [
      decideProposalOpenedAtRepair(row({ id: "a" })),
      decideProposalOpenedAtRepair(
        row({ id: "b", externalOpenedAt: new Date(2026, 7, 3) })
      ),
      decideProposalOpenedAtRepair(row({ id: "c", sourceSystem: null })),
      decideProposalOpenedAtRepair(row({ id: "d", sourceSystem: null })),
    ];
    const s = summarizeProposalOpenedAtRepair(decisions);
    assert.equal(s.analyzed, 4);
    assert.equal(s.repairCount, 1);
    assert.equal(s.dayMonthSwapCount, 1);
    assert.equal(s.okCount, 1);
    assert.equal(s.skipCount, 2);
    assert.equal(Object.values(s.skipReasons)[0], 2);
  });

  it("lista vazia não quebra", () => {
    const s = summarizeProposalOpenedAtRepair([]);
    assert.equal(s.analyzed, 0);
    assert.deepEqual(s.skipReasons, {});
  });
});

describe("proposalOpenedAtRepair — decisão é pura", () => {
  it("não muta a linha recebida", () => {
    const input = row();
    const before = JSON.stringify({
      opened: input.externalOpenedAt?.toISOString(),
      payload: input.externalRawPayload,
    });
    decideProposalOpenedAtRepair(input);
    const after = JSON.stringify({
      opened: input.externalOpenedAt?.toISOString(),
      payload: input.externalRawPayload,
    });
    assert.equal(before, after);
  });

  it("rerun é determinístico", () => {
    const a = decideProposalOpenedAtRepair(row());
    const b = decideProposalOpenedAtRepair(row());
    assert.deepEqual(a, b);
  });
});
