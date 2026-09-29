/**
 * DTO interno do Domicílio. O JSON externo fica só no mapper.
 * Os paths oficiais não são chutados: vêm da configuração.
 */

export type DomicilioTokenResponse = {
  accessToken: string;
  expiresInSeconds: number;
};

export type DomicilioInstitution = {
  tenantId: string;
  institution: string;
};

export type DomicilioCommunicationQuery = {
  dataInicio: string;
  dataFim: string;
  numeroProcesso?: string;
  tipoComunicacao?: string;
  assunto?: string;
  statusCiente?: string;
  parteInteressada?: string;
  page?: number;
  size?: number;
  sort?: string;
};

export const DOMICILIO_SYNC_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;

export function domicilioListWindow(now: Date): { dataInicio: string; dataFim: string } {
  return {
    dataInicio: new Date(now.getTime() - DOMICILIO_SYNC_OVERLAP_MS).toISOString(),
    dataFim: now.toISOString(),
  };
}

export const DOMICILIO_ALLOWED_OPERATIONS = [
  "fetchAccessToken",
  "fetchInstitutionIdentity",
  "listCommunications",
] as const;
