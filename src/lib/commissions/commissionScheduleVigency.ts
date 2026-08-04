/**
 * Vigência de CommissionReceivableSchedule — regra oficial única.
 *
 * REGRA
 * Nenhum schedule pode ser usado para cálculo, fechamento, relatório,
 * diagnóstico ou geração de ledger quando seu CommissionOrderSnapshot pai não
 * estiver ACTIVE. Vale mesmo com o schedule em ACTIVE, CUSTOMER_EXCLUDED ou
 * qualquer outro status operacional: o status do schedule descreve o PAPEL da
 * linha dentro da versão; quem decide se a versão vale é o pai.
 *
 * POR QUE ISTO EXISTE
 * `CommissionOrderSnapshot` é versionado: materializar de novo marca o anterior
 * como SUPERSEDED e cria outro ACTIVE. Os schedules do anterior continuavam
 * ACTIVE e disputavam a seleção com os corretos — o motor escolhia o primeiro
 * ACTIVE que aparecesse, sem olhar o pai, e fechava comissão com a versão
 * errada (PD 02697: cinco schedules zerados vencendo cinco de R$ 137,79).
 *
 * O índice único parcial existente é
 * `(orderSnapshotId, receivableId) WHERE status='ACTIVE'` — escopado POR
 * snapshot, então ele permite, por construção, vários ACTIVE para o mesmo
 * título em snapshots diferentes. A unicidade real é cross-table e não cabe
 * num índice parcial; por isso a regra vive aqui, no domínio, e é aplicada
 * tanto no filtro do banco quanto na seleção em memória (defesa em profundidade).
 */

/** Status do snapshot pai que torna seus schedules vigentes. */
export const COMMISSION_ACTIVE_SNAPSHOT_STATUS = "ACTIVE" as const;

/**
 * Fragmento de `where` Prisma para restringir schedules ao pai vigente.
 *
 * Use SEMPRE que consultar `commissionReceivableSchedule` diretamente:
 *
 *     where: { receivableId: { in: ids }, ...commissionActiveSnapshotWhere() }
 *
 * Não é necessário quando a consulta parte de `commissionOrderSnapshot` com
 * `status: "ACTIVE"` e aninha `receivableSchedules` — nesse caso o pai vigente
 * já está garantido pelo aninhamento.
 */
export function commissionActiveSnapshotWhere(): {
  orderSnapshot: { status: typeof COMMISSION_ACTIVE_SNAPSHOT_STATUS };
} {
  return { orderSnapshot: { status: COMMISSION_ACTIVE_SNAPSHOT_STATUS } };
}

/** O snapshot pai está vigente? `null`/`undefined` = desconhecido ⇒ não vigente. */
export function isCommissionSnapshotActive(
  orderSnapshotStatus: string | null | undefined
): boolean {
  return orderSnapshotStatus === COMMISSION_ACTIVE_SNAPSHOT_STATUS;
}

export type CommissionScheduleVigencyInput = {
  /** Status operacional do próprio schedule. */
  scheduleStatus?: string | null;
  /** Status do CommissionOrderSnapshot pai. */
  orderSnapshotStatus?: string | null;
};

/**
 * O schedule pode ser usado como fonte de cálculo?
 *
 * Exige as DUAS condições:
 *   - pai vigente (`orderSnapshot.status === ACTIVE`);
 *   - schedule em `ACTIVE`.
 *
 * `CUSTOMER_EXCLUDED` NÃO é vigente para cálculo — é um desfecho terminal
 * (comissão zero por regra de cliente) e tem tratamento próprio no motor, que
 * ainda assim só deve considerá-lo quando o pai for o vigente. Use
 * {@link isCommissionScheduleFromActiveSnapshot} quando precisar apenas do
 * recorte de vigência do pai, preservando o status operacional.
 */
export function isCommissionScheduleCurrent(
  input: CommissionScheduleVigencyInput
): boolean {
  return (
    isCommissionSnapshotActive(input.orderSnapshotStatus) &&
    input.scheduleStatus === "ACTIVE"
  );
}

/**
 * O schedule pertence à versão vigente do pedido, qualquer que seja seu status
 * operacional? Preserva `CUSTOMER_EXCLUDED` e demais desfechos legítimos,
 * descartando só o que veio de snapshot substituído.
 */
export function isCommissionScheduleFromActiveSnapshot(
  input: CommissionScheduleVigencyInput
): boolean {
  return isCommissionSnapshotActive(input.orderSnapshotStatus);
}

/**
 * Filtra uma lista de schedules deixando só os da versão vigente do pedido.
 * Mantém a ordem de entrada e preserva o status operacional de cada linha.
 */
export function keepSchedulesFromActiveSnapshot<
  T extends CommissionScheduleVigencyInput,
>(schedules: readonly T[]): T[] {
  return schedules.filter((row) => isCommissionScheduleFromActiveSnapshot(row));
}
