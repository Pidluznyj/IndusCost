/**
 * Gate de ambiente da consulta real LIKE SERASA — FAIL-CLOSED.
 *
 * A chamada paga à Direct Data só é permitida quando TODAS as condições abaixo valem. Qualquer ausência ou
 * divergência mantém a consulta real desabilitada, mesmo com token configurado, mesmo com NODE_ENV=production
 * (a homologação também roda build de produção).
 *
 *   1. Papel operacional declarado no processo:  INDUSCOST_OPERATIONAL_ROLE=production
 *      (a homologação declara `homologation`; ausente = ambiente desconhecido = bloqueado).
 *   2. Atestação do papel FORA do repositório e fora do .env da aplicação: um arquivo do root no servidor
 *      autorizado (INDUSCOST_OPERATIONAL_ROLE_FILE, padrão /etc/induscost/operational-role) cujo conteúdo é
 *      exatamente `production`. Em desenvolvimento e homologação o arquivo não existe (ou diz outra coisa).
 *   3. Habilitação explícita da funcionalidade: LIKE_SERASA_LIVE_ENABLED=1.
 *   4. Credencial presente: LIKE_SERASA_DIRECT_DATA_TOKEN.
 *   5. NODE_ENV=production (necessário, nunca suficiente).
 *
 * O modo de demonstração (fixtures sintéticas, sem rede) exige LIKE_SERASA_DEMO_ENABLED=1 e é recusado quando o
 * papel declarado OU o atestado for `production` — produção nunca mostra resultado simulado.
 *
 * Nenhuma decisão depende do frontend nem da disponibilidade de conexão HTTP.
 */
import { readFileSync } from "node:fs";
import { LIVE_BLOCK_MESSAGES, type LiveQueryBlockReason } from "./environmentGate.messages.js";

export { LIVE_BLOCK_MESSAGES, type LiveQueryBlockReason };

export const OPERATIONAL_ROLE_PRODUCTION = "production";
export const OPERATIONAL_ROLE_HOMOLOGATION = "homologation";
export const DEFAULT_OPERATIONAL_ROLE_FILE = "/etc/induscost/operational-role";

export type LiveQueryDecision =
  | { allowed: true; reason: "OK"; declaredRole: string; attestedRole: string }
  | { allowed: false; reason: LiveQueryBlockReason; declaredRole: string | null; attestedRole: string | null };

export type DemoQueryDecision = { allowed: boolean; reason: "OK" | "DEMO_DISABLED" | "PRODUCTION_ROLE" };

export type RoleFileReader = (path: string) => string | null;

/** Lê o arquivo de atestação; qualquer erro (ausente, sem permissão, vazio) = null = bloqueado. */
export const readRoleFileFromDisk: RoleFileReader = (path) => {
  try {
    const content = readFileSync(path, "utf8").trim();
    return content ? content : null;
  } catch {
    return null;
  }
};

function normalizeRole(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function flag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

export function operationalRoleFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.INDUSCOST_OPERATIONAL_ROLE_FILE ?? "").trim();
  return configured || DEFAULT_OPERATIONAL_ROLE_FILE;
}

export function decideLiveQuery(
  env: NodeJS.ProcessEnv = process.env,
  readRoleFile: RoleFileReader = readRoleFileFromDisk
): LiveQueryDecision {
  const declaredRole = normalizeRole(env.INDUSCOST_OPERATIONAL_ROLE);
  if (!declaredRole) return { allowed: false, reason: "ROLE_UNDECLARED", declaredRole: null, attestedRole: null };
  if (declaredRole !== OPERATIONAL_ROLE_PRODUCTION) {
    return { allowed: false, reason: "ROLE_NOT_PRODUCTION", declaredRole, attestedRole: null };
  }
  const attestedRole = normalizeRole(readRoleFile(operationalRoleFilePath(env)));
  if (!attestedRole) return { allowed: false, reason: "ATTESTATION_MISSING", declaredRole, attestedRole: null };
  if (attestedRole !== OPERATIONAL_ROLE_PRODUCTION) {
    return { allowed: false, reason: "ATTESTATION_MISMATCH", declaredRole, attestedRole };
  }
  if (String(env.NODE_ENV ?? "").trim() !== "production") {
    return { allowed: false, reason: "NODE_ENV_NOT_PRODUCTION", declaredRole, attestedRole };
  }
  if (!flag(env.LIKE_SERASA_LIVE_ENABLED)) return { allowed: false, reason: "FEATURE_DISABLED", declaredRole, attestedRole };
  if (!String(env.LIKE_SERASA_DIRECT_DATA_TOKEN ?? "").trim()) {
    return { allowed: false, reason: "TOKEN_MISSING", declaredRole, attestedRole };
  }
  return { allowed: true, reason: "OK", declaredRole, attestedRole };
}

export function decideDemoQuery(env: NodeJS.ProcessEnv = process.env, readRoleFile: RoleFileReader = readRoleFileFromDisk): DemoQueryDecision {
  if (!flag(env.LIKE_SERASA_DEMO_ENABLED)) return { allowed: false, reason: "DEMO_DISABLED" };
  const declaredRole = normalizeRole(env.INDUSCOST_OPERATIONAL_ROLE);
  const attestedRole = normalizeRole(readRoleFile(operationalRoleFilePath(env)));
  if (declaredRole === OPERATIONAL_ROLE_PRODUCTION || attestedRole === OPERATIONAL_ROLE_PRODUCTION) {
    return { allowed: false, reason: "PRODUCTION_ROLE" };
  }
  return { allowed: true, reason: "OK" };
}
