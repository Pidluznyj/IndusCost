import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFieldResolutions,
  classifyCustomerDocument,
  detectPersonFieldConflicts,
  foldAscii,
  isUnequivocalMatchEvidence,
  maskCpf,
  maskEmail,
  normalizeCpfLoose,
  normalizeEmailLoose,
} from "./canonicalPerson.ts";

describe("canonicalPerson — normalização", () => {
  it("e-mail e CPF", () => {
    assert.equal(normalizeEmailLoose("  A@B.COM "), "a@b.com");
    assert.equal(normalizeCpfLoose("123.456.789-09"), "12345678909");
    assert.equal(normalizeCpfLoose("123"), null);
  });

  it("fold acentos", () => {
    assert.equal(foldAscii("José"), "jose");
  });

  it("máscaras", () => {
    assert.equal(maskEmail("joao@empresa.com"), "jo***@empresa.com");
    assert.ok(maskCpf("12345678909")?.includes("***"));
  });
});

describe("canonicalPerson — PF/PJ e evidência", () => {
  it("classifica documento", () => {
    assert.equal(classifyCustomerDocument("12345678909"), "PF");
    assert.equal(classifyCustomerDocument("12345678000199"), "PJ");
  });

  it("nome sozinho nunca é evidência inequívoca", () => {
    assert.equal(isUnequivocalMatchEvidence({ nameOnly: true }), false);
    assert.equal(isUnequivocalMatchEvidence({ emailExact: true }), true);
    assert.equal(isUnequivocalMatchEvidence({ cpfExact: true }), true);
  });
});

describe("canonicalPerson — conflitos", () => {
  it("detecta e resolve sem sobrescrever silenciosamente", () => {
    const conflicts = detectPersonFieldConflicts(
      { displayName: "Ana", corporateEmail: "a@x.com" },
      { displayName: "Ana Silva", corporateEmail: "b@x.com" }
    );
    assert.equal(conflicts.length, 2);
    const applied = applyFieldResolutions(
      { displayName: "Ana", corporateEmail: "a@x.com" },
      { displayName: "Ana Silva", corporateEmail: "b@x.com" },
      { displayName: "person", corporateEmail: "form" }
    );
    assert.equal(applied.displayName, "Ana Silva");
    assert.equal(applied.corporateEmail, "a@x.com");
  });
});
