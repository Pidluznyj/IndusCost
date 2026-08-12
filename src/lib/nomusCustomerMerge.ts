/**
 * Merge de 3 vias do sync de clientes Nomus — puro, sem I/O.
 *
 * Problema que resolve: o sync antigo sobrescrevia o Customer inteiro a cada
 * rodada (inclusive `notes`, destruído com um marcador), apagando edições e
 * dados complementares criados no IndusCost.
 *
 * As três vias:
 *   - BASE  = `nomusSnapshotJson` (o que o Nomus enviou na ÚLTIMA rodada);
 *   - OURS  = valor atual no IndusCost (pode conter edição do usuário);
 *   - THEIRS= valor que o Nomus está enviando AGORA.
 *
 * Regras, campo a campo (SYNCED_FIELDS):
 *   1. THEIRS vazio ⇒ nunca apaga valor local (Nomus sem o dado não é ordem
 *      de deleção);
 *   2. OURS vazio ⇒ preenche com THEIRS;
 *   3. OURS == BASE (usuário não mexeu desde a última rodada) ⇒ atualiza
 *      para THEIRS;
 *   4. OURS != BASE (usuário editou) ⇒ PRESERVA o valor local;
 *   5. sem BASE (primeira rodada pós-migração) ⇒ modo conservador fill-only:
 *      só a regra 2 se aplica — nenhum valor local não-vazio é sobrescrito.
 *
 * Fora do merge (o sync NUNCA escreve):
 *   - `notes` e todos os campos complementares do IndusCost (address, zipCode,
 *     segment, commercialNotes, relationshipStatus, accountOwner, vínculos);
 *   - `status`: nunca reativa cliente inativado localmente (mesma regra 4 —
 *     INACTIVE local difere do snapshot ⇒ preservado).
 *
 * Clientes que só existem no IndusCost não passam por aqui (o sync não
 * deleta); quando o mesmo CNPJ/CPF surgir no Nomus, o match por taxId cai
 * neste merge e a "junção" preenche o que falta sem sobrescrever o que o
 * usuário criou.
 */

/** Campos cadastrais que o Nomus pode atualizar (sujeitos ao merge). */
export const NOMUS_CUSTOMER_SYNCED_FIELDS = [
  "companyName",
  "tradeName",
  "contactName",
  "email",
  "phone",
  "city",
  "state",
  "status",
] as const;
export type NomusCustomerSyncedField = (typeof NOMUS_CUSTOMER_SYNCED_FIELDS)[number];

export type NomusCustomerSyncedValues = Partial<
  Record<NomusCustomerSyncedField, string | null>
>;

export type NomusCustomerMergeInput = {
  /** Valores atuais no IndusCost (OURS). */
  current: NomusCustomerSyncedValues;
  /** Valores que o Nomus enviou agora (THEIRS). */
  incoming: NomusCustomerSyncedValues;
  /** Último snapshot gravado (BASE) — null na primeira rodada pós-migração. */
  lastSnapshot: NomusCustomerSyncedValues | null;
};

export type NomusCustomerMergeResult = {
  /** Somente os campos que DEVEM ser gravados (update mínimo). */
  data: NomusCustomerSyncedValues;
  /** Campos atualizados com o valor do Nomus. */
  changedFields: NomusCustomerSyncedField[];
  /** Campos com edição local preservada (OURS != BASE). */
  preservedFields: NomusCustomerSyncedField[];
};

function normalized(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Snapshot canônico a persistir em `nomusSnapshotJson` (sempre o THEIRS cru mapeado). */
export function buildNomusCustomerSnapshot(
  incoming: NomusCustomerSyncedValues
): Record<string, string | null> {
  const snapshot: Record<string, string | null> = {};
  for (const field of NOMUS_CUSTOMER_SYNCED_FIELDS) {
    snapshot[field] = normalized(incoming[field]);
  }
  return snapshot;
}

export function mergeNomusCustomerUpdate(
  input: NomusCustomerMergeInput
): NomusCustomerMergeResult {
  const data: NomusCustomerSyncedValues = {};
  const changedFields: NomusCustomerSyncedField[] = [];
  const preservedFields: NomusCustomerSyncedField[] = [];

  for (const field of NOMUS_CUSTOMER_SYNCED_FIELDS) {
    const ours = normalized(input.current[field]);
    const theirs = normalized(input.incoming[field]);
    const base = input.lastSnapshot ? normalized(input.lastSnapshot[field]) : null;

    // Regra 1: Nomus sem o dado nunca apaga valor local.
    if (theirs == null) continue;
    // Nada a fazer se já são iguais.
    if (ours === theirs) continue;

    // Regra 2: campo local vazio ⇒ preenche.
    if (ours == null) {
      data[field] = theirs;
      changedFields.push(field);
      continue;
    }

    // Regra 5: sem snapshot ⇒ fill-only — valor local não-vazio é intocável.
    if (input.lastSnapshot == null) {
      preservedFields.push(field);
      continue;
    }

    // Regra 3: usuário não mexeu desde a última rodada ⇒ Nomus atualiza.
    if (ours === base) {
      data[field] = theirs;
      changedFields.push(field);
      continue;
    }

    // Regra 4: edição local ⇒ preserva.
    preservedFields.push(field);
  }

  return { data, changedFields, preservedFields };
}
