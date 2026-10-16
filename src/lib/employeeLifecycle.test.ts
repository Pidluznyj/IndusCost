import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMonthsIso,
  completedYears,
  computeEmployeeSituation,
  describeLeave,
  describeTermination,
  legalLeaveEnd,
  noticeDays,
  terminationGuards,
  validateLeave,
  validateTermination,
} from "./employeeLifecycle";

const EMP = { status: "ACTIVE", admissionDate: "2020-03-10", terminationDate: null };
const leaveBase = { type: "SICK_LEAVE", startDate: "2026-10-01", expectedReturn: null, endDate: null, actualReturn: null, justification: "Atestado de 20 dias por cirurgia", extendedLicense: false, employee: EMP, others: [] };

describe("afastamento — validação", () => {
  it("exige justificativa e data de início", () => {
    assert.match(validateLeave({ ...leaveBase, justification: "curta" }).join(" "), /justificativa/);
    assert.match(validateLeave({ ...leaveBase, startDate: null }).join(" "), /início/);
    assert.deepEqual(validateLeave(leaveBase), []);
  });

  it("não afasta desligado, nem antes da admissão ou depois da demissão", () => {
    assert.match(validateLeave({ ...leaveBase, employee: { ...EMP, status: "INACTIVE" } }).join(" "), /desligado/);
    assert.match(validateLeave({ ...leaveBase, startDate: "2019-01-01" }).join(" "), /admissão/);
    assert.match(validateLeave({ ...leaveBase, employee: { ...EMP, terminationDate: "2026-09-30" } }).join(" "), /desligamento/);
  });

  it("suspensão disciplinar: no máximo 30 dias (CLT art. 474)", () => {
    const ok = validateLeave({ ...leaveBase, type: "SUSPENSION", expectedReturn: "2026-10-31" });
    assert.deepEqual(ok, []);
    const bad = validateLeave({ ...leaveBase, type: "SUSPENSION", expectedReturn: "2026-11-01" });
    assert.match(bad.join(" "), /30 dias/);
  });

  it("prorrogação Empresa Cidadã só onde a lei prevê; sobreposição de afastamentos é recusada", () => {
    assert.match(validateLeave({ ...leaveBase, extendedLicense: true }).join(" "), /Empresa Cidadã/);
    assert.deepEqual(validateLeave({ ...leaveBase, type: "MATERNITY", extendedLicense: true }), []);
    const others = [{ id: "x", type: "ACCIDENT", startDate: "2026-09-20", status: "IN_PROGRESS" }];
    assert.match(validateLeave({ ...leaveBase, others }).join(" "), /Já existe afastamento/);
    assert.deepEqual(validateLeave({ ...leaveBase, others: [{ ...others[0], status: "CANCELLED" }] }), []);
    assert.deepEqual(validateLeave({ ...leaveBase, others: [{ ...others[0], actualReturn: "2026-09-30" }] }), []);
  });
});

describe("afastamento — nuances legais", () => {
  it("doença: empresa paga 15 dias; INSS a partir do 16º; encaminhar à perícia acima de 15 dias", () => {
    const d = describeLeave({ type: "SICK_LEAVE", startDate: "2026-10-01" }, "2026-10-20")!;
    assert.equal(d.employerPaidUntil, "2026-10-15");
    assert.equal(d.inssFrom, "2026-10-16");
    assert.equal(d.elapsedDays, 20);
    assert.equal(d.inssReferralNeeded, true);
    assert.equal(d.fgtsContinues, false);
    assert.match(d.alerts.join(" "), /INSS/);
    const short = describeLeave({ type: "SICK_LEAVE", startDate: "2026-10-01" }, "2026-10-05")!;
    assert.equal(short.inssReferralNeeded, false);
  });

  it("acidente: FGTS continua e 12 meses de estabilidade após o retorno (quando passou de 15 dias)", () => {
    const d = describeLeave({ type: "ACCIDENT", startDate: "2026-01-10", actualReturn: "2026-03-01" }, "2026-10-16")!;
    assert.equal(d.fgtsContinues, true);
    assert.equal(d.stabilityUntil, "2027-03-01");
    const short = describeLeave({ type: "ACCIDENT", startDate: "2026-01-10", actualReturn: "2026-01-15" }, "2026-10-16")!;
    assert.equal(short.stabilityUntil, null, "até 15 dias não há benefício acidentário");
  });

  it("maternidade: 120 dias (180 Empresa Cidadã) e estabilidade de 5 meses; paternidade 5 (20)", () => {
    assert.equal(legalLeaveEnd("MATERNITY", "2026-01-01", false), "2026-04-30");
    assert.equal(legalLeaveEnd("MATERNITY", "2026-01-01", true), "2026-06-29");
    assert.equal(legalLeaveEnd("PATERNITY", "2026-01-01", false), "2026-01-05");
    assert.equal(legalLeaveEnd("PATERNITY", "2026-01-01", true), "2026-01-20");
    assert.equal(legalLeaveEnd("MISCARRIAGE", "2026-01-01", false), "2026-01-14");
    const m = describeLeave({ type: "MATERNITY", startDate: "2026-01-01" }, "2026-02-01")!;
    assert.equal(m.expectedReturn, "2026-05-01");
    assert.equal(m.stabilityUntil, "2026-06-01");
  });

  it("aviso de divergência quando o retorno previsto foge do prazo legal", () => {
    const d = describeLeave({ type: "MATERNITY", startDate: "2026-01-01", expectedReturn: "2026-03-01" }, "2026-01-10")!;
    assert.match(d.alerts.join(" "), /prazo legal/);
  });
});

