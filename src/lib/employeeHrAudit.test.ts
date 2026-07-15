import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  logEmployeeHrAudit,
  summarizeConflictResolutions,
} from "./employeeHrAudit.ts";

describe("employeeHrAudit", () => {
  it("sanitize omite e-mail/CPF completos e marca Present", () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (msg: unknown) => {
      lines.push(String(msg));
    };
    try {
      logEmployeeHrAudit({
        event: "employee.corporate_email.change",
        employeeId: "e1",
        details: {
          corporateEmail: "secret@empresa.com",
          cpf: "12345678909",
          managerChanged: true,
        },
      });
    } finally {
      console.info = original;
    }
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]) as {
      details: Record<string, unknown>;
    };
    assert.equal(parsed.details.corporateEmail, undefined);
    assert.equal(parsed.details.corporateEmailPresent, true);
    assert.equal(parsed.details.cpf, undefined);
    assert.equal(parsed.details.cpfPresent, true);
    assert.equal(parsed.details.managerChanged, true);
  });

  it("summarizeConflictResolutions conta campos", () => {
    const s = summarizeConflictResolutions({
      displayName: "KEEP_FORM",
      corporateEmail: "KEEP_PERSON",
    });
    assert.equal(s.fieldCount, 2);
    assert.ok(s.fields.includes("displayName"));
  });
});
