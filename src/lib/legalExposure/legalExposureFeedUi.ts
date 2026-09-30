/**
 * Rótulos de leitura para eventos, comunicações, alertas, certidões e fontes
 * do Exposure. Só tradução de código → texto; nenhuma regra jurídica.
 */

import { SOURCE_LABELS } from "./legalExposureContracts.js";
import type {
  LegalCertificateResult,
  LegalCertificateType,
  LegalCommunicationNormalizedStatus,
  LegalExposureAlertStatus,
  LegalExposureEventType,
  LegalExposureSeverity,
  LegalExposureSource,
  LegalSourceConnectionStatus,
} from "./legalExposureContracts.js";

export const EVENT_TYPE_LABELS: Record<LegalExposureEventType, string> = {
  NEW_CASE: "Processo identificado",
  NEW_COMMUNICATION: "Nova comunicação",
  NEW_CITATION: "Citação recebida",
  NEW_INTIMATION: "Intimação recebida",
  NEW_MOVEMENT: "Nova movimentação",
  CASE_POLE_CONFIRMED: "Polo confirmado",
  CASE_STATUS_CHANGED: "Situação do processo alterada",
  COMMUNICATION_ACKNOWLEDGED: "Comunicação com ciência registrada",
  COMMUNICATION_EXPIRED: "Comunicação expirada",
  COMMUNICATION_CANCELED: "Comunicação cancelada",
  SOURCE_CONFIRMATION: "Confirmado em fonte oficial",
  SOURCE_FAILED: "Falha na fonte",
  SOURCE_STALE: "Fonte desatualizada",
  SOURCE_RECOVERED: "Fonte recuperada",
  CERTIFICATE_REGISTERED: "Certidão registrada",
  CANDIDATE_REVIEW: "Possível ocorrência para revisão",
};

/** Eventos que só repetem a movimentação/comunicação já listada na linha do tempo do processo. */
export const TIMELINE_DUPLICATE_EVENT_TYPES: ReadonlySet<LegalExposureEventType> = new Set([
  "NEW_MOVEMENT",
  "NEW_COMMUNICATION",
  "NEW_CITATION",
  "NEW_INTIMATION",
]);

export const SEVERITY_LABELS: Record<LegalExposureSeverity, string> = {
  CRITICAL: "Crítico",
  HIGH: "Alto",
  MEDIUM: "Médio",
  LOW: "Baixo",
  INFO: "Informativo",
};

export const COMMUNICATION_STATUS_LABELS: Record<LegalCommunicationNormalizedStatus, string> = {
  PENDING: "Pendente de ciência",
  ACKNOWLEDGED: "Ciência registrada",
  EXPIRED: "Prazo de ciência expirado",
  CANCELED: "Cancelada pela fonte",
  UNKNOWN: "Situação não informada",
};

export const ALERT_STATUS_LABELS: Record<LegalExposureAlertStatus, string> = {
  OPEN: "Em aberto",
  ACKNOWLEDGED: "Ciente",
  RESOLVED: "Resolvido",
};

export const CERTIFICATE_TYPE_LABELS: Record<LegalCertificateType, string> = {
  TRT_LABOR_CASES: "Certidão de ações trabalhistas (TRT)",
  CNDT: "CNDT — Certidão Negativa de Débitos Trabalhistas",
  OTHER: "Outra certidão",
};

export const CERTIFICATE_RESULT_LABELS: Record<LegalCertificateResult, string> = {
  NEGATIVE: "Negativa",
  POSITIVE: "Positiva",
  POSITIVE_WITH_EFFECTS_OF_NEGATIVE: "Positiva com efeitos de negativa",
  UNKNOWN: "Resultado não informado",
};

