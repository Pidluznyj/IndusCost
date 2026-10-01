import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseDjenPublicationText,
  poleFromDjenLabel,
  sanitizeOfficialPublicationText,
} from "./parseDjenPublicationText.js";

describe("parseDjenPublicationText", () => {
  it("sanitiza HTML e extrai autor, réu, audiência e OAB só quando explícitos", () => {
    const parsed = parseDjenPublicationText(`
      <p>RECLAMANTE: MARIA EXEMPLO</p>
      <p>RECLAMADO: LAZARIOS COMERCIO DE PLASTICOS LTDA</p>
      <p>Advogado JOÃO SILVA OAB/PR n 12345</p>
      <p>AUDIÊNCIA INICIAL 10/11/2026 às 09:30</p>
      <p>DISTRIBUÍDO em 23/09/2026</p>
      <script>alert(1)</script>
      <a href="https://comunica.pje.jus.br/consulta">link</a>
    `);
    assert.equal(parsed.parties.some((row) => row.pole === "ACTIVE" && /MARIA/i.test(row.name)), true);
    assert.equal(parsed.parties.some((row) => row.pole === "PASSIVE" && /LAZARIOS/i.test(row.name)), true);
    assert.equal(parsed.hearings.length, 1);
    assert.equal(parsed.attorneys[0]?.oabState, "PR");
    assert.equal(parsed.attorneys[0]?.oabNumber, "12345");
    assert.ok(parsed.filedAt);
    assert.ok(parsed.officialLinks[0]?.includes("comunica.pje.jus.br"));
    assert.equal(sanitizeOfficialPublicationText("<script>x</script>texto")?.includes("script"), false);
  });

  it("não infere polo de texto ambíguo", () => {
    const parsed = parseDjenPublicationText("Intimação disponibilizada no DJe.");
    assert.equal(parsed.parties.length, 0);
    assert.equal(parsed.hearings.length, 0);
  });

  it("normaliza rótulos de polo estruturado", () => {
    assert.equal(poleFromDjenLabel("A"), "ACTIVE");
    assert.equal(poleFromDjenLabel("P"), "PASSIVE");
    assert.equal(poleFromDjenLabel("RECLAMANTE"), "ACTIVE");
    assert.equal(poleFromDjenLabel("RECLAMADO"), "PASSIVE");
    assert.equal(poleFromDjenLabel(""), "UNKNOWN");
  });
});
