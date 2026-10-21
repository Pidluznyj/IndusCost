/**
 * Propagação da identidade canônica entre o colaborador e a conta ligada a ele (E4).
 *
 * Regra: a conta recebe a Pessoa do colaborador quando a associação é inequívoca
 * (conta sem Pessoa, ou com a Pessoa anterior do mesmo colaborador). Nunca sobrescreve
 * silenciosamente uma conta que aponta para OUTRA Pessoa: isso é conflito e vai para
 * a correção controlada (Pessoas 360°).
 */
import type { Prisma } from "@prisma/client";

type Tx = Pick<Prisma.TransactionClient, "appUser">;

export type PersonPropagationOutcome =
  | { outcome: "NO_LINKED_USER" }
  | { outcome: "ALREADY_SAME" }
  | { outcome: "PROPAGATED"; userId: string; fromPersonId: string | null }
  | { outcome: "USER_HAS_OTHER_PERSON"; userId: string; userPersonId: string }
  | { outcome: "PERSON_HELD_BY_OTHER_USER"; userId: string; otherUserId: string }
  | { outcome: "NO_PERSON" };

export async function propagateEmployeePersonToLinkedUser(
  tx: Tx,
  args: { employeeId: string; personId: string | null; previousPersonId: string | null }
): Promise<PersonPropagationOutcome> {
  if (!args.personId) return { outcome: "NO_PERSON" };
  const user = await tx.appUser.findUnique({
    where: { employeeId: args.employeeId },
    select: { id: true, personId: true },
  });
  if (!user) return { outcome: "NO_LINKED_USER" };
  if (user.personId === args.personId) return { outcome: "ALREADY_SAME" };
  if (user.personId && user.personId !== args.previousPersonId) {
    return { outcome: "USER_HAS_OTHER_PERSON", userId: user.id, userPersonId: user.personId };
  }
  const holder = await tx.appUser.findUnique({ where: { personId: args.personId }, select: { id: true } });
  if (holder && holder.id !== user.id) {
    return { outcome: "PERSON_HELD_BY_OTHER_USER", userId: user.id, otherUserId: holder.id };
  }
  await tx.appUser.update({ where: { id: user.id }, data: { personId: args.personId } });
  return { outcome: "PROPAGATED", userId: user.id, fromPersonId: user.personId };
}
