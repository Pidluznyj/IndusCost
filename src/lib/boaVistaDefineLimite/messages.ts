/**
 * Mensagens e códigos HTTP da consulta LIKE SERASA — sem dependências de Node, para uso também no frontend.
 */
import { paidConsultationHttpStatus, paidConsultationMessage } from "@/src/lib/directData/paidConsultationMessages.js";
import { LIVE_BLOCK_MESSAGES, type LiveQueryBlockReason } from "./environmentGate.messages.js";

export type LikeSerasaQueryCode =
  | "ENVIRONMENT_BLOCKED"
  | "DEMO_BLOCKED"
  | "NOT_LEGAL_ENTITY"
  | "CONSENT_REQUIRED"
  | "INVALID_CNPJ"
  | "CACHE_VALID"
  | "IN_FLIGHT"
  | "UNKNOWN_BILLING"
  | "INSUFFICIENT_BALANCE"
  | "AUTH"
  | "UNAVAILABLE"
  | "RATE_LIMIT"
  | "INVALID_INPUT"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "PARTIAL"
  | "PERSISTENCE_FAILED"
  | "OK";

const LOCAL_MESSAGES: Record<"ENVIRONMENT_BLOCKED" | "DEMO_BLOCKED" | "NOT_LEGAL_ENTITY", string> = {
  ENVIRONMENT_BLOCKED: "A consulta real LIKE SERASA está disponível somente em produção. Nada foi enviado nem cobrado.",
  DEMO_BLOCKED: "O modo de demonstração LIKE SERASA não está habilitado neste ambiente.",
  NOT_LEGAL_ENTITY: "O produto Boa Vista Define Limite atende exclusivamente pessoa jurídica (CNPJ). Nada foi cobrado.",
};

export function likeSerasaMessage(code: string, providerMessage?: string | null, blockReason?: LiveQueryBlockReason | "OK" | null): string {
  if (code === "ENVIRONMENT_BLOCKED" && blockReason && blockReason !== "OK") return LIVE_BLOCK_MESSAGES[blockReason];
  const local = LOCAL_MESSAGES[code as keyof typeof LOCAL_MESSAGES];
  if (local) return local;
  return paidConsultationMessage(code, providerMessage);
}

export function likeSerasaHttpStatus(code: string): number {
  if (code === "ENVIRONMENT_BLOCKED" || code === "DEMO_BLOCKED") return 403;
  if (code === "NOT_LEGAL_ENTITY" || code === "INVALID_CNPJ") return 422;
  return paidConsultationHttpStatus(code);
}
