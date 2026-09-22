/**
 * Cadastro operacional (Configurações → Estrutura Operacional) — regras puras de exclusão.
 * Browser-safe: a tela e o servidor usam as mesmas mensagens.
 */

/** Onde um cargo está em uso (FKs sem cascata: Employee.roleId e ProductRouting.roleId). */
export type RoleUsage = { employees: number; routings: number };

export function isRoleInUse(usage: RoleUsage): boolean {
  return usage.employees > 0 || usage.routings > 0;
}

/** "3 colaborador(es) e 2 roteiro(s) de produção" — só as partes com uso. */
export function describeRoleUsage(usage: RoleUsage): string {
  const parts: string[] = [];
  if (usage.employees > 0) parts.push(`${usage.employees} colaborador(es)`);
  if (usage.routings > 0) parts.push(`${usage.routings} roteiro(s) de produção`);
  return parts.join(" e ");
}

/**
 * Cargo é obrigatório no colaborador e no roteiro: excluir levaria esses registros junto.
 * A mensagem diz onde trocar o cargo antes.
 */
export function roleDeleteBlockedMessage(roleName: string, usage: RoleUsage): string {
  const where: string[] = [];
  if (usage.employees > 0) {
    where.push("colaboradores em Pessoas / RH → Editar, inclusive os inativos");
  }
  if (usage.routings > 0) where.push("roteiros no cadastro do produto");
  return (
    `Não é possível excluir o cargo "${roleName}": ele está em uso por ${describeRoleUsage(usage)}. ` +
    `Troque o cargo antes (${where.join("; ")}) e tente de novo.`
  );
}
