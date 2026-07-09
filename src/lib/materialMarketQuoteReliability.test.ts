import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeQuoteSuggestedReliabilityLevel } from "./materialMarketQuoteAttachment.js";
import {
  buildMaterialMarketQuoteReliabilityAuditDetails,
  lowerMaterialMarketQuoteReliabilityLevel,
  MaterialMarketQuoteReliabilityValidationError,
  parseMaterialMarketQuoteReliabilityPatch,
  suggestMaterialMarketQuoteReliability,
  toPrismaMaterialMarketQuoteReliabilityLevel,
} from "./materialMarketQuoteReliability.js";

describe("materialMarketQuoteReliability", () => {
  it("cotação sem anexo sugere MANUAL", () => {
    assert.equal(
      suggestMaterialMarketQuoteReliability({ attachments: [] }),
      "MANUAL"
    );
  });

  it("cotação sem anexo com origem verbal sugere BAIXA", () => {
    assert.equal(
      suggestMaterialMarketQuoteReliability({
        attachments: [],
        informationSource: "VERBAL",
      }),
      "BAIXA"
    );
  });

  it("cotação com anexo PDF sugere ALTA", () => {
    assert.equal(
      suggestMaterialMarketQuoteReliability({
        attachments: [{ attachmentType: "PDF" }],
      }),
      "ALTA"
    );
  });

  it("cotação com anexo PROPOSAL sugere ALTA", () => {
    assert.equal(
      suggestMaterialMarketQuoteReliability({
        attachments: [{ attachmentType: "PROPOSAL" }],
      }),
      "ALTA"
    );
  });

  it("cotação com EMAIL sugere MEDIA", () => {
    assert.equal(
      suggestMaterialMarketQuoteReliability({
        attachments: [{ attachmentType: "EMAIL" }],
      }),
      "MEDIA"
    );
  });

  it("somente IMAGE sugere BAIXA", () => {
    assert.equal(
      suggestMaterialMarketQuoteReliability({
        attachments: [{ attachmentType: "IMAGE" }],
      }),
      "BAIXA"
    );
  });

  it("câmbio manual reduz um nível de confiabilidade", () => {
    assert.equal(
      suggestMaterialMarketQuoteReliability({
        attachments: [{ attachmentType: "PDF" }],
        exchangeOrigin: "MANUAL",
      }),
      "MEDIA"
    );
    assert.equal(
      lowerMaterialMarketQuoteReliabilityLevel("MEDIA"),
      "BAIXA"
    );
  });

  it("override sem justificativa retorna erro 400", () => {
    const result = parseMaterialMarketQuoteReliabilityPatch({ level: "ALTA" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "RELIABILITY_JUSTIFICATION_REQUIRED");
  });

  it("override com justificativa é aceito", () => {
    const result = parseMaterialMarketQuoteReliabilityPatch({
      level: "MEDIA",
      justification: "Evidência verbal confirmada pelo comprador.",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.level, "MEDIA");
    assert.match(result.justification, /verbal/);
  });

  it("auditoria RELIABILITY_CHANGED inclui before/after e justificativa", () => {
    const details = buildMaterialMarketQuoteReliabilityAuditDetails({
      before: "MANUAL",
      after: "ALTA",
      justification: "Proposta formal anexada após revisão.",
    });
    const parsed = JSON.parse(details) as {
      event: string;
      before: string;
      after: string;
      justification: string;
    };
    assert.equal(parsed.event, "RELIABILITY_CHANGED");
    assert.equal(parsed.before, "MANUAL");
    assert.equal(parsed.after, "ALTA");
    assert.match(parsed.justification, /Proposta formal/);
  });

  it("adição de anexo PDF atualiza sugestão agregada para ALTA", () => {
    const suggested = computeQuoteSuggestedReliabilityLevel(
      [{ attachmentType: "PDF", suggestedReliabilityLevel: "ALTA" }],
      { exchangeOrigin: null }
    );
    assert.equal(suggested, "ALTA");
  });

  it("migra valores legados LOW/MEDIUM/HIGH", () => {
    const result = parseMaterialMarketQuoteReliabilityPatch({
      level: "HIGH",
      justification: "Legado.",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.level, "ALTA");
  });

  it("toPrisma grava valores canônicos do enum Prisma (MANUAL/BAIXA/MEDIA/ALTA)", () => {
    assert.equal(toPrismaMaterialMarketQuoteReliabilityLevel("MANUAL"), "MANUAL");
    assert.equal(toPrismaMaterialMarketQuoteReliabilityLevel("BAIXA"), "BAIXA");
    assert.equal(toPrismaMaterialMarketQuoteReliabilityLevel("MEDIA"), "MEDIA");
    assert.equal(toPrismaMaterialMarketQuoteReliabilityLevel("ALTA"), "ALTA");
    assert.equal(toPrismaMaterialMarketQuoteReliabilityLevel(null), null);
  });

  it("cotação manual sem anexo grava MANUAL no Prisma (não LOW)", () => {
    const suggested = suggestMaterialMarketQuoteReliability({ attachments: [] });
    assert.equal(suggested, "MANUAL");
    assert.equal(toPrismaMaterialMarketQuoteReliabilityLevel(suggested), "MANUAL");
  });

  it("rejeita valor inválido antes do Prisma com erro explícito", () => {
    assert.throws(
      () => toPrismaMaterialMarketQuoteReliabilityLevel("INVALID" as never),
      MaterialMarketQuoteReliabilityValidationError
    );
  });
});
