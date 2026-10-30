import { useEffect, useState } from "react";
import { usePermissions } from "@/src/hooks/usePermissions";
import type { UiPermissionAction } from "@/src/lib/actionPermissionAccess";
import { useCompetenciesFeature } from "@/src/components/competencies/useCompetenciesFeature";
import { COMPETENCY_RESOURCE_KEYS, resolveCompetencyCapabilities } from "@/src/lib/competencies/competencyAccess";
import { fetchEmployeeCompetencyProfile, fetchEmployeeTrainingCertificates } from "@/src/lib/competencies/competencyClient";
import { buildEmployeeRecordSheet, type EmployeeRecordSheet, type EmployeeRecordSheetInput } from "@/src/lib/employeeRecordSheet";
import type { PeopleProfileSummaryDto } from "@/src/lib/peopleProfileTypes";
import { profileFetchJson } from "./profileClient";

/** Histórico é paginado (50 por página): a ficha corrida traz tudo, com teto para não pendurar a tela. */
const HISTORY_MAX_PAGES = 40;

type Items = { items?: Array<Record<string, unknown>> };

async function settle<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Erro de leitura." };
  }
}

async function loadAllHistory(baseUrl: string, signal: AbortSignal): Promise<Items> {
  const items: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const url: string = cursor ? `${baseUrl}?cursor=${encodeURIComponent(cursor)}` : baseUrl;
    const body = (await profileFetchJson(url, { signal })) as Items & { nextCursor?: string | null };
    items.push(...(body.items ?? []));
    cursor = body.nextCursor ?? null;
    if (!cursor) break;
  }
  return { items };
}

/** Lê as mesmas guias da ficha, respeitando as mesmas permissões. Só o modelo mascarado sai daqui. */
export function useEmployeeRecordSheet(employeeId: string | undefined): {
  sheet: EmployeeRecordSheet | null;
  loading: boolean;
  error: string | null;
} {
  const { canPerformAction } = usePermissions();
  const canSeeCompetencies = canPerformAction(COMPETENCY_RESOURCE_KEYS.module, "view");
  const feature = useCompetenciesFeature(canSeeCompetencies);
  const canViewTrainings = resolveCompetencyCapabilities((rk, action) =>
    canPerformAction(rk, action as UiPermissionAction)
  ).viewTrainings;
  const [sheet, setSheet] = useState<EmployeeRecordSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // null: o servidor ainda não respondeu se o módulo de competências está ligado.
    if (!employeeId || (canSeeCompetencies && feature == null)) return;
    const ac = new AbortController();
    const { signal } = ac;
    setLoading(true);
    setError(null);
    const base = `/api/employees/${employeeId}`;
    const get = <T,>(path: string) => settle(() => profileFetchJson(`${base}/${path}`, { signal }) as Promise<T>);
    const run = async () => {
      const summary = (await profileFetchJson(`${base}/profile`, { signal })) as PeopleProfileSummaryDto;
      const caps = summary.capabilities;
      const competenciesOn = canSeeCompetencies && feature === true;
      const trainingCertificates = competenciesOn && canViewTrainings;
      const none = Promise.resolve(undefined);
      const [
        personal,
        emergency,
        professional,
        career,
        compensation,
        benefits,
        absences,
        epi,
        documents,
        uploaded,
        issued,
        competencies,
        evaluations,
        history,
        notes,
      ] = await Promise.all([
        caps.canViewPersonal ? get<Record<string, unknown>>("personal") : none,
        caps.canViewEmergency ? get("emergency") : none,
        caps.canViewProfessional ? get<Record<string, unknown>>("professional") : none,
        caps.canViewCareer ? get<Items>("career") : none,
        caps.canViewCompensationEvents ? get<Items>("compensation") : none,
        caps.canViewBenefits ? get<Items>("benefits") : none,
        caps.canViewAbsences ? get<Items>("absences") : none,
        caps.canViewEpi ? get("epi") : none,
        caps.canViewDocuments ? get<Items>("documents") : none,
        caps.canViewDocuments ? get<Items>("certificates") : none,
        trainingCertificates ? settle(() => fetchEmployeeTrainingCertificates(employeeId, signal)) : none,
        competenciesOn ? settle(() => fetchEmployeeCompetencyProfile(employeeId, signal)) : none,
        caps.canViewEvaluations ? get<Items>("evaluations") : none,
        caps.canViewHistory ? settle(() => loadAllHistory(`${base}/history`, signal)) : none,
        caps.canViewNotes ? get("notes") : none,
      ]);
      if (signal.aborted) return;
      setSheet(
        buildEmployeeRecordSheet({
          summary,
          personal,
          emergency,
          professional,
          career,
          compensation,
          benefits,
          absences,
          epi,
          documents,
          certificates: mergeCertificates(uploaded, issued),
          competencies,
          evaluations,
          history,
          notes,
        } as EmployeeRecordSheetInput)
      );
    };
    run()
      .catch((err: unknown) => {
        if (!signal.aborted) setError(err instanceof Error ? err.message : "Não foi possível montar a ficha.");
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [employeeId, canSeeCompetencies, feature, canViewTrainings]);

  return { sheet, loading, error };
}

function mergeCertificates(uploaded: unknown, issued: unknown): EmployeeRecordSheetInput["certificates"] {
  const sources = [uploaded, issued].filter((source) => source !== undefined);
  if (sources.length === 0) return undefined;
  const failed = sources.find((source) => source && typeof source === "object" && "error" in (source as object));
  if (failed) return failed as { error: string };
  return { items: sources.flatMap((source) => (source as Items).items ?? []) };
}
