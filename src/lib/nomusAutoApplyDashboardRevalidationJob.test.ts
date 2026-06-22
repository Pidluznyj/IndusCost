import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const jobSrc = readFileSync(
  join(process.cwd(), "src/lib/nomusAutoApplyDashboardRevalidationJob.ts"),
  "utf8"
);
const routesSrc = readFileSync(
  join(process.cwd(), "src/lib/nomusAutoApplyBomDashboardRoutes.ts"),
  "utf8"
);
const schemaSrc = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("nomusAutoApplyDashboardRevalidationJob — estrutura", () => {
  it("job persiste resultJson e passa fileReport/runFallback ao montar dashboard", () => {
    assert.match(jobSrc, /resultJson: result as object/);
    assert.match(jobSrc, /fileReport: context\.fileReport/);
    assert.match(jobSrc, /runFallback: context\.runFallback/);
    assert.match(jobSrc, /loadAutoApplyReportContextForDashboard/);
  });

  it("job marca RUNNING stale como FAILED no startup", () => {
    assert.match(jobSrc, /markStaleRunningJobsFailed/);
    assert.match(jobSrc, /recoverNomusAutoApplyDashboardRevalidationJobsOnStartup/);
    assert.match(jobSrc, /status: "RUNNING"/);
    assert.match(jobSrc, /activeJobIdInProcess/);
  });

  it("schema possui NomusAutoApplyDashboardSnapshot", () => {
    assert.match(schemaSrc, /model NomusAutoApplyDashboardSnapshot/);
    assert.match(schemaSrc, /resultJson/);
    assert.match(schemaSrc, /eligibleProducts/);
  });
});

describe("nomusAutoApplyBomDashboardRoutes — endpoints de revalidação", () => {
  it("expõe GET dashboard, POST start e GET status", () => {
    assert.match(routesSrc, /\/api\/nomus\/auto-apply-bom-dashboard"/);
    assert.match(routesSrc, /\/api\/nomus\/auto-apply-bom-dashboard\/revalidation\/start/);
    assert.match(routesSrc, /\/api\/nomus\/auto-apply-bom-dashboard\/revalidation\/status/);
    assert.match(routesSrc, /startNomusAutoApplyDashboardRevalidationJob/);
    assert.match(routesSrc, /getNomusAutoApplyDashboardRevalidationStatus/);
  });

  it("GET dashboard não revalida por padrão e respeita preferSnapshot=0", () => {
    assert.match(routesSrc, /revalidateBlocked: syncRevalidate/);
    assert.match(routesSrc, /preferSnapshotQuery !== "0"/);
    assert.doesNotMatch(routesSrc, /revalidateBlocked:\s*true/);
  });
});
