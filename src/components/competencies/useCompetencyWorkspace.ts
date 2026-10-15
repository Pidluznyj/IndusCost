/**
 * Carrega os dados do módulo em paralelo (cada aba com seu próprio estado de erro)
 * e recarrega depois de cada gravação — matriz, KPIs e lacunas atualizam sem recarregar a página.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCompetencyAssessments,
  fetchCompetencyCatalog,
  fetchCompetencyMatrix,
  fetchCompetencyOptions,
  fetchCompetencyOverview,
  fetchTrainings,
  fetchWorkPositions,
} from "@/src/lib/competencies/competencyClient";
import type {
  CompetencyAssessmentDto,
  CompetencyDto,
  CompetencyMatrixResponse,
  CompetencyOptionsResponse,
  CompetencyOverviewResponse,
  TrainingDto,
  WorkPositionDto,
} from "@/src/lib/competencies/competencyTypes";
import type { CompetencyCapabilities } from "@/src/lib/competencies/competencyAccess";

export type Slice<T> =
  | { status: "loading"; data: T | null }
  | { status: "ready"; data: T }
  | { status: "error"; data: T | null; message: string };

export type CompetencyWorkspace = {
  overview: Slice<CompetencyOverviewResponse>;
  matrix: Slice<CompetencyMatrixResponse>;
  catalog: Slice<CompetencyDto[]>;
  positions: Slice<WorkPositionDto[]>;
  options: Slice<CompetencyOptionsResponse>;
  assessments: Slice<CompetencyAssessmentDto[]>;
  trainings: Slice<TrainingDto[]>;
};

type Key = keyof CompetencyWorkspace;

const initial = (): CompetencyWorkspace => ({
  overview: { status: "loading", data: null },
  matrix: { status: "loading", data: null },
  catalog: { status: "loading", data: null },
  positions: { status: "loading", data: null },
  options: { status: "loading", data: null },
  assessments: { status: "loading", data: null },
  trainings: { status: "loading", data: null },
});

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Não foi possível carregar os dados.";
}

export function useCompetencyWorkspace(caps: CompetencyCapabilities) {
  const [ws, setWs] = useState<CompetencyWorkspace>(initial);
  const controllerRef = useRef<AbortController>(new AbortController());
  /** Sequência por fatia: só a resposta mais recente de cada fatia é aplicada. */
  const seqRef = useRef<Record<string, number>>({});

  const reload = useCallback(
    async (keys?: Key[]) => {
      if (!caps.view) return;
      const { signal } = controllerRef.current;
      const loaders: { [K in Key]?: () => Promise<CompetencyWorkspace[K]["data"]> } = {
        overview: () => fetchCompetencyOverview(signal),
        matrix: () => fetchCompetencyMatrix(signal),
        catalog: () => fetchCompetencyCatalog(signal).then((r) => r.competencies),
        positions: () => fetchWorkPositions(signal).then((r) => r.positions),
        options: () => fetchCompetencyOptions(signal),
      };
      if (caps.viewAssessments) loaders.assessments = () => fetchCompetencyAssessments(signal).then((r) => r.assessments);
      if (caps.viewTrainings) loaders.trainings = () => fetchTrainings(signal).then((r) => r.trainings);
      const wanted = (keys ?? (Object.keys(loaders) as Key[])).filter((k) => loaders[k]);
      setWs((prev) => {
        const next = { ...prev };
        for (const k of wanted) next[k] = { status: "loading", data: prev[k].data } as never;
        return next;
      });
      await Promise.all(
        wanted.map(async (k) => {
          const seq = (seqRef.current[k] = (seqRef.current[k] ?? 0) + 1);
          const stale = () => signal.aborted || seqRef.current[k] !== seq;
          try {
            const data = await loaders[k]!();
            if (stale()) return;
            setWs((prev) => ({ ...prev, [k]: { status: "ready", data } }));
          } catch (error) {
            if (stale() || (error as { name?: string })?.name === "AbortError") return;
            setWs((prev) => ({ ...prev, [k]: { status: "error", data: prev[k].data, message: errorMessage(error) } }));
          }
        }),
      );
    },
    [caps.view, caps.viewAssessments, caps.viewTrainings],
  );

  useEffect(() => {
    if (controllerRef.current.signal.aborted) controllerRef.current = new AbortController();
    void reload();
  }, [reload]);

  useEffect(() => () => controllerRef.current.abort(), []);

  return { ws, reload };
}
