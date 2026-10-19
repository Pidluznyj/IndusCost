/**
 * Documento impresso do módulo no padrão institucional (PrintDocumentShell + PrintHeader).
 * Código único e versão vêm da emissão registrada no servidor. Não leva QR público da
 * avaliação nem ocorrência de conduta.
 */
import React from "react";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { PrintSection } from "@/src/components/print/PrintSection";
import { PrintTable } from "@/src/components/print/PrintTable";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import {
  CULTURE_BAND_LABELS,
  CYCLE_STATUS_LABELS,
  ELIGIBILITY_LABELS,
  NINE_BOX_BAND_LABELS,
  NOT_OBSERVED_LABEL,
  PDI_STATUS_LABELS,
  PILLARS,
  PILLAR_LABELS,
  TECHNICAL_VALIDATION_LABELS,
  UNCLASSIFIED_QUADRANT,
  formatCut,
  formatDateBr,
  formatPillarMean,
  scoreLabel,
  type NineBoxBand,
} from "@/src/lib/hrPerformance/performanceDomain";
import type { ReportIssue } from "@/src/lib/hrPerformance/performanceClient";

export const REPORT_TITLES: Record<string, string> = {
  individual: "Avaliação individual de desempenho",
  devolutiva: "Registro de devolutiva",
  pdi: "Plano de desenvolvimento individual",
  consolidado: "Consolidado gerencial do ciclo",
  ninebox: "Nine-Box do ciclo",
  historico: "Histórico de avaliações",
  lideranca: "Avaliação de liderança (180°)",
};

const label = <T extends string>(map: Record<T, string>, key: string | null | undefined) => (key ? map[key as T] ?? key : "—");
const quadrant = (q: string | null | undefined) => (!q || q === UNCLASSIFIED_QUADRANT ? "Sem classificação" : q);
const meanOf = (sum: number | undefined, count: number | undefined) => (count ? formatPillarMean(sum ?? 0, count) ?? "—" : "—");

function dateTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function PerformanceReportDocument({ data, issue, branding }: { data: any; issue: ReportIssue; branding: BrandingSettingsDTO }) {
  const kind: string = data.kind;
  const cycle = data.cycle;
  const person = data.person;
  const rules = data.model?.rules;
  const official = person?.result?.official;
  return (
    <PrintDocumentShell
      rootId="perf-print-root"
      className="perf-sheet"
      footer={
        <span>
          Documento interno de RH · IndusCost · uso restrito · {issue.code} · versão {issue.version} · emitido em {dateTime(issue.issuedAt)}
          {issue.issuedByName ? ` por ${issue.issuedByName}` : ""}. Perguntas, escala e cortes em validação (proposta {rules?.ruleSetId ?? "—"}).
        </span>
      }
    >
      <PrintHeader
        branding={branding}
        documentKind="Recursos Humanos · Desempenho e Cultura"
        documentTitle={REPORT_TITLES[kind] ?? "Documento"}
        metaLines={[
          { label: "Código", value: issue.code },
          { label: "Versão", value: String(issue.version) },
          { label: "Emissão", value: dateTime(issue.issuedAt) },
          { label: "Emitido por", value: issue.issuedByName ?? "—" },
        ]}
        subtitle={`${cycle.name} · ${cycle.periodLabel} · ${label(CYCLE_STATUS_LABELS, cycle.status)} · modelo ${data.model?.name ?? ""} v${data.model?.version ?? ""}`}
      />
      {cycle.classification === "TEST" ? (
        <p className="perf-test-stamp" data-testid="perf-print-test-stamp">
          Ciclo de teste — sem valor oficial. Este documento não compõe indicadores nem histórico oficial.
        </p>
      ) : data.governance && !data.governance.officialEligible ? (
        <p className="perf-note">Resultado fora dos indicadores oficiais: {(data.governance.reasons ?? []).join(" ")}</p>
      ) : null}

      {person ? (
        <dl className="perf-identity" data-testid="perf-print-identity">
          <div>
            <dt>Colaborador</dt>
            <dd>{person.participant.employeeName}</dd>
          </div>
          <div>
            <dt>Cargo</dt>
            <dd>{person.participant.roleName}</dd>
          </div>
          <div>
            <dt>Setor</dt>
            <dd>{person.participant.departmentName}</dd>
          </div>
          <div>
            <dt>Líder avaliador</dt>
            <dd>{person.participant.managerName ?? "—"}</dd>
          </div>
          <div>
            <dt>Elegibilidade</dt>
            <dd>{label(ELIGIBILITY_LABELS, person.participant.eligibility)}</dd>
          </div>
          <div>
            <dt>Situação do resultado</dt>
            <dd>{person.result ? (official ? "Oficial · homologado" : "Preliminar") : "Sem resultado"}</dd>
          </div>
        </dl>
      ) : null}

      {kind === "individual" && person ? <IndividualSections person={person} rules={rules} /> : null}
      {(kind === "devolutiva" || kind === "individual") && person ? <FeedbackSection person={person} signatures={kind === "devolutiva"} /> : null}
      {(kind === "pdi" || kind === "individual" || kind === "devolutiva") && person ? <PdiSection person={person} /> : null}
      {(kind === "historico" || kind === "individual") && person ? <HistorySection person={person} /> : null}
      {kind === "consolidado" ? <ConsolidatedSections data={data} /> : null}
      {kind === "ninebox" ? <NineBoxSection data={data} /> : null}
      {kind === "lideranca" && data.leadership ? <LeadershipSection view={data.leadership} /> : null}

      <PrintSection title="Regras e limites">
        <p className="perf-note">
          Média por pilar = soma das notas de 1 a 4 ÷ respostas válidas; “{NOT_OBSERVED_LABEL}” não pontua. Mínimo de {rules?.minValidAnswers ?? 3} respostas válidas por pilar. Cortes da Nine-Box:
          abaixo de {rules ? formatCut(rules.nineBoxLowCut) : "2,50"} é baixo; a partir de {rules ? formatCut(rules.nineBoxHighCut) : "3,50"} é alto. A cultura é indicador próprio e não entra na matriz. Nenhuma
          promoção, remuneração ou penalidade é aplicada por este documento.
        </p>
      </PrintSection>
    </PrintDocumentShell>
  );
}

