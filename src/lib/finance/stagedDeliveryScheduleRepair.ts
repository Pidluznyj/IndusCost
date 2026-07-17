/**
 * FIN-13 — CLI puro do repair de agendas staged (sem I/O).
 */

export type StagedDeliveryRepairMode = "preview" | "apply";

export type StagedDeliveryRepairCli = {
  mode: StagedDeliveryRepairMode;
  orderCode: string | null;
  from: string | null;
  to: string | null;
  batchSize: number;
  help: boolean;
};

export const STAGED_DELIVERY_REPAIR_LOG = "[repair:staged-delivery-schedules]";

export function parseStagedDeliveryRepairCli(argv: string[]): StagedDeliveryRepairCli {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      mode: "preview",
      orderCode: null,
      from: null,
      to: null,
      batchSize: 50,
      help: true,
    };
  }

  const modeRaw = argv.find((a) => a === "preview" || a === "apply" || a.startsWith("--mode="));
  let mode: StagedDeliveryRepairMode = "preview";
  if (modeRaw === "apply" || modeRaw === "--mode=apply") mode = "apply";
  if (modeRaw === "preview" || modeRaw === "--mode=preview") mode = "preview";
  const modeEq = argv.find((a) => a.startsWith("--mode="));
  if (modeEq?.endsWith("apply")) mode = "apply";
  if (modeEq?.endsWith("preview")) mode = "preview";

  const read = (name: string): string | null => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3).trim() || null;
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0) return (argv[idx + 1] ?? "").trim() || null;
    return null;
  };

  const batchRaw = read("batch-size") ?? read("batchSize") ?? "50";
  const batchSize = Math.max(1, Math.min(500, Number(batchRaw) || 50));

  return {
    mode,
    orderCode: read("order"),
    from: read("from"),
    to: read("to"),
    batchSize,
    help: false,
  };
}

export function printStagedDeliveryRepairHelp(): void {
  console.log(`
FIN-13 — Repair de agendas derivadas (entregas parciais / staged)

Uso:
  npm run repair:staged-delivery-schedules:preview -- --order="PD 02596"
  npm run repair:staged-delivery-schedules:preview -- --from=2025-01-01 --to=2026-12-31
  npm run repair:staged-delivery-schedules:apply -- --order="PD 02596"

Regras:
  - Sem chamadas ao Nomus
  - Preview não escreve
  - Apply só reprocessa fatos derivados (OrderToCashAudit), via rebuild oficial por Pedido
  - Não altera SalesOrder / Documento / NF / NomusAccountsReceivable

Docs: docs/finance/staged-delivery-schedule-repair-runbook.md
`);
}

export type StagedDeliveryRepairCandidate = {
  salesOrderId: string;
  orderCode: string;
  materializationMode: string;
  itemActiveResidualTotal: string;
  activeOrderResidualTotal: string;
  stagedResidualWithoutPosition: string;
  residualLines: Array<{
    installmentNumber: number;
    dueDate: string | null;
    residualAmount: string;
  }>;
  occupiedPositionCount: number;
  deliveryBlockCount: number;
};