describe("desligamento", () => {
  const base = { status: "INACTIVE", terminationDate: "2026-10-16", reason: "DISMISSAL_WITHOUT_CAUSE", noticeType: "INDEMNIFIED", noticeDate: "2026-10-16", details: null };

  it("exige data, motivo e aviso prévio compatível com o motivo", () => {
    assert.equal(validateTermination(base, { admissionDate: "2020-03-10", required: true }).ok, true);
    const missing = validateTermination({ ...base, terminationDate: null, reason: null }, { admissionDate: null, required: true });
    assert.equal(missing.ok, false);
    const wrongNotice = validateTermination({ ...base, reason: "DISMISSAL_WITH_CAUSE", noticeType: "INDEMNIFIED" }, { admissionDate: null, required: true });
    assert.ok(wrongNotice.ok === false && /não se aplica/.test(wrongNotice.errors.join(" ")));
    const noDate = validateTermination({ ...base, noticeDate: null }, { admissionDate: null, required: true });
    assert.ok(noDate.ok === false && /comunicação do aviso/.test(noDate.errors.join(" ")));
  });

  it("justa causa exige descrição dos fatos (art. 482)", () => {
    const r = validateTermination({ ...base, reason: "DISMISSAL_WITH_CAUSE", noticeType: "NOT_APPLICABLE", noticeDate: null }, { admissionDate: null, required: true });
    assert.ok(r.ok === false && /Descreva/.test(r.errors.join(" ")));
    const ok = validateTermination(
      { ...base, reason: "DISMISSAL_WITH_CAUSE", noticeType: "NOT_APPLICABLE", noticeDate: null, details: "Abandono de emprego — art. 482, i, após 30 dias de faltas." },
      { admissionDate: null, required: true },
    );
    assert.equal(ok.ok, true);
  });

  it("ativo não valida desligamento; legado inativo sem motivo segue editável", () => {
    assert.deepEqual(validateTermination({ ...base, status: "ACTIVE" }, { admissionDate: null, required: true }), { ok: true, value: null });
    assert.deepEqual(
      validateTermination({ status: "INACTIVE", terminationDate: null, reason: null, noticeType: null, noticeDate: null, details: null }, { admissionDate: null, required: false }),
      { ok: true, value: null },
    );
  });

  it("aviso prévio proporcional (Lei 12.506/2011), acordo pela metade e projeção do indenizado", () => {
    assert.equal(completedYears("2020-03-10", "2026-03-09"), 5);
    assert.equal(completedYears("2020-03-10", "2026-03-10"), 6);
    assert.equal(noticeDays("DISMISSAL_WITHOUT_CAUSE", "2020-03-10", "2026-10-16"), 48);
    assert.equal(noticeDays("DISMISSAL_WITHOUT_CAUSE", "1990-01-01", "2026-10-16"), 90);
    assert.equal(noticeDays("MUTUAL_AGREEMENT", "2020-03-10", "2026-10-16"), 24);
    assert.equal(noticeDays("RESIGNATION", "2020-03-10", "2026-10-16"), 30);
    const d = describeTermination({ reason: "DISMISSAL_WITHOUT_CAUSE", noticeType: "INDEMNIFIED", noticeDate: "2026-10-16", details: null, terminationDate: "2026-10-16" }, "2020-03-10");
    assert.equal(d.noticeDays, 48);
    assert.equal(d.projectedEnd, "2026-12-02");
    assert.equal(d.yearsOfService, 6);
  });

  it("bloqueia dispensa sem justa causa com afastamento em andamento; justa causa passa", () => {
    const leaves = [{ type: "ACCIDENT", startDate: "2026-09-01", status: "IN_PROGRESS" }];
    assert.equal(terminationGuards({ reason: "DISMISSAL_WITHOUT_CAUSE", terminationDate: "2026-10-16", leaves }).blocking.length, 1);
    assert.equal(terminationGuards({ reason: "MUTUAL_AGREEMENT", terminationDate: "2026-10-16", leaves }).blocking.length, 1);
    assert.equal(terminationGuards({ reason: "DISMISSAL_WITH_CAUSE", terminationDate: "2026-10-16", leaves }).blocking.length, 0);
  });

  it("estabilidade acidentária e da gestante geram aviso que exige ciência", () => {
    const accident = [{ type: "ACCIDENT", startDate: "2026-01-10", actualReturn: "2026-03-01", status: "COMPLETED" }];
    const g = terminationGuards({ reason: "DISMISSAL_WITHOUT_CAUSE", terminationDate: "2026-10-16", leaves: accident });
    assert.deepEqual([g.blocking.length, g.warnings.length], [0, 1]);
    assert.match(g.warnings[0], /01\/03\/2027/);
    const after = terminationGuards({ reason: "DISMISSAL_WITHOUT_CAUSE", terminationDate: "2027-03-02", leaves: accident });
    assert.equal(after.warnings.length, 0);
    const maternity = [{ type: "MATERNITY", startDate: "2026-06-01", actualReturn: "2026-09-29", status: "COMPLETED" }];
    assert.equal(terminationGuards({ reason: "DISMISSAL_WITHOUT_CAUSE", terminationDate: "2026-10-16", leaves: maternity }).warnings.length, 1);
    assert.equal(terminationGuards({ reason: "RESIGNATION", terminationDate: "2026-10-16", leaves: maternity }).warnings.length, 0);
  });
});

