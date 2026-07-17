/**
 * DS-04.4 — Contrato da rota de detalhe, requireResource e raw gate.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseOutputDocumentDetailIdParam } from "./output-documents/outputDocumentsDetail.js";

describe("outputDocumentsRoutes — detalhe :id DS-04.4", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/outputDocumentsRoutes.ts"),
    "utf8"
  );

  it("registra :id depois de summary/lista e trata 404", () => {
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

  it("detalhe exige requireResource.detail e gate de raw", () => {
    assert.match(
      source,
      /requireResource\(\s*COMMERCIAL_RESOURCE_KEYS\.outputDocumentsDetail/
    );
    assert.match(source, /decideOutputDocumentRawAccess/);
    assert.match(source, /parseIncludeRawFlag/);
    assert.match(source, /COMMERCIAL_RESOURCE_KEYS\.outputDocumentsFinancial/);
    assert.match(source, /COMMERCIAL_RESOURCE_KEYS\.outputDocumentsAudit/);
    assert.match(source, /COMMERCIAL_RESOURCE_KEYS\.outputDocumentsRaw/);
    assert.match(source, /isOutputDocumentInPortfolio/);
    assert.doesNotMatch(source, /requireAnyPermission/);
  });

  it("loader de detalhe só seleciona rawJson quando includeRaw autorizado", () => {
    const server = readFileSync(
      join(
        process.cwd(),
        "src/lib/output-documents/outputDocumentsDetail.server.ts"
      ),
      "utf8"
    );
    assert.match(server, /includeRaw === true && canViewRaw/);
    assert.match(server, /loadOutputDocumentByExternalId/);
    assert.match(server, /projectOutputDocumentAllocation/);
    assert.match(server, /resolveOutputDocumentFinancialStatus/);
    assert.match(server, /payloadHash/);
    assert.match(server, /if \(includeRaw\)/);
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
