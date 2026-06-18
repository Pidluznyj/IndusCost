import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function readServer(): string {
  return readFileSync(join(process.cwd(), "server.ts"), "utf8");
}

test("endpoint details retorna audit sob demanda", () => {
  const server = readServer();
  assert.match(server, /planned-vs-realized\/materials\/:materialId\/details/);
  assert.match(server, /buildMaterialUsageAuditPayload/);
  assert.match(server, /audit,/);
  assert.doesNotMatch(server, /res\.json\(\{\s*filtersApplied: data\.filtersApplied,\s*summary,/);
});

test("payload principal planned-vs-realized não inclui audit drilldown", () => {
  const server = readServer();
  const handler = server.slice(
    server.indexOf("handleMaterialDemandPlannedVsRealized ="),
    server.indexOf("handleMaterialDemandPlannedVsRealizedDetails")
  );
  assert.match(handler, /rows: data\.rows/);
  assert.doesNotMatch(handler, /audit:/);
  assert.doesNotMatch(handler, /contributions,/);
});

test("contributions incluem customerName para auditoria", () => {
  const server = readServer();
  assert.match(server, /customerName: order\.Customer\?\.companyName/);
  assert.match(server, /productSoldUnit: item\.unit/);
});
