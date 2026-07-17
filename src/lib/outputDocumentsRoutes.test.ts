/**
 * DS-04.1 — Contrato de rotas e autorização provisória.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { COMMERCIAL_RESOURCE_KEYS } from "./commercialAccess.js";

describe("outputDocumentsRoutes — contrato e auth provisória", () => {
  it("chave canônica commercial.output_documents existe na matriz", () => {
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.outputDocuments,
      "commercial.output_documents"
    );
  });

  it("registra summary antes da lista e exige auth provisória", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/outputDocumentsRoutes.ts"),
      "utf8"
    );
    assert.match(source, /\/api\/commercial\/output-documents\/summary/);
    assert.match(source, /\/api\/commercial\/output-documents"/);
    assert.match(source, /requireAppAuth/);
    assert.match(source, /requireAnyPermission/);
    assert.match(source, /OUTPUT_DOCUMENTS_VIEW_PERMISSIONS/);
    assert.match(source, /sales_orders\.view/);
    assert.match(source, /loadOutputDocumentsSummary/);
    assert.match(source, /loadOutputDocumentsList/);

    const summaryIdx = source.indexOf(
      "/api/commercial/output-documents/summary"
    );
    const listIdx = source.indexOf('"/api/commercial/output-documents"');
    assert.ok(summaryIdx > 0 && listIdx > summaryIdx);
  });

  it("está registrado no server.ts", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /registerOutputDocumentsRoutes/);
  });

  it("piloto comercial declara endpoints de Documentos de Saída", () => {
    const access = readFileSync(
      join(process.cwd(), "src/lib/commercialAccess.ts"),
      "utf8"
    );
    assert.match(access, /commercial\.output_documents/);
    assert.match(access, /\/api\/commercial\/output-documents\/summary/);
    assert.match(access, /\/api\/commercial\/output-documents"/);
  });

  it("select de lista não inclui rawJson e usa resolver financeiro oficial", () => {
    const listServer = readFileSync(
      join(
        process.cwd(),
        "src/lib/output-documents/outputDocumentsList.server.ts"
      ),
      "utf8"
    );
    assert.match(listServer, /STAGE_SELECT/);
    assert.doesNotMatch(listServer, /rawJson:\s*true/);
    assert.match(listServer, /resolveListDocumentFinancialStatus/);

    const listPure = readFileSync(
      join(process.cwd(), "src/lib/output-documents/outputDocumentsList.ts"),
      "utf8"
    );
    assert.match(listPure, /resolveOutputDocumentFinancialStatus/);
  });
});
