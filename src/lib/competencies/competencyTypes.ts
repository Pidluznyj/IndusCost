/**
 * Competências e Desenvolvimento — DTOs da API (compartilhados por servidor e cliente).
 * Datas de negócio sempre "AAAA-MM-DD".
 */

import type { CompetencyMatrix, CompetencyOverview } from "./competencyEngine";
import type { CompetencyScopeView } from "./competencyScope";
import type { ImportPlan, ImportSummary } from "./competencyImport";

export type CompetencyDto = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  requiresRecycling: boolean;
  critical: boolean;
};

export type WorkPositionDto = {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  shiftPattern: string;
  requirements: { competencyId: string; minLevel: number }[];
  team: { employeeId: string; employeeName: string }[];
};

export type CompetencyEmployeeOptionDto = {
  id: string;
  name: string;
  departmentName: string | null;
  positionId: string | null;
  /** Pode ser alocado/avaliado/inscrito pelo usuário (escopo hierárquico). */
  writable: boolean;
};

export type CompetencyDepartmentOptionDto = { id: string; name: string };

export type CompetencyOptionsResponse = {
  employees: CompetencyEmployeeOptionDto[];
  departments: CompetencyDepartmentOptionDto[];
};

/** `scope`: ALL (RH), TEAM (líder: a própria equipe), SELF ou NONE (sem colaborador vinculado / sem escopo). */
export type CompetencyOverviewResponse = CompetencyOverview & {
  asOf: string;
  scope: CompetencyScopeView;
  /** Solicitações de nível aguardando aprovação (no escopo do usuário). */
  pendingApprovals: number;
};

/** `writable` por linha: o usuário pode alterar níveis / avaliar / inscrever esse colaborador. */
type MatrixCellWithGovernance = CompetencyMatrix["rows"][number]["cells"][number] & {
  /** Versão do nível gravado (0 = nenhum); vai de volta no ajuste para detectar edição simultânea. */
  version: number;
  /** Solicitação aguardando aprovação para esta célula. */
  pending: { requestId: string; toLevel: number } | null;
};

export type CompetencyMatrixResponse = Omit<CompetencyMatrix, "rows"> & {
  rows: (Omit<CompetencyMatrix["rows"][number], "cells"> & { writable: boolean; cells: MatrixCellWithGovernance[] })[];
  asOf: string;
};

export type LevelRequestDto = {
  id: string;
  employeeId: string;
  employeeName: string;
  competencyId: string;
  competencyName: string;
  critical: boolean;
  fromLevel: number;
  toLevel: number;
  source: string;
  reason: string;
  status: string;
  requestedAt: string;
  requestedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

/** Resultado do ajuste na matriz: aplicado ou enviado para aprovação. */
export type LevelWriteResponse =
  | { outcome: "APPLIED"; employeeId: string; competencyId: string; level: number; previousLevel: number; version: number }
  | { outcome: "REQUESTED"; employeeId: string; competencyId: string; level: number; previousLevel: number; requestId: string; reason: string };

export type CompetencyAssessmentDto = {
  id: string;
  employeeId: string;
  employeeName: string;
  positionName: string | null;
  evaluatorEmployeeId: string | null;
  evaluatorName: string | null;
  assessmentDate: string;
  status: string;
  averageLevel: number | null;
  averageLabel: string;
  notes: string | null;
  items: { competencyId: string; level: number; requiredLevel: number | null }[];
};

export type TrainingDto = {
  id: string;
  title: string;
  competencyId: string;
  competencyName: string;
  modality: string;
  workloadHours: number;
  startDate: string;
  validityMonths: number;
  status: string;
  completedOn: string | null;
  /** Participantes de outras equipes (não exibidos ao líder). */
  hiddenParticipantCount: number;
  participants: { employeeId: string; employeeName: string; completedOn: string | null }[];
};

/** Aba Competências da ficha do colaborador (somente leitura; mesma engine do módulo). */
export type EmployeeCompetencyProfileDto = {
  asOf: string;
  employeeId: string;
  employeeName: string;
  /** O usuário pode avaliar / alterar níveis deste colaborador no módulo. */
  writable: boolean;
  position: { id: string; name: string; departmentName: string | null; shiftPattern: string } | null;
  coverage: { met: number; total: number; ratio: number | null; percentLabel: string };
  /** Apto no posto (atende 100%); falso sem posto ou sem requisitos. */
  ready: boolean;
  requirements: {
    competencyId: string;
    competencyName: string;
    category: string;
    critical: boolean;
    requiredLevel: number;
    currentLevel: number;
    storedLevel: number;
    met: boolean;
    gap: number;
    recycling: string;
    recyclingExpiresOn: string | null;
  }[];
  /** Competências com nível registrado que o posto atual não exige. */
  otherLevels: {
    competencyId: string;
    competencyName: string;
    category: string;
    currentLevel: number;
    storedLevel: number;
    recycling: string;
    recyclingExpiresOn: string | null;
  }[];
  /** Últimas alterações de nível (append-only), mais recentes primeiro. */
  history: {
    id: string;
    competencyId: string;
    competencyName: string;
    previousLevel: number;
    newLevel: number;
    source: string;
    assessmentId: string | null;
    at: string;
  }[];
};

/** Prévia da importação por planilha (nada é gravado). */
export type CompetencyImportPreviewDto = {
  fileName: string;
  fileSha256: string;
  /** Deve voltar na aplicação; muda se o estado mudar (→ 409 PREVIEW_STALE). */
  fingerprint: string;
  plan: ImportPlan;
  competencies: { id: string; name: string }[];
  /** Colaboradores que o usuário pode associar a linhas não encontradas. */
  assignable: { id: string; name: string }[];
  /** Mesmo arquivo já aplicado antes (reaplicar só grava o que mudou desde então). */
  alreadyImported: { at: string; changedCount: number } | null;
  /** Alterações (`empregado:competência`) que irão para aprovação ao aplicar. */
  requiresApproval: string[];
};

export type CompetencyImportApplyResult = {
  /** null quando não havia nada a alterar (reaplicação idempotente). */
  batchId: string | null;
  changed: number;
  /** Alterações que viraram solicitação de aprovação (novas). */
  requested: number;
  conflictsApplied: number;
  summary: ImportSummary;
};

export type CompetencyApiError = { error: string; message: string };
