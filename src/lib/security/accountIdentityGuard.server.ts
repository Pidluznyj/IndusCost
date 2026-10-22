/**
 * Leitura de apoio da política de identidade de conta (não grava; trava a Pessoa na transação).
 */
import type { Prisma } from "@prisma/client";
import { lockPersonAccountLinks } from "@/src/lib/people/personLocks.server.js";

/**
 * Conta que ganharia a evidência "mesma Pessoa" se um colaborador passasse de `fromPersonId` para
 * `toPersonId`: a conta da Pessoa de destino que ainda não tem colaborador. Conta já ligada a um
 * colaborador (este ou outro) não ganha nada com a mudança. Trava as duas Pessoas (lockPersonAccountLinks)
 * antes de ler: uma conta entrando na Pessoa ao mesmo tempo espera e a decisão vê a escrita dela.
 */
export async function findAccountGainingEmployeeEvidence(
  db: Pick<Prisma.TransactionClient, "appUser" | "$executeRaw">,
  args: { fromPersonId: string | null | undefined; toPersonId: string | null | undefined }
): Promise<{ id: string; role: string } | null> {
  if (!args.toPersonId || args.toPersonId === args.fromPersonId) return null;
  await lockPersonAccountLinks(db, [args.fromPersonId, args.toPersonId]);
  const account = await db.appUser.findUnique({ where: { personId: args.toPersonId }, select: { id: true, role: true, employeeId: true } });
  if (!account || account.employeeId) return null;
  return { id: account.id, role: account.role };
}
