import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClientCommercialTerms,
  parseProjectCommercialPatch,
  projectPriorityLabel,
  proposalValidUntil,
  toProjectCommercialData,
} from "./projectsCommercialTerms.js";

describe("projectsCommercialTerms — PATCH parcial", () => {
  it("lê só as chaves presentes; vazio/null limpa", () => {
    const r = parseProjectCommercialPatch({
      paymentTerms: "  28 DDL ",
      proposalValidityDays: "15",
      freightCondition: "FOB",
      priority: "HIGH",
      desiredDeadline: "2026-12-01",
      clientNotes: "",
      title: "ignorado",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.value, {
      paymentTerms: "28 DDL",
      proposalValidityDays: 15,
      freightCondition: "FOB",
      priority: "HIGH",
      desiredDeadline: "2026-12-01",
      clientNotes: null,
    });
    const empty = parseProjectCommercialPatch({});
    assert.deepEqual(empty.ok && empty.value, {});
  });

  it("recusa valores fora do vocabulário ou inválidos", () => {
    const codes = [
      { freightCondition: "EXW" },
      { priority: "Alta" },
      { proposalValidityDays: -1 },
      { deliveryTimeDays: 1.5 },
      { desiredDeadline: "2026-02-30" },
      { desiredDeadline: "01/12/2026" },
      { paymentTerms: 10 },
      { application: "x".repeat(2001) },
    ].map((b) => {
      const r = parseProjectCommercialPatch(b);
      return r.ok === false ? r.code : "OK";
    });
    assert.deepEqual(codes, [
      "INVALID_FREIGHT",
      "INVALID_PRIORITY",
      "INVALID_DAYS",
      "INVALID_DAYS",
      "INVALID_DATE",
      "INVALID_DATE",
      "INVALID_FIELD",
      "FIELD_TOO_LONG",
    ]);
  });

  it("prazo desejado vira Date UTC só quando informado", () => {
    assert.deepEqual(toProjectCommercialData({ desiredDeadline: "2026-12-01" }).desiredDeadline, new Date("2026-12-01T00:00:00.000Z"));
    assert.equal(toProjectCommercialData({ desiredDeadline: null }).desiredDeadline, null);
    assert.equal("desiredDeadline" in toProjectCommercialData({ paymentTerms: "x" }), false);
  });
});

describe("projectsCommercialTerms — termos ao cliente", () => {
  it("nada definido → tudo null (documento mostra 'A definir'), sem padrão automático", () => {
    assert.deepEqual(buildClientCommercialTerms({}), {
      proposalValidity: null,
      paymentTerms: null,
      deliveryTerms: null,
      freightTerms: null,
      clientNotes: null,
    });
  });

  it("monta textos definidos e usa só as observações ao cliente", () => {
    const t = buildClientCommercialTerms({
      proposalValidityDays: 1,
      deliveryTimeDays: 30,
      deliveryLocation: "Planta Joinville",
      freightCondition: "CIF",
      paymentTerms: "28/56 DDL",
      clientNotes: "Amostras em 10 dias.",
    });
    assert.equal(t.proposalValidity, "1 dia");
    assert.equal(t.deliveryTerms, "30 dias · Planta Joinville");
    assert.equal(t.freightTerms, "CIF (frete por conta do emitente)");
    assert.equal(t.clientNotes, "Amostras em 10 dias.");
    assert.equal(Object.keys(t).includes("notes"), false, "sem campo de observação interna");
  });

  it("validade em data e rótulo de prioridade", () => {
    assert.equal(proposalValidUntil("2026-10-15T15:00:00.000Z", 15), "2026-10-30");
    assert.equal(proposalValidUntil("2026-10-15T15:00:00.000Z", null), null);
    assert.equal(projectPriorityLabel("URGENT"), "Urgente");
    assert.equal(projectPriorityLabel("Alta"), null);
  });
});

describe("painel Cliente e condições comerciais", () => {
  it("envia só os campos alterados; vazio vira null; dias viram número", async () => {
    const { buildCommercialPatchBody } = await import("@/src/components/projects/ProjectCommercialDataPanel");
    const empty = {
      proposalValidityDays: "",
      paymentTerms: "",
      deliveryTimeDays: "",
      deliveryLocation: "",
      freightCondition: "",
      desiredDeadline: "",
      priority: "",
      application: "",
      clientNotes: "",
    };
    assert.deepEqual(buildCommercialPatchBody(empty, { ...empty }), {});
    assert.deepEqual(
      buildCommercialPatchBody({ ...empty, paymentTerms: "28 DDL" }, { ...empty, proposalValidityDays: "15", freightCondition: "CIF" }),
      { proposalValidityDays: 15, paymentTerms: null, freightCondition: "CIF" },
    );
  });

  it("na edição, texto digitado e não escolhido não troca o cliente", async () => {
    const { readFileSync } = await import("node:fs");
    const panel = readFileSync("src/components/projects/ProjectCommercialDataPanel.tsx", "utf8");
    const field = readFileSync("src/components/projects/ProjectCustomerLookupField.tsx", "utf8");
    assert.match(panel, /commitDraftOnBlur=\{false\}/);
    assert.match(field, /commitDraftOnBlur = true/, "criação de projeto mantém o comportamento atual");
    assert.match(field, /if \(commitDraftOnBlur && !value && trimmed\)/);
  });
});
