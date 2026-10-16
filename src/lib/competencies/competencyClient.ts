/**
 * Cliente da API de Competências e Desenvolvimento (browser-safe).
 * Erros sobem como `HttpError` (mensagem pt-BR do servidor).
 */
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { COMPETENCY_API_BASE } from "./competencyAccess";
import type { ImportResolutions } from "./competencyImport";
import type {
  CompetencyAssessmentDto,
  CompetencyImportApplyResult,
  DepartmentCompetencyBoard,
  CompetencyImportPreviewDto,
  EmployeeCompetencyProfileDto,
  LevelRequestDto,
  LevelWriteResponse,
  CompetencyDto,
  CompetencyMatrixResponse,
  CompetencyOptionsResponse,
  CompetencyOverviewResponse,
  TrainingCertificateBoardDto,
  TrainingCertificateDocumentDto,
  TrainingCertificateIssueResult,
  TrainingDto,
  WorkPositionDto,
} from "./competencyTypes";
import type { CertificateSettingsDto, CertificateSettingsInput, SyllabusModule } from "./trainingCertificate";

const NO_STORE: RequestInit = { cache: "no-store" };

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Feature flag do módulo (COMPETENCIES_ENABLED). Só exige sessão. */
export const fetchCompetenciesFeatureStatus = (signal?: AbortSignal) =>
  fetchJsonOk<{ enabled: boolean }>(`${COMPETENCY_API_BASE}/feature-status`, { ...NO_STORE, signal });

export type CompetencyBoardFilter = { departmentId?: string | null; shifts?: string[] };

