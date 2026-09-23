import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildPeopleProfileCapabilities } from "./peopleProfileCapabilities.ts";
import { buildHistorySummary } from "./peopleProfileHistory.ts";
import {
  HR_EVALUATION_CRITERION_SEEDS,
  HrEvaluationError,
  calculateEvaluationAverage,
  compareExperienceEvaluations,
  displayOrDash,
  evaluationAlert,
  evaluationQrPayload,
  experienceCycleKey,
  formatAverageLabel,
  formatEvaluationReferenceCode,
  formatScoreDelta,
  historyNoteForCompletedEvaluation,
  isAllowedEvaluationAttachment,
  isOpenEvaluationStatus,
  normalizeAnswerScore,
  scheduleExperienceDates,
  validateEvaluationCompletion,
} from "./hrEvaluation.ts";

const ROOT = process.cwd();

function check(permissions: string[]) {
  return {
    hasPermission: (key: string) => permissions.includes(key),
    hasAnyPermission: (keys: readonly string[]) => keys.some((key) => permissions.includes(key)),
  };
}

describe("avaliações de experiência", () => {
  it("calcula média simples e deixa N/A de fora", () => {
    const result = calculateEvaluationAverage([
      { score: 5, notApplicable: false },
      { score: 3, notApplicable: false },
      { score: 2, notApplicable: false },
      { score: 1, notApplicable: false },
      { score: 1, notApplicable: true },
      { score: null, notApplicable: false },
    ]);
    assert.equal(result.validCount, 4);
    assert.equal(result.excludedCount, 2);
    assert.equal(result.average, 2.75);
    assert.equal(formatAverageLabel(result.average), "2,75 / 5,00");
    assert.equal(formatAverageLabel(3.92), "3,92 / 5,00");
  });

  it("rejeita nota fora de 1 a 5 e trata N/A como valor próprio", () => {
    assert.deepEqual(normalizeAnswerScore({ score: 4, notApplicable: false }), {
      score: 4,
      notApplicable: false,
    });
    assert.deepEqual(normalizeAnswerScore({ score: 5, notApplicable: true }), {
      score: null,
      notApplicable: true,
    });
    assert.throws(
      () => normalizeAnswerScore({ score: 0, notApplicable: false }),
      (error: unknown) => error instanceof HrEvaluationError && error.code === "INVALID_SCORE"
    );
    assert.throws(
      () => normalizeAnswerScore({ score: 6, notApplicable: false }),
      (error: unknown) => error instanceof HrEvaluationError
    );
  });

  it("não conclui sem data, avaliador, recomendação ou respostas", () => {
    const missing = validateEvaluationCompletion({
      evaluationDate: null,
      evaluatorName: " ",
      recommendation: null,
      evaluationType: "EXPERIENCE_45_DAYS",
      answers: [],
    });
    assert.ok(missing.some((item) => item.includes("data")));
    assert.ok(missing.some((item) => item.includes("avaliador")));
    assert.ok(missing.some((item) => item.includes("critérios")));

    const ready = validateEvaluationCompletion({
      evaluationDate: "2026-08-20",
      evaluatorName: "Líder da área",
      recommendation: "CONTINUE_NORMAL",
      evaluationType: "EXPERIENCE_45_DAYS",
      answers: [
        { score: 4, notApplicable: false, criterionName: "Assiduidade" },
        { score: null, notApplicable: true, criterionName: "Pontualidade" },
      ],
    });
    assert.deepEqual(ready, []);
  });

  it("compara 45 dias com a final e ignora N/A na evolução", () => {
    const comparison = compareExperienceEvaluations(
      {
        evaluationId: "a",
        referenceCode: "EXP-2026-00001-45",
        generalScore: 3.58,
        answers: [
          { code: "ASSIDUIDADE", name: "Assiduidade", sortOrder: 1, score: 5, notApplicable: false },
          { code: "QUALIDADE", name: "Qualidade", sortOrder: 2, score: 3, notApplicable: false },
          { code: "PRODUTIVIDADE", name: "Produtividade", sortOrder: 3, score: 2, notApplicable: false },
          { code: "APRENDIZADO", name: "Aprendizado", sortOrder: 4, score: 4, notApplicable: false },
          { code: "SEGURANCA", name: "Segurança", sortOrder: 5, score: null, notApplicable: true },
        ],
      },
      {
        evaluationId: "b",
        referenceCode: "EXP-2026-00002-90",
        generalScore: 4.25,
        answers: [
          { code: "ASSIDUIDADE", name: "Assiduidade", sortOrder: 1, score: 5, notApplicable: false },
          { code: "QUALIDADE", name: "Qualidade", sortOrder: 2, score: 4, notApplicable: false },
          { code: "PRODUTIVIDADE", name: "Produtividade", sortOrder: 3, score: 4, notApplicable: false },
          { code: "APRENDIZADO", name: "Aprendizado", sortOrder: 4, score: 5, notApplicable: false },
          { code: "SEGURANCA", name: "Segurança", sortOrder: 5, score: 5, notApplicable: false },
        ],
      }
    );
    assert.ok(comparison);
    assert.equal(comparison?.rows[0].delta, 0);
    assert.equal(comparison?.rows[0].direction, "flat");
    assert.equal(comparison?.rows[1].delta, 1);
    assert.equal(comparison?.rows[1].direction, "up");
    assert.equal(comparison?.rows[2].delta, 2);
    assert.equal(comparison?.rows[4].delta, null);
    assert.equal(comparison?.averageDelta, 0.67);
    assert.equal(formatScoreDelta(0.67), "+0,67");
    assert.equal(formatScoreDelta(0), "—");
    assert.equal(formatScoreDelta(-1), "-1");
  });

  it("programa 45 dias e a final alguns dias antes do término estimado", () => {
    const admission = new Date("2026-01-01T15:00:00.000Z");
    const first = scheduleExperienceDates(admission, "EXPERIENCE_45_DAYS");
    assert.equal(first.periodStart, "2026-01-01");
    assert.equal(first.dueDate, "2026-02-15");
    assert.equal(first.usedFallbackContractEnd, false);
    const finalMark = scheduleExperienceDates(admission, "EXPERIENCE_FINAL");
    assert.equal(finalMark.periodEnd, "2026-04-01");
    assert.equal(finalMark.dueDate, "2026-03-27");
    assert.equal(finalMark.usedFallbackContractEnd, true);
    assert.equal(experienceCycleKey(null), "NO_ADMISSION");
  });

  it("gera código amigável e QR interno, sem URL pública", () => {
    assert.equal(formatEvaluationReferenceCode(2026, 124, "EXPERIENCE_45_DAYS"), "EXP-2026-00124-45");
    assert.equal(formatEvaluationReferenceCode(2026, 3, "EXPERIENCE_FINAL"), "EXP-2026-00003-90");
    const qr = evaluationQrPayload("EXP-2026-00124-45", "id-interno");
    assert.equal(qr.startsWith("http"), false);
    assert.match(qr, /EXP-2026-00124-45/);
  });

  it("cobre alertas, cancelamento e ficha sem departamento, líder ou matrícula", () => {
    assert.equal(displayOrDash(null), "—");
    assert.equal(displayOrDash("  "), "—");
    assert.equal(displayOrDash("Produção"), "Produção");
    assert.equal(isOpenEvaluationStatus("CANCELLED"), false);
    assert.equal(isOpenEvaluationStatus("COMPLETED"), false);
    assert.equal(
      evaluationAlert({
        id: "1",
        evaluationType: "EXPERIENCE_45_DAYS",
        status: "WAITING_RETURN",
        dueDate: "2026-09-30",
        todayIso: "2026-09-22",
      })?.message,
      "Avaliação de 45 dias aguardando retorno do líder."
    );
    assert.equal(
      evaluationAlert({
        id: "2",
        evaluationType: "EXPERIENCE_45_DAYS",
        status: "READY_TO_PRINT",
        dueDate: "2026-09-20",
        todayIso: "2026-09-22",
      })?.message,
      "Avaliação de 45 dias vencida."
    );
    assert.equal(
      evaluationAlert({
        id: "3",
        evaluationType: "EXPERIENCE_FINAL",
        status: "SCHEDULED",
        dueDate: "2026-10-20",
        todayIso: "2026-09-22",
      })?.message,
      "Avaliação final pendente."
    );
    assert.equal(
      evaluationAlert({
        id: "4",
        evaluationType: "EXPERIENCE_45_DAYS",
        status: "CANCELLED",
        dueDate: "2026-09-01",
        todayIso: "2026-09-22",
      }),
      null
    );
    assert.equal(HR_EVALUATION_CRITERION_SEEDS.length, 12);
  });

  it("aceita PDF, JPG e PNG e recusa outros anexos", () => {
    assert.equal(isAllowedEvaluationAttachment("application/pdf", "form.pdf"), true);
    assert.equal(isAllowedEvaluationAttachment("image/jpeg", "foto.jpg"), true);
    assert.equal(isAllowedEvaluationAttachment("image/png", "foto.png"), true);
    assert.equal(isAllowedEvaluationAttachment("image/gif", "foto.gif"), false);
    assert.equal(isAllowedEvaluationAttachment("", "scan.JPEG"), true);
  });

  it("registra texto de histórico só na conclusão", () => {
    assert.equal(
      historyNoteForCompletedEvaluation({ evaluationType: "EXPERIENCE_45_DAYS", average: 3.92 }),
      "Avaliação de experiência de 45 dias concluída — média 3,92."
    );
    const summary = buildHistorySummary({
      eventType: "EXPERIENCE_EVALUATION",
      notes: "Avaliação de experiência de 45 dias concluída — média 3,92.",
    });
    assert.match(summary.summary, /3,92/);
  });

  it("separa ver, registrar, concluir e imprimir", () => {
    const view = buildPeopleProfileCapabilities(check(["employees.view"]));
    assert.equal(view.canViewEvaluations, true);
    assert.equal(view.canPrintEvaluations, true);
    assert.equal(view.canManageEvaluations, false);
    assert.equal(view.canCompleteEvaluations, false);

    const editor = buildPeopleProfileCapabilities(check(["employees.edit"]));
    assert.equal(editor.canManageEvaluations, true);
    assert.equal(editor.canCompleteEvaluations, true);
    assert.equal(editor.canAttachEvaluationDocuments, true);

    const leader = buildPeopleProfileCapabilities(check(["employees.team.view"]));
    assert.equal(leader.canViewEvaluations, false);

    const finisher = buildPeopleProfileCapabilities(check(["employees.evaluations.complete"]));
    assert.equal(finisher.canCompleteEvaluations, true);
    assert.equal(finisher.canManageEvaluations, false);
  });
});

