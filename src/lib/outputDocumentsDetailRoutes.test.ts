/**
 * DS-04.2 — Contrato da rota de detalhe e cenários 404/id inválido.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseOutputDocumentDetailIdParam } from "./output-documents/outputDocumentsDetail.js";

describe("outputDocumentsRoutes — detalhe :id", () => {
  it("registra :id depois de summary/lista e trata 404", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/outputDocumentsRoutes.ts"),
      "utf8"
    );
    assert.match(source, /\/api\/commercial\/output-documents\/:id/);
    assert.match(source, /loadOutputDocumentDetail/);
    assert.match(source, /status\(404\)/);
    assert.match(source, /OutputDocumentDetailInvalidIdError/);

    const summaryIdx = source.indexOf(
      "/api/commercial/output-documents/summary"
    );
    const listIdx = source.indexOf('"/api/commercial/output-documents"');
    const detailIdx = source.indexOf("/api/commercial/output-documents/:id");
    assert.ok(summaryIdx > 0 && listIdx > summaryIdx && detailIdx > listIdx);
  });

  it("não seleciona rawJson no loader de detalhe", () => {
    const server = readFileSync(
      join(
        process.cwd(),
        "src/lib/output-documents/outputDocumentsDetail.server.ts"
      ),
      "utf8"
    );
    assert.doesNotMatch(server, /rawJson:\s*true/);
    assert.match(server, /loadOutputDocumentByExternalId/);
    assert.match(server, /projectOutputDocumentAllocation/);
  });

  it("piloto comercial inclui endpoint :id", () => {
    const access = readFileSync(
      join(process.cwd(), "src/lib/commercialAccess.ts"),
      "utf8"
    );
    assert.match(access, /\/api\/commercial\/output-documents\/:id/);
  });

  it("id inválido não é tratado como documento encontrado", () => {
    const parsed = parseOutputDocumentDetailIdParam("not-a-valid-id");
    assert.equal(parsed.kind, "invalid");
    assert.equal(parseOutputDocumentDetailIdParam("0").kind, "invalid");
  });
});
