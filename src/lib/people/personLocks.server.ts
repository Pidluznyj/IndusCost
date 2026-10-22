/**
 * Serialização de operações de identidade em PostgreSQL.
 * - Linha da Pessoa: FOR UPDATE em quem muda a situação/unifica; FOR SHARE em quem cria vínculo
 *   (vínculo × inativação/unificação deixam de se cruzar).
 * - Chave de identidade (CPF/e-mail): advisory lock da transação, porque Person não tem UNIQUE
 *   de CPF/e-mail no banco (decisão da auditoria) — a 2ª criação espera e cai na checagem de duplicidade.
 * - Conta ↔ colaborador na mesma Pessoa: advisory lock por Pessoa para quem põe colaborador OU conta
 *   numa Pessoa (os FOR SHARE acima não se excluem entre si) — a checagem da evidência "mesma Pessoa"
 *   da política de identidade de conta sempre vê a escrita concorrente.
 */
import type { Prisma } from "@prisma/client";

type RawTx = Pick<Prisma.TransactionClient, "$executeRaw">;

export async function lockPersonRows(tx: RawTx, ids: Array<string | null | undefined>, mode: "UPDATE" | "SHARE"): Promise<void> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))].sort();
  for (const id of uniq) {
    if (mode === "UPDATE") await tx.$executeRaw`SELECT id FROM "Person" WHERE id = ${id}::uuid FOR UPDATE`;
    else await tx.$executeRaw`SELECT id FROM "Person" WHERE id = ${id}::uuid FOR SHARE`;
  }
}

export async function lockPersonAccountLinks(tx: RawTx, personIds: Array<string | null | undefined>): Promise<void> {
  await lockIdentityKeys(tx, personIds.map((id) => (id ? `account-link:${id}` : null)));
}

export async function lockIdentityKeys(tx: RawTx, keys: Array<string | null | undefined>): Promise<void> {
  const uniq = [...new Set(keys.filter((x): x is string => Boolean(x)).map((k) => k.toLowerCase()))].sort();
  for (const key of uniq) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"person-identity:" + key}))`;
  }
}
