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

  it("eventos de correção/exclusão da ficha nunca carregam valores nem telefone", () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (msg: unknown) => {
      lines.push(String(msg));
    };
    try {
      logEmployeeHrAudit({
        event: "employee.compensation.adjustment.update",
        actorUserId: "u1",
        employeeId: "e1",
        details: {
          adjustmentId: "adj-1",
          fields: ["previousAmount", "newAmount"],
          previousAmount: 4321.09,
          newAmount: 5678.12,
          amountsChanged: true,
        },
      });
      logEmployeeHrAudit({
        event: "employee.emergency.change",
        employeeId: "e1",
        details: { action: "delete", contactId: "c1", phone: "41999990000" },
      });
      logEmployeeHrAudit({ event: "employee.photo.change", employeeId: "e1", details: { action: "remove" } });
    } finally {
      console.info = original;
    }
    assert.equal(lines.length, 3);
    const joined = lines.join("\n");
    assert.ok(!joined.includes("4321"));
    assert.ok(!joined.includes("5678"));
    assert.ok(!joined.includes("41999990000"));
    const first = JSON.parse(lines[0]) as { audit: string; details: Record<string, unknown> };
    assert.equal(first.audit, "employee.compensation.adjustment.update");
    assert.equal(first.details.previousAmountPresent, true);
    assert.equal(first.details.newAmountPresent, true);
    assert.equal(first.details.adjustmentId, "adj-1");
    assert.deepEqual(first.details.fields, ["previousAmount", "newAmount"]);
    const second = JSON.parse(lines[1]) as { details: Record<string, unknown> };
    assert.equal(second.details.phonePresent, true);
    assert.equal(second.details.action, "delete");
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
