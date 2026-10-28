/** Motivos de bloqueio da consulta real e suas mensagens — sem dependências de Node (compartilhado com o frontend). */

export type LiveQueryBlockReason =
  | "ROLE_UNDECLARED"
  | "ROLE_NOT_PRODUCTION"
  | "ATTESTATION_MISSING"
  | "ATTESTATION_MISMATCH"
  | "NODE_ENV_NOT_PRODUCTION"
  | "FEATURE_DISABLED"
  | "TOKEN_MISSING";

export const LIVE_BLOCK_MESSAGES: Record<LiveQueryBlockReason, string> = {
  ROLE_UNDECLARED: "Ambiente não identificado: a consulta real LIKE SERASA está disponível somente em produção.",
  ROLE_NOT_PRODUCTION: "A consulta real LIKE SERASA está disponível somente em produção.",
  ATTESTATION_MISSING: "Servidor sem atestação de produção: a consulta real LIKE SERASA permanece desabilitada.",
  ATTESTATION_MISMATCH: "Atestação do servidor diverge do papel declarado: a consulta real LIKE SERASA permanece desabilitada.",
  NODE_ENV_NOT_PRODUCTION: "Processo fora do modo de produção: a consulta real LIKE SERASA permanece desabilitada.",
  FEATURE_DISABLED: "A consulta real LIKE SERASA está desabilitada por configuração (LIKE_SERASA_LIVE_ENABLED).",
  TOKEN_MISSING: "Credencial da Direct Data não configurada para a consulta LIKE SERASA.",
};
