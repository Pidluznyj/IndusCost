/**
 * Carrega a identidade operacional dos avaliadores em lote (somente leitura).
 * Mesma fonte para a prontidão do ciclo e para o diagnóstico: `AppUser.employeeId` decide;
 * a Pessoa canônica só explica a pendência. Nunca grava nada.
 */
import type { PrismaClient } from "@prisma/client";
import { classifyEvaluatorIdentity, type EvaluatorIdentity } from "./evaluatorIdentity.js";

type Db = Pick<PrismaClient, "employee" | "appUser" | "person">;

export async function loadEvaluatorIdentities(prisma: Db, employeeIds: string[]): Promise<Map<string, EvaluatorIdentity>> {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  const out = new Map<string, EvaluatorIdentity>();
  if (ids.length === 0) return out;
  const [employees, directAccounts] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, personId: true } }),
    prisma.appUser.findMany({ where: { employeeId: { in: ids } }, select: { id: true, isActive: true, employeeId: true } }),
  ]);
  const personIds = [...new Set(employees.map((e) => e.personId).filter((x): x is string => Boolean(x)))];
  const [people, personAccounts] = personIds.length
    ? await Promise.all([
        prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, status: true, employees: { select: { id: true } } } }),
        prisma.appUser.findMany({ where: { personId: { in: personIds } }, select: { id: true, isActive: true, employeeId: true, personId: true } }),
      ])
    : [[], []];
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const directByEmployee = new Map(directAccounts.map((a) => [a.employeeId!, a]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const accountByPerson = new Map(personAccounts.map((a) => [a.personId!, a]));
  for (const id of ids) {
    const employee = employeeById.get(id) ?? null;
    const person = employee?.personId ? personById.get(employee.personId) ?? null : null;
    out.set(
      id,
      classifyEvaluatorIdentity({
        employeeId: id,
        employee,
        directAccount: directByEmployee.get(id) ?? null,
        person: person ? { id: person.id, status: person.status, employeeIds: person.employees.map((e) => e.id) } : null,
        personAccount: person ? accountByPerson.get(person.id) ?? null : null,
      })
    );
  }
  return out;
}

/** Colaboradores com conta ativa ligada — o conjunto que a prontidão e "Minha equipe" reconhecem. */
export async function loadLinkedEvaluatorIds(prisma: Db, employeeIds: string[]): Promise<Set<string>> {
  const map = await loadEvaluatorIdentities(prisma, employeeIds);
  return new Set([...map.values()].filter((i) => i.status === "LINKED").map((i) => i.employeeId));
}
