/**
 * DS-06.2 — Matriz de cenários do release candidate de Documentos de Saída.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveOutputDocument } from "./nomusOutputDocumentResolver.js";
import { projectOutputDocumentAllocation } from "./outputDocumentAllocationProjection.js";
import { resolveOutputDocumentFinancialStatus } from "./outputDocumentFinancialStatusResolver.js";
import {
  allOutputDocumentsRcScenarios,
  type OutputDocumentsRcScenarioId,
} from "./outputDocumentsReleaseCandidate.fixtures.js";

const REQUIRED_SCENARIOS: OutputDocumentsRcScenarioId[] = [
  "simple",
  "cancelled",
  "without_items",
  "multi_order",
  "partially_allocated",
  "nfe_without_cr",
  "cr_open",
  "received",
  "without_o2c",
  "unresolved_item",
];

describe("output documents release candidate fixtures", () => {
  it("expõe os 10 cenários obrigatórios do RC", () => {
    const scenarios = allOutputDocumentsRcScenarios();
    assert.equal(scenarios.length, 10);
    assert.deepEqual(
      scenarios.map((s) => s.id).sort(),
      [...REQUIRED_SCENARIOS].sort()
    );
  });

  for (const scenario of allOutputDocumentsRcScenarios()) {
    it(`cenário ${scenario.id}: ${scenario.label}`, () => {
      const resolved = resolveOutputDocument(scenario.evidence);
      assert.equal(resolved.listedFromStage, scenario.expect.listedFromStage);
      assert.equal(
        resolved.dependsOnO2cForListing,
        scenario.expect.dependsOnO2cForListing
      );
      assert.equal(resolved.items.length, scenario.expect.itemCount);
      assert.equal(resolved.orders.orders.length, scenario.expect.orderCount);
      assert.equal(resolved.o2c.present, scenario.expect.o2cPresent);
      if (scenario.expect.documentCancelled) {
        assert.equal(resolved.document.isCancelled, true);
      }

      const financial = resolveOutputDocumentFinancialStatus(scenario.financial);
      assert.equal(financial.status, scenario.expect.financialStatus);

      const allocation = projectOutputDocumentAllocation(scenario.allocation);
      if (scenario.expect.coverageStatus) {
        assert.equal(
          allocation.document.coverageStatus,
          scenario.expect.coverageStatus
        );
      }
      if (scenario.expect.itemLinkStatus && allocation.items.length > 0) {
        assert.equal(
          allocation.items[0]!.linkStatus,
          scenario.expect.itemLinkStatus
        );
      }
      if (scenario.expect.itemLinkStatus === "unresolved" && allocation.items[0]) {
        assert.ok(
          allocation.items[0]!.alerts.includes("DOCUMENT_ITEM_UNRESOLVED")
        );
      }
    });
  }

  it("documento preserva listagem sem O2C e NF sem CR aguarda CR", () => {
    const scenarios = allOutputDocumentsRcScenarios();
    const withoutO2c = scenarios.find((s) => s.id === "without_o2c");
    const nfeWithoutCr = scenarios.find((s) => s.id === "nfe_without_cr");
    assert.ok(withoutO2c);
    assert.ok(nfeWithoutCr);
    assert.equal(resolveOutputDocument(withoutO2c.evidence).o2c.present, false);
    assert.equal(
      resolveOutputDocumentFinancialStatus(nfeWithoutCr.financial).status,
      "aguardando_cr"
    );
  });

  it("RC comercial documenta arquitetura, scripts e limitações de servidor", () => {
    const doc = readFileSync(
      join(process.cwd(), "docs/output-documents/release-candidate.md"),
      "utf8"
    );
    assert.match(doc, /DS-06\.2/);
    assert.match(doc, /NomusStockDocument/);
    assert.match(doc, /payloadHash/);
    assert.match(doc, /presentInLastPayload/);
    assert.match(doc, /repair:nomus:stock-documents/);
    assert.match(doc, /commercial\.output_documents/);
    assert.match(doc, /1366/);
    assert.match(doc, /1920/);
    assert.match(doc, /Limitações dependentes do servidor/);
    for (const id of REQUIRED_SCENARIOS) {
      assert.match(doc, new RegExp(id.replace(/_/g, "[ _-]")));
    }
  });

  it("UI comercial preserva scroll dual, tons suaves e drawer 1400px", () => {
    const moduleSource = readFileSync(
      join(
        process.cwd(),
        "src/components/commercial/OutputDocumentsModule.tsx"
      ),
      "utf8"
    );
    const overlaySource = readFileSync(
      join(
        process.cwd(),
        "src/components/commercial/OutputDocumentDetailOverlay.tsx"
      ),
      "utf8"
    );
    const rowSource = readFileSync(
      join(
        process.cwd(),
        "src/components/commercial/OutputDocumentGridTableRow.tsx"
      ),
      "utf8"
    );
    assert.match(moduleSource, /output-documents-grid-top-scroll/);
    assert.match(moduleSource, /min-w-\[1180px\]/);
    assert.match(overlaySource, /!max-w-\[1400px\]/);
    assert.match(rowSource, /bg-rose-50/);
    assert.match(
      readFileSync(
        join(process.cwd(), "src/lib/outputDocumentsUi.ts"),
        "utf8"
      ),
      /aguardando_cr[\s\S]*amber|case "aguardando_cr":\s*return "amber"/
    );
  });
});