describe("situação exibida", () => {
  const today = "2026-10-16";
  it("desligado > afastado > férias > ativo", () => {
    const absences = [
      { id: "v", type: "VACATION", startDate: "2026-10-10", endDate: "2026-10-30", status: "IN_PROGRESS" },
      { id: "l", type: "SICK_LEAVE", startDate: "2026-10-12", status: "IN_PROGRESS" },
    ];
    assert.equal(computeEmployeeSituation({ status: "INACTIVE", terminationDate: "2026-10-01", absences, todayIso: today }).code, "TERMINATED");
    const leave = computeEmployeeSituation({ status: "ACTIVE", terminationDate: null, absences, todayIso: today });
    assert.deepEqual([leave.code, leave.since, leave.leaveId], ["ON_LEAVE", "2026-10-12", "l"]);
    assert.ok(leave.leave?.legalBasis.includes("8.213"));
    assert.equal(computeEmployeeSituation({ status: "ACTIVE", terminationDate: null, absences: [absences[0]], todayIso: today }).code, "VACATION");
    const back = computeEmployeeSituation({ status: "ACTIVE", terminationDate: null, absences: [{ ...absences[1], actualReturn: "2026-10-15" }], todayIso: today });
    assert.equal(back.code, "ACTIVE");
    const future = computeEmployeeSituation({ status: "ACTIVE", terminationDate: null, absences: [{ ...absences[1], startDate: "2026-11-01", status: "SCHEDULED" }], todayIso: today });
    assert.equal(future.code, "ACTIVE");
  });

  it("retorno previsto vencido mantém afastado (com alerta) até registrar o retorno; término passado encerra", () => {
    const maternity = { id: "m", type: "MATERNITY", startDate: "2025-01-10", status: "IN_PROGRESS", extendedLicense: true };
    const overdue = computeEmployeeSituation({ status: "ACTIVE", terminationDate: null, absences: [maternity], todayIso: today });
    assert.equal(overdue.code, "ON_LEAVE");
    assert.ok(overdue.leave?.alerts.some((a) => a.includes("09/07/2025") && a.includes("ainda não registrado")));
    const ended = computeEmployeeSituation({ status: "ACTIVE", terminationDate: null, absences: [{ ...maternity, endDate: "2025-07-08" }], todayIso: today });
    assert.equal(ended.code, "ACTIVE");
  });

  it("aritmética de datas", () => {
    assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
  });
});
