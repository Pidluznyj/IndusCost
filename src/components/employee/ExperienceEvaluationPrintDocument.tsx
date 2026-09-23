import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import {
  HR_EVALUATION_NA_LABEL,
  HR_EVALUATION_PROMPTS,
  HR_EVALUATION_SCORE_LEGEND,
  displayOrDash,
  evaluationPrintSubtitle,
  evaluationPrintTitle,
  evaluationQrPayload,
  recommendationsFor,
  type HrEmployeeEvaluationDto,
} from "@/src/lib/hrEvaluation";
import "./hr-evaluation-print.css";

function formatBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function WriteLines({ count }: { count: number }) {
  return (
    <div>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="hr-eval-line" />
      ))}
    </div>
  );
}

export function ExperienceEvaluationPrintDocument({
  evaluation,
  branding,
}: {
  evaluation: HrEmployeeEvaluationDto;
  branding: BrandingSettingsDTO;
}) {
  const recommendations = recommendationsFor(evaluation.evaluationType);
  const period = [formatBr(evaluation.periodStart), formatBr(evaluation.periodEnd)]
    .filter((part) => part !== "—")
    .join(" a ");

  return (
    <PrintDocumentShell
      rootId="hr-eval-print-root"
      className="hr-eval-sheet"
      footer="Documento interno de RH · IndusCost · uso restrito"
    >
      <PrintHeader
        branding={branding}
        documentKind="Recursos Humanos"
        documentTitle={evaluationPrintTitle(evaluation.evaluationType)}
        subtitle={evaluationPrintSubtitle(evaluation.evaluationType)}
        metaLines={[
          { label: "Código", value: evaluation.referenceCode },
          { label: "Situação", value: evaluation.statusLabel },
          { label: "Prevista", value: formatBr(evaluation.dueDate) },
        ]}
      />

      <div className="hr-eval-code-row">
        <dl className="hr-eval-identity">
          <div>
            <dt>Funcionário</dt>
            <dd>{displayOrDash(evaluation.employeeName)}</dd>
          </div>
          <div>
            <dt>Matrícula</dt>
            <dd>{displayOrDash(evaluation.registration)}</dd>
          </div>
          <div>
            <dt>Cargo</dt>
            <dd>{displayOrDash(evaluation.roleName)}</dd>
          </div>
          <div>
            <dt>Departamento</dt>
            <dd>{displayOrDash(evaluation.department)}</dd>
          </div>
          <div>
            <dt>Líder</dt>
            <dd>{displayOrDash(evaluation.managerName)}</dd>
          </div>
          <div>
            <dt>Admissão</dt>
            <dd>{formatBr(evaluation.admissionDate)}</dd>
          </div>
          <div>
            <dt>Tipo de avaliação</dt>
            <dd>{evaluation.typeLabel}</dd>
          </div>
          <div>
            <dt>Período avaliado</dt>
            <dd>{period || "—"}</dd>
          </div>
          <div>
            <dt>Código da avaliação</dt>
            <dd>{evaluation.referenceCode}</dd>
          </div>
        </dl>
        <QRCodeSVG
          className="hr-eval-qr"
          value={evaluationQrPayload(evaluation.referenceCode, evaluation.id)}
          size={84}
          marginSize={0}
          title={evaluation.referenceCode}
        />
      </div>

      <table className="hr-eval-table print-table">
        <thead>
          <tr>
            <th>Critério</th>
            <th>1</th>
            <th>2</th>
            <th>3</th>
            <th>4</th>
            <th>5</th>
            <th>N/A</th>
          </tr>
        </thead>
        <tbody>
          {evaluation.answers.length === 0 ? (
            <tr>
              <td colSpan={7}>Sem critérios registrados.</td>
            </tr>
          ) : null}
          {evaluation.answers.map((answer) => (
            <tr key={answer.id}>
              <td>{answer.name}</td>
              {[1, 2, 3, 4, 5].map((score) => (
                <td key={score} className="hr-eval-mark-cell">
                  <span className="hr-eval-mark" />
                </td>
              ))}
              <td className="hr-eval-mark-cell">
                <span className="hr-eval-mark" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hr-eval-legend">
        {HR_EVALUATION_SCORE_LEGEND.map((item) => (
          <p key={item.score}>
            {item.score} — {item.label}
          </p>
        ))}
        <p>N/A — {HR_EVALUATION_NA_LABEL}</p>
      </div>

      <section className="hr-eval-block">
        <h2 className="print-section-title">Pontos fortes</h2>
        <p className="hr-eval-prompt">{HR_EVALUATION_PROMPTS.strengths}</p>
        <WriteLines count={3} />
      </section>
      <section className="hr-eval-block">
        <h2 className="print-section-title">Pontos a desenvolver</h2>
        <p className="hr-eval-prompt">{HR_EVALUATION_PROMPTS.development}</p>
        <WriteLines count={3} />
      </section>
      <section className="hr-eval-block">
        <h2 className="print-section-title">Orientações / plano de acompanhamento</h2>
        <p className="hr-eval-prompt">{HR_EVALUATION_PROMPTS.printGuidance}</p>
        <WriteLines count={3} />
      </section>

      <section className="hr-eval-block">
        <h2 className="print-section-title">Recomendação</h2>
        {recommendations.map((item) => (
          <p key={item.code} className="hr-eval-check">
            <span className="hr-eval-box" />
            <span>{item.label}</span>
          </p>
        ))}
        <p className="hr-eval-prompt">Justificativa:</p>
        <WriteLines count={2} />
      </section>

      <div className="hr-eval-close">
        <section className="hr-eval-signatures">
          <div>
            <strong>Líder responsável</strong>
            <p className="hr-eval-sign-line">Nome:</p>
            <p className="hr-eval-sign-line">Data:</p>
          </div>
          <div>
            <strong>RH</strong>
            <p className="hr-eval-sign-line">Nome:</p>
            <p className="hr-eval-sign-line">Data:</p>
          </div>
          <div>
            <strong>Ciência do colaborador</strong>
            <p className="hr-eval-sign-line">Nome:</p>
            <p className="hr-eval-sign-line">Data:</p>
          </div>
        </section>
        <p className="hr-eval-disclaimer">{HR_EVALUATION_PROMPTS.acknowledgement}</p>
      </div>
    </PrintDocumentShell>
  );
}
