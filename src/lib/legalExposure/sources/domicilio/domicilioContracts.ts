/**
 * Contrato do Domicílio Judicial Eletrônico (PDPJ/CNJ), conferido no OpenAPI
 * oficial de homologação ("PDPJ - Domicílio Eletrônico", v1.0):
 * https://gateway.stg.cloud.pje.jus.br/domicilio-eletronico-hml/v3/api-docs
 *
 * O JSON externo fica só no mapper. Este arquivo não importa Node.
 *
 * Segurança jurídica: `PUT /api/v1/processos/{p}/comunicacoes/{c}` obtém o inteiro
 * teor e a comunicação passa a "ciente". Essa operação não existe aqui e a
 * allowlist abaixo recusa qualquer método/caminho fora dela antes do fetch.
 */

/** Só estas operações saem para a rede. Método e caminho exatos. */
export const DOMICILIO_ALLOWED_OPERATIONS = [
  { name: "fetchAccessToken", method: "POST", path: null },
  { name: "fetchInstitutionIdentity", method: "GET", path: "/api/v1/eu" },
  { name: "listCommunications", method: "GET", path: "/api/v1/comunicacoes" },
] as const;

export type DomicilioOperationName = (typeof DOMICILIO_ALLOWED_OPERATIONS)[number]["name"];

export const DOMICILIO_IDENTITY_PATH = "/api/v1/eu";
export const DOMICILIO_COMMUNICATIONS_PATH = "/api/v1/comunicacoes";

/** Domínios oficiais do PJe/PDPJ/CNJ. Base e token fora deles são recusados. */
export const DOMICILIO_ALLOWED_HOST_SUFFIXES = [".pje.jus.br", ".pdpj.jus.br", ".cnj.jus.br"] as const;

/** `dataInicio` e `dataFim` andam juntos, com no máximo 7 dias entre eles. */
export const DOMICILIO_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Releitura a cada execução: cobre atraso de disponibilização e mudança de situação recente. */
export const DOMICILIO_SYNC_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;
export const DOMICILIO_PAGE_SIZE = 50;

/** `statusCiente` é obrigatório na listagem: A = ambos, L = lidas, N = não lidas. */
export const DOMICILIO_STATUS_CIENTE_ALL = "A";

/** Enum `status` de ComunicacaoProcessualViewModel. */
export const DOMICILIO_COMMUNICATION_STATUSES = [
  "EM_CURSO",
  "INTEIRO_TEOR_OBTIDO",
  "CIENTE",
  "CIENCIA_AUTOMATICA",
  "CANCELADA",
] as const;

export type DomicilioTokenResponse = {
  accessToken: string;
  expiresInSeconds: number;
};

/** Perfil institucional devolvido por `GET /api/v1/eu` (`perfis[]`). */
export type DomicilioInstitution = {
  tenantId: string;
  institution: string;
  document: string;
};

export type DomicilioCommunicationQuery = {
  dataInicio?: string;
  dataFim?: string;
  numeroProcesso?: string;
  page: number;
  size: number;
};

export type DomicilioWindow = { dataInicio: string; dataFim: string };

/**
 * Janelas de até 7 dias entre o checkpoint (com sobreposição) e agora.
 * Sem checkpoint, a carga histórica volta `backfillDays`.
 */
export function domicilioSyncWindows(input: {
  now: Date;
  checkpoint: string | null;
  backfillDays: number;
}): DomicilioWindow[] {
  const end = input.now.getTime();
  const checkpointMs = input.checkpoint ? Date.parse(input.checkpoint) : Number.NaN;
  const start = Number.isFinite(checkpointMs)
    ? Math.min(checkpointMs, end) - DOMICILIO_SYNC_OVERLAP_MS
    : end - input.backfillDays * 24 * 60 * 60 * 1000;
  const windows: DomicilioWindow[] = [];
  for (let cursor = start; cursor < end; cursor += DOMICILIO_MAX_WINDOW_MS) {
    windows.push({
      dataInicio: new Date(cursor).toISOString(),
      dataFim: new Date(Math.min(cursor + DOMICILIO_MAX_WINDOW_MS, end)).toISOString(),
    });
  }
  return windows;
}
