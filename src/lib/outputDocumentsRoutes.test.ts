/**
 * DS-04.4 — Contrato de rotas e requireResource granular.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { COMMERCIAL_RESOURCE_KEYS } from "./commercialAccess.js";

describe("outputDocumentsRoutes — contrato DS-04.4", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/outputDocumentsRoutes.ts"),
    "utf8"
  );

  it("chaves comercial.output_documents* na matriz", () => {
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.outputDocuments,
      "commercial.output_documents"
    );
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.outputDocumentsDetail,
      "commercial.output_documents.detail"
    );
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.outputDocumentsFinancial,
      "commercial.output_documents.financial"
    );
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.outputDocumentsAudit,
      "commercial.output_documents.audit"
    );
    assert.equal(
      COMMERCIAL_RESOURCE_KEYS.outputDocumentsRaw,
      "commercial.output_documents.raw"
    );
  });

  it("summary/lista usam requireResource na lista", () => {
    assert.match(source, /\/api\/commercial\/output-documents\/summary/);
    assert.match(source, /\/api\/commercial\/output-documents"/);
    assert.match(source, /requireAppAuth/);
    assert.match(source, /requireResource/);
    assert.match(
      source,
      /requireResource\(\s*COMMERCIAL_RESOURCE_KEYS\.outputDocuments/
    );
    assert.doesNotMatch(source, /requireAnyPermission/);
    assert.doesNotMatch(source, /OUTPUT_DOCUMENTS_VIEW_PERMISSIONS/);
    assert.doesNotMatch(source, /sales_orders\.view/);

    const summaryIdx = source.indexOf(
      "/api/commercial/output-documents/summary"
    );
    const listIdx = source.indexOf('"/api/commercial/output-documents"');
    assert.ok(summaryIdx > 0 && listIdx > summaryIdx);
  });

  it("escopo comercial oficial na listagem", () => {
    assert.match(source, /resolveOutputDocumentsAccessScope/);
    assert.match(source, /portfolioKeysToDocumentWhere/);
    assert.match(source, /loadOutputDocumentsSummary/);
    assert.match(source, /loadOutputDocumentsList/);
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