function IndividualSections({ person, rules }: { person: any; rules: any }) {
  const r = person.result;
  return (
    <>
      <PrintSection title="Resultado por pilar">
        <PrintTable>
          <thead>
            <tr>
              <th>Pilar</th>
              <th>Autoavaliação</th>
              <th>Avaliação do líder</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {PILLARS.map((pillar) => (
              <tr key={pillar}>
                <td>{PILLAR_LABELS[pillar]}</td>
                <td>{person.self?.[pillar]?.display ?? "—"}</td>
                <td>{person.leader?.[pillar]?.display ?? "—"}</td>
                <td>
                  {person.leader?.[pillar]?.insufficient ? "Evidência insuficiente. " : ""}
                  {person.leader?.[pillar]?.notObserved ? `${person.leader[pillar].notObserved} resposta(s) “não sei”.` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </PrintTable>
        <p className="perf-note">A nota oficial de desempenho e de potencial usa a avaliação do líder. A autoavaliação é mostrada para comparação.</p>
      </PrintSection>
      <PrintSection title="Posição e cultura">
        <PrintTable>
          <tbody>
            <tr>
              <th style={{ width: "34%" }}>Nine-Box</th>
              <td>
                {quadrant(r?.quadrant)} · {r?.official ? "oficial" : "preliminar"}
                {r?.adjusted ? " · ajustada na calibração" : ""}
              </td>
            </tr>
            <tr>
              <th>Desempenho técnico (líder)</th>
              <td>
                {meanOf(r?.technicalSum, r?.technicalCount)} · {label(TECHNICAL_VALIDATION_LABELS, r?.technicalValidation)}
                {r?.validationNote ? ` · ${r.validationNote}` : ""}
              </td>
            </tr>
            <tr>
              <th>Potencial (líder)</th>
              <td>{meanOf(r?.potentialSum, r?.potentialCount)}</td>
            </tr>
            <tr>
              <th>Cultura e comportamento</th>
              <td>
                {label(CULTURE_BAND_LABELS, r?.cultureBand)} · média {meanOf(r?.cultureSum, r?.cultureCount)}. {r?.cultureBasis}
              </td>
            </tr>
            {r?.calibrationNote ? (
              <tr>
                <th>Calibração</th>
                <td>{r.calibrationNote}</td>
              </tr>
            ) : null}
          </tbody>
        </PrintTable>
      </PrintSection>
      <PrintSection title="Avaliação do líder por competência" flow>
        <PrintTable>
          <thead>
            <tr>
              <th style={{ width: "26%" }}>Competência</th>
              <th style={{ width: "24%" }}>Frequência observada</th>
              <th>Exemplo registrado</th>
            </tr>
          </thead>
          <tbody>
            {(person.leaderAnswers ?? []).map((a: any) => (
              <tr key={a.code}>
                <td>
                  {a.code} · {a.competency}
                </td>
                <td>{a.notObserved ? NOT_OBSERVED_LABEL : a.score ? `${a.score} · ${scoreLabel(a.score)}` : "—"}</td>
                <td>{a.evidence ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </PrintTable>
        {person.divergences?.length ? (
          <p className="perf-note">
            Divergências de {rules?.divergenceThreshold ?? 2} pontos ou mais entre pessoa e líder: {person.divergences.map((d: any) => d.questionCode).join(", ")}. Divergência não muda nota sozinha.
          </p>
        ) : null}
      </PrintSection>
    </>
  );
}

/** Comparativo de liderança. A equipe só aparece como média divulgável; nenhum comentário dos liderados. */
function LeadershipSection({ view }: { view: any }) {
  const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const r = view.result;
  return (
    <>
      <PrintSection title="Perspectivas e nota calibrada">
        <p className="perf-note">
          Equipe: {view.coverage.teamRespondents ?? "—"} de {view.coverage.teamInvited} responderam (mínimo {view.rules.minRespondents} para divulgar)
          {view.team.message ? ` · ${view.team.message}` : ""}. A nota calibrada é decisão do superior, inteira de 1 a 4, e não uma média automática.
        </p>
        <PrintTable>
          <thead>
            <tr>
              <th>Competência</th>
              <th>Equipe</th>
              <th>Autoavaliação</th>
              <th>Superior</th>
              <th>Calibrada</th>
              <th>Justificativa</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row: any) => (
              <tr key={row.code}>
                <td>
                  {row.code} · {row.competency}
                </td>
                <td>{row.teamDisclosed ? fmt(row.team) : "Insuficiente"}</td>
                <td>{row.self ?? "—"}</td>
                <td>{row.superior ?? "—"}</td>
                <td>{r?.scores[row.code] ?? "—"}</td>
                <td>{r?.justifications[row.code] ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </PrintTable>
      </PrintSection>
      {r ? (
        <PrintSection title="Síntese">
          <PrintTable>
            <tbody>
              <tr>
                <th style={{ width: "30%" }}>Índice calibrado</th>
                <td>
                  {fmt(r.index)} · versão {r.version} · {r.official ? "homologada" : r.status === "EXCEPTION" ? "exceção registrada" : "calibrada"}
                </td>
              </tr>
              <tr>
                <th>Mais fortes</th>
                <td>{r.strengths.map((s: any) => s.competency).join(", ") || "—"}</td>
              </tr>
              <tr>
                <th>Prioridades de desenvolvimento</th>
                <td>{r.priorities.map((s: any) => s.competency).join(", ") || "—"}</td>
              </tr>
              <tr>
                <th>Fundamentação</th>
                <td>{r.generalNote}</td>
              </tr>
              {r.exceptionReason ? (
                <tr>
                  <th>Exceção</th>
                  <td>{r.exceptionReason}</td>
                </tr>
              ) : null}
            </tbody>
          </PrintTable>
        </PrintSection>
      ) : null}
    </>
  );
}

function FeedbackSection({ person, signatures }: { person: any; signatures: boolean }) {
  const f = person.feedback;
  return (
    <PrintSection title="Devolutiva">
      {!f ? (
        <p className="perf-note">Devolutiva ainda não registrada.</p>
      ) : (
        <>
          <PrintTable>
            <tbody>
              <tr>
                <th style={{ width: "30%" }}>Ponto forte</th>
                <td>{f.strength}</td>
              </tr>
              <tr>
                <th>Ponto de desenvolvimento</th>
                <td>{f.improvement}</td>
              </tr>
              <tr>
                <th>Ação combinada</th>
                <td>
                  {f.action} · responsável {f.ownerName} · prazo {formatDateBr(f.dueAt)}
                </td>
              </tr>
              <tr>
                <th>Conversa</th>
                <td>{formatDateBr(f.conversationAt)}</td>
              </tr>
              <tr>
                <th>Ciência</th>
                <td>
                  {f.acknowledgedAt ? `Registrada em ${formatDateBr(f.acknowledgedAt)}${f.acknowledgedVia === "ASSISTED" ? " (presencial)" : ""}` : "Pendente"}. Ciência não significa concordância.
                </td>
              </tr>
              <tr>
                <th>Concordância</th>
                <td>{f.agreedAt ? `Registrada em ${formatDateBr(f.agreedAt)}` : "Não registrada"}</td>
              </tr>
              {f.contestation ? (
                <tr>
                  <th>Contestação</th>
                  <td>{f.contestation}</td>
                </tr>
              ) : null}
              {f.collaboratorNote ? (
                <tr>
                  <th>Observação do colaborador</th>
                  <td>{f.collaboratorNote}</td>
                </tr>
              ) : null}
            </tbody>
          </PrintTable>
          {signatures ? (
            <div className="perf-sign">
              <div>Colaborador · ciência (não implica concordância)</div>
              <div>Líder responsável pela conversa</div>
            </div>
          ) : null}
        </>
      )}
    </PrintSection>
  );
}

function PdiSection({ person }: { person: any }) {
  const pdis = person.pdis ?? [];
  return (
    <PrintSection title="Plano de desenvolvimento" flow>
      {pdis.length === 0 ? (
        <p className="perf-note">Nenhuma ação registrada.</p>
      ) : (
        <PrintTable>
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Ação</th>
              <th>Competência</th>
              <th>Responsável</th>
              <th>Prazo</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {pdis.map((p: any) => (
              <tr key={p.id}>
                <td>
                  {p.title}
                  {p.priority ? " (prioritária)" : ""}
                  {p.objective ? <div className="perf-note">{p.objective}</div> : null}
                  {p.justification ? <div className="perf-note">Justificativa: {p.justification}</div> : null}
                </td>
                <td>{p.competencyCode ?? "—"}</td>
                <td>{p.ownerName}</td>
                <td>{formatDateBr(p.dueAt)}</td>
                <td>{label(PDI_STATUS_LABELS, p.status)}</td>
              </tr>
            ))}
          </tbody>
        </PrintTable>
      )}
      {person.checkins?.length ? (
        <ul className="perf-note">
          {person.checkins.map((c: any, index: number) => (
            <li key={`${c.pdiId}-${index}`}>
              {formatDateBr(c.createdAt)} · {c.note}
              {c.obstacle ? ` · obstáculo: ${c.obstacle}` : ""}
              {c.nextStep ? ` · próximo passo: ${c.nextStep}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </PrintSection>
  );
}

function HistorySection({ person }: { person: any }) {
  const cycles = person.history?.cycles ?? [];
  return (
    <PrintSection title="Histórico (somente resultados homologados)" flow>
      {cycles.length === 0 ? (
        <p className="perf-note">Sem ciclos anteriores.</p>
      ) : (
        <PrintTable>
          <thead>
            <tr>
              <th>Ciclo</th>
              <th>Cargo · setor na época</th>
              <th>Técnico</th>
              <th>Potencial</th>
              <th>Cultura</th>
              <th>Posição</th>
              <th>Comparável</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c: any) => (
              <tr key={c.cycleId}>
                <td>
                  {c.cycleName}
                  <div className="perf-note">
                    {c.periodLabel} · modelo v{c.modelVersion}
                  </div>
                </td>
                <td>
                  {c.roleName} · {c.departmentName}
                </td>
                <td>{c.technical ?? "—"}</td>
                <td>{c.potential ?? "—"}</td>
                <td>{label(CULTURE_BAND_LABELS, c.cultureBand)}</td>
                <td>{c.quadrant ? quadrant(c.quadrant) : "Não homologado"}</td>
                <td>{c.comparableWithPrevious == null ? "—" : c.comparableWithPrevious ? "Sim" : "Metodologia mudou"}</td>
              </tr>
            ))}
          </tbody>
        </PrintTable>
      )}
    </PrintSection>
  );
}

function ConsolidatedSections({ data }: { data: any }) {
  const c = data.counts;
  return (
    <>
      <PrintSection title="Situação do ciclo">
        <PrintTable>
          <tbody>
            <tr>
              <th>Elegíveis</th>
              <td>{c.eligible}</td>
              <th>Não elegíveis</th>
              <td>{c.notEligible}</td>
              <th>Evidência insuficiente</th>
              <td>{c.insufficient}</td>
            </tr>
            <tr>
              <th>Autoavaliações</th>
              <td>
                {c.selfSubmitted} de {c.eligible}
              </td>
              <th>Avaliações do líder</th>
              <td>
                {c.leaderSubmitted} de {c.withLeader}
              </td>
              <th>Calibrados</th>
              <td>{c.calibrated}</td>
            </tr>
            <tr>
              <th>Homologados</th>
              <td>{c.official}</td>
              <th>Devolutivas</th>
              <td>{c.feedback}</td>
              <th>PDI abertos</th>
              <td>{c.pdiOpen}</td>
            </tr>
          </tbody>
        </PrintTable>
      </PrintSection>
      <PrintSection title="Pessoas elegíveis" flow>
        <PrintTable>
          <thead>
            <tr>
              <th style={{ width: "24%" }}>Colaborador</th>
              <th>Cargo · setor</th>
              <th>Técnico</th>
              <th>Potencial</th>
              <th>Cultura</th>
              <th style={{ width: "24%" }}>Posição</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p: any) => (
              <tr key={p.participantId}>
                <td>{p.employeeName}</td>
                <td>
                  {p.roleName} · {p.departmentName}
                </td>
                <td>{meanOf(p.result?.technicalSum, p.result?.technicalCount)}</td>
                <td>{meanOf(p.result?.potentialSum, p.result?.potentialCount)}</td>
                <td>{label(CULTURE_BAND_LABELS, p.result?.cultureBand)}</td>
                <td>
                  {quadrant(p.result?.quadrant)} · {p.result?.official ? "oficial" : "preliminar"}
                </td>
              </tr>
            ))}
          </tbody>
        </PrintTable>
      </PrintSection>
    </>
  );
}

function NineBoxSection({ data }: { data: any }) {
  const people = data.people as any[];
  const rows: NineBoxBand[] = ["HIGH", "MID", "LOW"];
  const cols: NineBoxBand[] = ["LOW", "MID", "HIGH"];
  const placed = people.filter((p) => p.result?.nineX && p.result?.nineY && p.result.quadrant !== UNCLASSIFIED_QUADRANT);
  const unplaced = people.length - placed.length;
  return (
    <PrintSection title="Distribuição desempenho × potencial">
      <div className="perf-nine">
        <div />
        {cols.map((x) => (
          <div key={x} className="perf-nine-axis">
            Desempenho {NINE_BOX_BAND_LABELS[x]}
          </div>
        ))}
        {rows.map((y) => (
          <React.Fragment key={y}>
            <div className="perf-nine-axis">Potencial {NINE_BOX_BAND_LABELS[y]}</div>
            {cols.map((x) => {
              const inCell = placed.filter((p) => p.result.nineX === x && p.result.nineY === y);
              return (
                <div key={`${x}${y}`} className="perf-nine-cell">
                  <strong>{inCell.length}</strong>
                  {inCell.map((p) => `${p.employeeName}${p.result.official ? "" : " (prel.)"}`).join(", ")}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="perf-note">
        Sem classificação (evidência insuficiente ou técnico não validado): {unplaced}. “prel.” = preliminar, ainda não homologado. A cultura não é eixo desta matriz.
      </p>
    </PrintSection>
  );
}
