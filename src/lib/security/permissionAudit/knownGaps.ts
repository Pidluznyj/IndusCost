/**
 * Gaps históricos conhecidos — reportados, mas não falham modo estrito.
 * Expandir com cuidado; preferir corrigir a causa.
 *
 * Prompt 16 RC: removidos gaps já fechados (executiveReport no catálogo,
 * /api/test-db autenticado, Nomus sync alinhado FE/BE).
 */

import type { PermissionAuditCode } from "./types.ts";

export type KnownGapRule = {
  code: PermissionAuditCode;
  /** Match exato de subject; se omitido, aplica a qualquer subject do code. */
  subject?: string;
  /** Prefixo de subject (rota, arquivo, chave). */
  subjectPrefix?: string;
  reason: string;
};

/**
 * Allowlist de divergências já documentadas.
 * Novos erros estruturais fora desta lista falham em `--strict`.
 */
export const PERMISSION_AUDIT_KNOWN_GAPS: readonly KnownGapRule[] = [
  {
    code: "MUTATION_AUTH_ONLY",
    subjectPrefix: "DELETE /api/finance/suppliers",
    reason: "Guard inline SUPER_ADMIN (Prompt 01 médio).",
  },
  {
    code: "MUTATION_AUTH_ONLY",
    subjectPrefix: "DELETE /api/projects",
    reason: "Guard inline SUPER_ADMIN (Prompt 01 médio).",
  },
  {
    code: "MUTATION_AUTH_ONLY",
    subjectPrefix: "POST /api/fleet/admin/reservations-cleanup",
    reason: "Guard inline SUPER_ADMIN via assertFleetReservationsCleanupSuperAdmin.",
  },
  {
    code: "MUTATION_AUTH_ONLY",
    subjectPrefix: "POST /api/admin/users/bootstrap-super-admin",
    reason: "Bootstrap privilegiado via requireBootstrapAdmin (não é sessão comum).",
  },
  {
    code: "TAB_WITHOUT_CONTRACT",
    subjectPrefix: "operations.inventory.",
    reason: "Abas overview/balances/reservations/audit ainda sem contrato fino.",
  },
  {
    code: "CONTRACT_ACTION_UNUSED",
    reason: "Várias actions do contrato mapeiam legado pouco referenciado no scan literal.",
  },
  {
    code: "CATALOG_NEVER_USED",
    reason: "Catálogo legado tem chaves órfãs históricas (comissões legacy, aliases duplos).",
  },
  {
    code: "PRIVATE_ROUTE_WITHOUT_CONTRACT",
    reason: "Rotas auth fora do mapa de módulos/contract (intake, prints) — fase futura.",
  },
];

export function isKnownGap(
  code: PermissionAuditCode,
  subject: string | undefined,
  rules: readonly KnownGapRule[] = PERMISSION_AUDIT_KNOWN_GAPS
): boolean {
  for (const rule of rules) {
    if (rule.code !== code) continue;
    if (rule.subject != null) {
      if (subject === rule.subject) return true;
      continue;
    }
    if (rule.subjectPrefix != null) {
      if (subject != null && subject.startsWith(rule.subjectPrefix)) return true;
      continue;
    }
    // regra só por código
    return true;
  }
  return false;
}
