/**
 * Ficha funcional › Competências. Somente leitura: consome os endpoints do módulo
 * Competências e Desenvolvimento (mesma engine, mesmo escopo hierárquico). Nada é copiado
 * para a ficha; para avaliar ou alterar níveis, o usuário vai ao módulo.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink } from "lucide-react";
import { usePermissions } from "@/src/hooks/usePermissions";
import type { UiPermissionAction } from "@/src/lib/actionPermissionAccess";
import { COMPETENCY_MODULE_PATH, resolveCompetencyCapabilities } from "@/src/lib/competencies/competencyAccess";
import {
  fetchCompetencyAssessments,
  fetchEmployeeCompetencyProfile,
  fetchTrainings,
} from "@/src/lib/competencies/competencyClient";
import {
  COMPETENCY_LEVEL_SOURCE_LABELS,
  competencyCategoryLabel,
  formatIsoDateBr,
} from "@/src/lib/competencies/competencyDomain";
import type {
  CompetencyAssessmentDto,
  EmployeeCompetencyProfileDto,
  TrainingDto,
} from "@/src/lib/competencies/competencyTypes";
import { HttpError } from "@/src/lib/http";
import { AssessmentStatusBadge, LevelChip, TrainingStatusBadge } from "@/src/components/competencies/competencyUi";
import { ProfileState, formatProfileDateTime } from "./profileUi";

type Loaded = {
  profile: EmployeeCompetencyProfileDto;
  assessments: CompetencyAssessmentDto[] | null;
  trainings: TrainingDto[] | null;
};

const TH = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2 align-middle";

/** Mesmo visual de `ProfileSection`, sem o `<dl>` (aqui o conteúdo é tabela/lista). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h4>
      <div className="mb-3 h-px bg-border" />
      {children}
    </section>
  );
}

function sourceLabel(source: string): string {
  return COMPETENCY_LEVEL_SOURCE_LABELS[source as keyof typeof COMPETENCY_LEVEL_SOURCE_LABELS] ?? source;
}

export function PeopleCompetenciesTab({ employeeId }: { employeeId: string }) {
  const { canPerformAction } = usePermissions();
  const caps = useMemo(
    () => resolveCompetencyCapabilities((rk, action) => canPerformAction(rk, action as UiPermissionAction)),
    [canPerformAction],
  );
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; data: Loaded } | { kind: "error"; message: string; forbidden: boolean }
  >({ kind: "loading" });

  const load = useCallback(
    async (signal: AbortSignal) => {
      setState({ kind: "loading" });
      try {
        const [profile, assessments, trainings] = await Promise.all([
          fetchEmployeeCompetencyProfile(employeeId, signal),
          caps.viewAssessments ? fetchCompetencyAssessments(signal, employeeId).then((r) => r.assessments) : Promise.resolve(null),
          caps.viewTrainings ? fetchTrainings(signal, employeeId).then((r) => r.trainings) : Promise.resolve(null),
        ]);
        if (!signal.aborted) setState({ kind: "ready", data: { profile, assessments, trainings } });
      } catch (error) {
        if (signal.aborted) return;
        const status = error instanceof HttpError ? error.status : 0;
        setState({
          kind: "error",
          forbidden: status === 403 || status === 404,
          message:
            status === 404
              ? "Este colaborador está fora do seu escopo em Competências."
              : status === 403
                ? "🔒 Sem permissão para Competências e Desenvolvimento."
                : error instanceof Error && error.message
                  ? error.message
                  : "Não foi possível carregar as competências.",
        });
      }
    },
    [employeeId, caps.viewAssessments, caps.viewTrainings],
  );

  useEffect(() => {
    if (!caps.view) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [caps.view, load]);

  if (!caps.view) return <ProfileState kind="forbidden" message="🔒 Sem permissão para Competências e Desenvolvimento." />;
  if (state.kind === "loading") return <ProfileState kind="loading" message="Carregando competências…" />;
  if (state.kind === "error") return <ProfileState kind={state.forbidden ? "forbidden" : "error"} message={state.message} />;

  const { profile, assessments, trainings } = state.data;
  const myTrainings = (trainings ?? []).map((t) => ({
    ...t,
    mine: t.participants.find((p) => p.employeeId === employeeId) ?? null,
  }));

  return (
    <div data-testid="people-competencies-tab">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Departamento</p>
          <p className="text-base font-semibold" data-testid="people-competencies-department">
            {profile.department ? profile.department.name : "Sem departamento"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm" data-testid="people-competencies-summary">
          <span>
            Avaliadas{" "}
            <strong className="tabular-nums">
              {profile.associated.filter((item) => item.storedLevel > 0).length}
            </strong>
            <span className="text-muted-foreground"> de {profile.associated.length}</span>
          </span>
          <Link to={COMPETENCY_MODULE_PATH} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Abrir módulo <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>

      <Section title="Competências do departamento">
        {profile.associated.length === 0 ? (
          <ProfileState kind="empty" message={profile.department ? "Nenhuma competência associada a este departamento." : "Colaborador sem departamento oficial."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="people-competencies-associated">
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>Competência</th>
                  <th className={TH}>Nível</th>
                  <th className={TH}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {profile.associated.map((r) => (
                  <tr key={r.competencyId} className="border-b border-border/60 last:border-b-0">
                    <td className={TD}>
                      <span className="block font-medium">{r.competencyName}</span>
                      <span className="block text-xs text-muted-foreground">{competencyCategoryLabel(r.category)}</span>
                    </td>
                    <td className={TD}>
                      <LevelChip level={r.currentLevel} />
                    </td>
                    <td className={TD}>
                      {r.recycling === "EXPIRED" ? (
                        <span className="text-xs font-semibold text-rose-700">
                          Reciclagem vencida em {formatIsoDateBr(r.recyclingExpiresOn)} (registrado: {r.storedLevel})
                        </span>
                      ) : r.storedLevel > 0 ? (
                        <span className="text-xs font-semibold text-emerald-700">Avaliada</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Não avaliada</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {profile.otherLevels.length > 0 ? (
        <Section title="Outras competências registradas">
          <ul className="flex flex-wrap gap-2">
            {profile.otherLevels.map((o) => (
              <li key={o.competencyId} className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm">
                {o.competencyName}
                <LevelChip level={o.currentLevel} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {assessments ? (
        <Section title="Avaliações de competência">
          {assessments.length === 0 ? (
            <ProfileState kind="empty" message="Nenhuma avaliação registrada." />
          ) : (
            <table className="w-full text-sm" data-testid="people-competencies-assessments">
              <tbody>
                {assessments.map((a) => (
                  <tr key={a.id} className="border-b border-border/60 last:border-b-0">
                    <td className={`${TD} tabular-nums`}>{formatIsoDateBr(a.assessmentDate)}</td>
                    <td className={TD}>{a.evaluatorName ?? "—"}</td>
                    <td className={`${TD} tabular-nums`}>Média {a.averageLabel}</td>
                    <td className={TD}>
                      <AssessmentStatusBadge status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : null}

      {trainings ? (
        <Section title="Treinamentos">
          {myTrainings.length === 0 ? (
            <ProfileState kind="empty" message="Nenhum treinamento." />
          ) : (
            <table className="w-full text-sm" data-testid="people-competencies-trainings">
              <tbody>
                {myTrainings.map((t) => (
                  <tr key={t.id} className="border-b border-border/60 last:border-b-0">
                    <td className={TD}>
                      <span className="block font-medium">{t.title}</span>
                      <span className="block text-xs text-muted-foreground">{t.competencyName}</span>
                    </td>
                    <td className={`${TD} tabular-nums`}>{formatIsoDateBr(t.startDate)}</td>
                    <td className={TD}>
                      <TrainingStatusBadge status={t.status} />
                    </td>
                    <td className={`${TD} text-xs text-muted-foreground`}>
                      {t.mine?.completedOn ? `Concluiu em ${formatIsoDateBr(t.mine.completedOn)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : null}

      <Section title="Histórico de níveis">
        {profile.history.length === 0 ? (
          <ProfileState kind="empty" message="Sem alterações de nível registradas." />
        ) : (
          <table className="w-full text-sm" data-testid="people-competencies-history">
            <tbody>
              {profile.history.map((h) => (
                <tr key={h.id} className="border-b border-border/60 last:border-b-0">
                  <td className={`${TD} whitespace-nowrap text-xs text-muted-foreground`}>{formatProfileDateTime(h.at)}</td>
                  <td className={TD}>{h.competencyName}</td>
                  <td className={TD}>
                    <span className="inline-flex items-center gap-1.5">
                      <LevelChip level={h.previousLevel} />
                      <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                      <LevelChip level={h.newLevel} />
                    </span>
                  </td>
                  <td className={`${TD} text-xs text-muted-foreground`}>{sourceLabel(h.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
