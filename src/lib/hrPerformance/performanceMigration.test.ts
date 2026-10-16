import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isPerformanceCycleEnabled, isIdentityOtpEnabled, isOfficialPublicationEnabled, isPerformanceRemindersEnabled } from "./performanceFeatureFlags.js";

const root = process.cwd();
const sql = readFileSync(join(root, "prisma/migrations/20261016180000_hr_performance_cycle/migration.sql"), "utf8");

describe("migration aditiva", () => {
  it("só cria a estrutura nova e referencia Employee por chave", () => {
    assert.match(sql, /CREATE TABLE "HrPerformanceModel"/);
    assert.match(sql, /CREATE TABLE "HrPerformanceConductCase"/);
    assert.match(sql, /REFERENCES "Employee"\("id"\)/);
    assert.equal(/DROP /i.test(sql), false);
    assert.equal(/ALTER TABLE "Employee"/i.test(sql), false);
    assert.equal(/ALTER TABLE "HrEmployeeEvaluation"/i.test(sql), false);
    assert.equal(/Nomus/i.test(sql), false);
  });

  it("flags nascem desligadas", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    assert.match(example, /^PERFORMANCE_CYCLE_ENABLED=0$/m);
    assert.match(example, /^PERFORMANCE_OFFICIAL_PUBLICATION=0$/m);
    assert.match(example, /^PERFORMANCE_IDENTITY_OTP=0$/m);
    assert.match(example, /^PERFORMANCE_REMINDERS_ENABLED=0$/m);
    assert.equal(isPerformanceCycleEnabled({}), false);
    assert.equal(isOfficialPublicationEnabled({}), false);
    assert.equal(isIdentityOtpEnabled({}), false);
    assert.equal(isPerformanceRemindersEnabled({}), false);
  });
});