describe("impressão A4 da avaliação", () => {
  it("segue o cabeçalho institucional e o retrato A4 sem chrome da aplicação", () => {
    const doc = readFileSync(
      join(ROOT, "src/components/employee/ExperienceEvaluationPrintDocument.tsx"),
      "utf8"
    );
    const view = readFileSync(
      join(ROOT, "src/components/employee/ExperienceEvaluationPrintView.tsx"),
      "utf8"
    );
    const css = readFileSync(join(ROOT, "src/components/employee/hr-evaluation-print.css"), "utf8");
    const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
    assert.ok(doc.includes("PrintHeader"));
    assert.ok(doc.includes("PrintDocumentShell"));
    assert.ok(doc.includes("Funcionário"));
    assert.ok(doc.includes("Matrícula"));
    assert.ok(doc.includes("Departamento"));
    assert.ok(doc.includes("hr-eval-mark"));
    assert.ok(doc.includes("Sem critérios registrados."));
    assert.ok(doc.includes("Ciência do colaborador"));
    assert.ok(doc.includes("HR_EVALUATION_PROMPTS.acknowledgement"));
    assert.ok(view.includes("print-no-print"));
    assert.ok(view.includes("Imprimir / Salvar PDF"));
    assert.ok(app.includes("/employees/:employeeId/evaluations/:evaluationId/print"));
    assert.match(css, /@page\s*\{[^}]*size:\s*A4 portrait/s);
    assert.ok(css.includes("print-no-print"));
    assert.ok(css.includes("overflow: visible"));
    assert.ok(css.includes("break-inside: avoid"));
    assert.ok(css.includes("page-break-inside: avoid"));
    assert.ok(!css.includes("sidebar"));
  });
});