function viewQuery(filter?: CompetencyBoardFilter) {
  const params = new URLSearchParams();
  if (filter?.departmentId) params.set("departmentId", filter.departmentId);
  if (filter?.shifts && filter.shifts.length > 0) params.set("shifts", filter.shifts.join(","));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const fetchCompetencyOverview = (signal?: AbortSignal, filter?: CompetencyBoardFilter) =>
  fetchJsonOk<CompetencyOverviewResponse>(`${COMPETENCY_API_BASE}/overview${viewQuery(filter)}`, { ...NO_STORE, signal });

export const fetchCompetencyMatrix = (signal?: AbortSignal, filter?: CompetencyBoardFilter) =>
  fetchJsonOk<CompetencyMatrixResponse>(`${COMPETENCY_API_BASE}/matrix${viewQuery(filter)}`, { ...NO_STORE, signal });

export const fetchCompetencyCatalog = (signal?: AbortSignal) =>
  fetchJsonOk<{ competencies: CompetencyDto[] }>(`${COMPETENCY_API_BASE}/catalog`, { ...NO_STORE, signal });

export const fetchWorkPositions = (signal?: AbortSignal) =>
  fetchJsonOk<{ positions: WorkPositionDto[] }>(`${COMPETENCY_API_BASE}/positions`, { ...NO_STORE, signal });

export const fetchCompetencyOptions = (signal?: AbortSignal) =>
  fetchJsonOk<CompetencyOptionsResponse>(`${COMPETENCY_API_BASE}/options`, { ...NO_STORE, signal });

export const fetchDepartmentCompetencies = (signal?: AbortSignal) =>
  fetchJsonOk<DepartmentCompetencyBoard>(`${COMPETENCY_API_BASE}/departments`, { ...NO_STORE, signal });

export const setDepartmentCompetencies = (
  departmentId: string,
  items: { competencyId: string; shifts: string[] | null }[],
) =>
  fetchJsonOk<DepartmentCompetencyBoard>(
    `${COMPETENCY_API_BASE}/departments/${encodeURIComponent(departmentId)}/competencies`,
    jsonInit("PUT", { items }),
  );

const byEmployee = (employeeId?: string) => (employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "");

export const fetchCompetencyAssessments = (signal?: AbortSignal, employeeId?: string) =>
  fetchJsonOk<{ assessments: CompetencyAssessmentDto[] }>(`${COMPETENCY_API_BASE}/assessments${byEmployee(employeeId)}`, {
    ...NO_STORE,
    signal,
  });

export const fetchTrainings = (signal?: AbortSignal, employeeId?: string) =>
  fetchJsonOk<{ trainings: TrainingDto[] }>(`${COMPETENCY_API_BASE}/trainings${byEmployee(employeeId)}`, { ...NO_STORE, signal });

/** Aba Competências da ficha do colaborador. */
export const fetchEmployeeCompetencyProfile = (employeeId: string, signal?: AbortSignal) =>
  fetchJsonOk<EmployeeCompetencyProfileDto>(`${COMPETENCY_API_BASE}/employees/${encodeURIComponent(employeeId)}`, {
    ...NO_STORE,
    signal,
  });

export type CompetencyPayload = {
  name: string;
  category: string;
  description: string | null;
  requiresRecycling: boolean;
  critical: boolean;
};
export const createCompetency = (body: CompetencyPayload) =>
  fetchJsonOk<CompetencyDto>(`${COMPETENCY_API_BASE}/catalog`, jsonInit("POST", body));

export type WorkPositionPayload = {
  name: string;
  departmentId: string | null;
  shiftPattern: string;
  requirements: { competencyId: string; minLevel: number }[];
};
export const createWorkPosition = (body: WorkPositionPayload) =>
  fetchJsonOk<{ id: string }>(`${COMPETENCY_API_BASE}/positions`, jsonInit("POST", body));

export const setWorkPositionTeam = (positionId: string, employeeIds: string[]) =>
  fetchJsonOk<{ added: string[]; removed: string[] }>(
    `${COMPETENCY_API_BASE}/positions/${encodeURIComponent(positionId)}/team`,
    jsonInit("PUT", { employeeIds }),
  );

/** Ajuste na matriz. `expectedVersion` = versão exibida (edição simultânea → HttpError 409). */
export const setCompetencyLevel = (employeeId: string, competencyId: string, level: number, expectedVersion?: number) =>
  fetchJsonOk<LevelWriteResponse>(
    `${COMPETENCY_API_BASE}/levels/${encodeURIComponent(employeeId)}/${encodeURIComponent(competencyId)}`,
    jsonInit("PUT", { level, expectedVersion }),
  );

export const fetchLevelRequests = (status: "PENDING" | "DECIDED", signal?: AbortSignal) =>
  fetchJsonOk<{ requests: LevelRequestDto[] }>(`${COMPETENCY_API_BASE}/approvals?status=${status}`, { ...NO_STORE, signal });

export const decideLevelRequest = (id: string, decision: "APPROVE" | "REJECT", note: string | null) =>
  fetchJsonOk<{ id: string; status: string; level: number | null }>(
    `${COMPETENCY_API_BASE}/approvals/${encodeURIComponent(id)}/decision`,
    jsonInit("POST", { decision, note }),
  );

export type AssessmentPayload = {
  employeeId: string;
  evaluatorEmployeeId: string | null;
  assessmentDate: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  notes: string | null;
  items: { competencyId: string; level: number }[];
};
export const createAssessment = (body: AssessmentPayload) =>
  fetchJsonOk<{ id: string; replacedPendingId: string | null }>(`${COMPETENCY_API_BASE}/assessments`, jsonInit("POST", body));

export const updateAssessment = (id: string, body: AssessmentPayload) =>
  fetchJsonOk<{ id: string }>(`${COMPETENCY_API_BASE}/assessments/${encodeURIComponent(id)}`, jsonInit("PUT", body));

export const deleteAssessment = (id: string) =>
  fetchOk(`${COMPETENCY_API_BASE}/assessments/${encodeURIComponent(id)}`, { method: "DELETE" });

export type TrainingPayload = {
  title: string;
  competencyId: string;
  modality: string;
  workloadHours: number;
  startDate: string;
  validityMonths: number;
  participantIds: string[];
  instructorName?: string | null;
  syllabus?: SyllabusModule[];
};
export const createTraining = (body: TrainingPayload) =>
  fetchJsonOk<{ id: string }>(`${COMPETENCY_API_BASE}/trainings`, jsonInit("POST", body));

export const setTrainingStatus = (id: string, status: string, completedOn: string | null = null) =>
  fetchJsonOk<{ id: string; status: string }>(
    `${COMPETENCY_API_BASE}/trainings/${encodeURIComponent(id)}/status`,
    jsonInit("PATCH", { status, completedOn }),
  );

export const deleteTraining = (id: string) =>
  fetchOk(`${COMPETENCY_API_BASE}/trainings/${encodeURIComponent(id)}`, { method: "DELETE" });

// —— Certificados de treinamento ——

export const fetchCertificateSettings = (signal?: AbortSignal) =>
  fetchJsonOk<CertificateSettingsDto>(`${COMPETENCY_API_BASE}/certificate-settings`, { ...NO_STORE, signal });

export const saveCertificateSettings = (body: CertificateSettingsInput) =>
  fetchJsonOk<CertificateSettingsDto>(`${COMPETENCY_API_BASE}/certificate-settings`, jsonInit("PUT", body));

export const fetchTrainingCertificateBoard = (trainingId: string, signal?: AbortSignal) =>
  fetchJsonOk<TrainingCertificateBoardDto>(`${COMPETENCY_API_BASE}/trainings/${encodeURIComponent(trainingId)}/certificates`, {
    ...NO_STORE,
    signal,
  });

export const saveTrainingCertificateContent = (
  trainingId: string,
  body: { instructorName: string | null; syllabus: SyllabusModule[] },
) =>
  fetchJsonOk<{ id: string }>(
    `${COMPETENCY_API_BASE}/trainings/${encodeURIComponent(trainingId)}/certificate-content`,
    jsonInit("PUT", body),
  );

export const issueTrainingCertificates = (trainingId: string, employeeIds: string[] | null = null) =>
  fetchJsonOk<TrainingCertificateIssueResult>(
    `${COMPETENCY_API_BASE}/trainings/${encodeURIComponent(trainingId)}/certificates`,
    jsonInit("POST", employeeIds ? { employeeIds } : {}),
  );

export const fetchTrainingCertificatesDocument = (trainingId: string, ids: string[] | null = null) =>
  fetchJsonOk<TrainingCertificateDocumentDto>(
    `${COMPETENCY_API_BASE}/trainings/${encodeURIComponent(trainingId)}/certificates/document${
      ids && ids.length > 0 ? `?ids=${ids.map(encodeURIComponent).join(",")}` : ""
    }`,
    NO_STORE,
  );

export const cancelTrainingCertificate = (certificateId: string, reason: string) =>
  fetchJsonOk<{ id: string; number: string }>(
    `${COMPETENCY_API_BASE}/certificates/${encodeURIComponent(certificateId)}/cancel`,
    jsonInit("POST", { reason }),
  );

// —— Importação assistida por planilha ——

export const COMPETENCY_IMPORT_TEMPLATE_URL = `${COMPETENCY_API_BASE}/import/template`;

function importForm(file: File, resolutions: ImportResolutions, fingerprint?: string): FormData {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("resolutions", JSON.stringify(resolutions));
  if (fingerprint) form.append("fingerprint", fingerprint);
  return form;
}

/** Prévia: nada é gravado. Reenvie com as resoluções para recalcular. */
export const previewCompetencyImport = (file: File, resolutions: ImportResolutions) =>
  fetchJsonOk<CompetencyImportPreviewDto>(`${COMPETENCY_API_BASE}/import/preview`, {
    method: "POST",
    body: importForm(file, resolutions),
  });

/** Aplica exatamente a prévia (`fingerprint`); estado mudou desde então → HttpError 409. */
export const applyCompetencyImport = (file: File, resolutions: ImportResolutions, fingerprint: string) =>
  fetchJsonOk<CompetencyImportApplyResult>(`${COMPETENCY_API_BASE}/import/apply`, {
    method: "POST",
    body: importForm(file, resolutions, fingerprint),
  });