/** O que cada situação da fonte significa para quem lê a tela. */
export const SOURCE_STATUS_HINTS: Record<LegalSourceConnectionStatus, string> = {
  HEALTHY: "Consultas recentes com sucesso.",
  DEGRADED: "Consultas com falhas intermitentes; os dados podem estar incompletos.",
  STALE: "Sem consulta bem-sucedida dentro do prazo de frescor; não sustenta ausência de exposição.",
  DISCONNECTED: "Sem contato com a fonte.",
  RATE_LIMITED: "A fonte limitou o volume de consultas; a coleta será retomada automaticamente.",
  SOURCE_ERROR: "A fonte devolveu erro na última consulta.",
  AUTH_ERROR: "Credenciais recusadas pela fonte.",
  CONFIGURATION_ERROR: "Configuração inválida para esta fonte.",
  NOT_CONFIGURED: "Fonte ainda não configurada.",
  DISABLED: "Monitoramento desligado para esta fonte.",
};

const TYPE_WORDS: Array<[RegExp, string]> = [
  [/cita/i, "Citação"],
  [/intima/i, "Intimação"],
  [/notifica/i, "Notificação"],
  [/edital/i, "Edital"],
  [/oficio|ofício/i, "Ofício"],
  [/sentenca|sentença/i, "Sentença"],
  [/decisao|decisão/i, "Decisão"],
  [/despacho/i, "Despacho"],
  [/audiencia|audiência/i, "Audiência"],
  [/^outra?$/i, "Outra comunicação"],
];

/** Tipo de comunicação como veio da fonte, em forma legível (Citação, Intimação…). */
export function communicationTypeLabel(type: string | null | undefined): string {
  const raw = (type ?? "").trim();
  if (!raw) return "Comunicação";
  for (const [pattern, label] of TYPE_WORDS) if (pattern.test(raw)) return label;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function eventTypeLabel(type: string | null | undefined): string {
  return (type && EVENT_TYPE_LABELS[type as LegalExposureEventType]) || (type ?? "Evento");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Detalhe do evento a partir do payload gravado pela aplicação (nome da movimentação, de→para, polo…). */
export function eventDetail(type: string, payload: unknown): string | null {
  const data = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  if (!data) return null;
  switch (type) {
    case "NEW_MOVEMENT":
      return text(data.name);
    case "CASE_STATUS_CHANGED": {
      const from = text(data.from);
      const to = text(data.to);
      if (from && to) return `${from} → ${to}`;
      return to ?? from;
    }
    case "CASE_POLE_CONFIRMED":
      return text(data.pole) ? `Polo: ${polePlain(text(data.pole))}` : null;
    case "NEW_COMMUNICATION":
    case "NEW_CITATION":
    case "NEW_INTIMATION":
      return text(data.communicationType) ? communicationTypeLabel(text(data.communicationType)) : null;
    case "COMMUNICATION_ACKNOWLEDGED":
    case "COMMUNICATION_EXPIRED":
    case "COMMUNICATION_CANCELED":
      return text(data.sourceStatus) ? `Situação na fonte: ${text(data.sourceStatus)}` : null;
    case "CANDIDATE_REVIEW":
      return text(data.name) ? `Nome encontrado: ${text(data.name)}` : null;
    case "SOURCE_CONFIRMATION":
    case "NEW_CASE":
      return text(data.source) ? `Fonte: ${SOURCE_LABELS[text(data.source) as LegalExposureSource] ?? text(data.source)}` : null;
    default:
      return null;
  }
}

function polePlain(pole: string | null): string {
  if (pole === "PASSIVE") return "ré / polo passivo";
  if (pole === "ACTIVE") return "autora / polo ativo";
  if (pole === "THIRD_PARTY") return "terceira interessada";
  if (pole === "OTHER") return "outro polo";
  return "ainda não identificado";
}

/** Complementos de movimentação do DataJud ({nome, descricao}) em texto curto. */
export function movementComplementsText(complements: unknown): string | null {
  if (!Array.isArray(complements)) return null;
  const parts = complements
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      const name = text(row?.nome);
      const description = text(row?.descricao)?.replace(/_/g, " ");
      if (name && description) return `${description}: ${name}`;
      return name ?? description ?? null;
    })
    .filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(" · ") : null;
}
