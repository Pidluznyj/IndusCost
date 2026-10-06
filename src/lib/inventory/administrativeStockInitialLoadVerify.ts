/**
 * VERIFY da carga inicial do Estoque Administrativo.
 * Confirma cadastro sem saldo e sem movimento.
 */
import {
  ADMINISTRATIVE_STOCK_ITEM_TYPE,
  ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
  type AdministrativeStockCsvRow,
  type AdministrativeStockItemSnapshot,
  type AdministrativeStockWarehouseSnapshot,
} from "./administrativeStockInitialLoadPreview.js";

export type AdministrativeStockVerifyFinding = {
  severity: "OK" | "ALERTA" | "BLOQUEANTE";
  code: string;
  message: string;
};

export type AdministrativeStockVerifyResult = {
  status: "OK" | "BLOQUEANTE";
  warehouse: AdministrativeStockWarehouseSnapshot | null;
  expectedCodes: number;
  foundCodes: number;
  findings: AdministrativeStockVerifyFinding[];
};

export function verifyAdministrativeStockInitialLoad(input: {
  sourceRows: readonly AdministrativeStockCsvRow[];
  warehouse: AdministrativeStockWarehouseSnapshot | null;
  items: readonly AdministrativeStockItemSnapshot[];
  balanceCountByItemId: ReadonlyMap<string, number>;
  movementCountByItemId: ReadonlyMap<string, number>;
}): AdministrativeStockVerifyResult {
  const findings: AdministrativeStockVerifyFinding[] = [];
  const push = (
    severity: AdministrativeStockVerifyFinding["severity"],
    code: string,
    message: string
  ) => {
    findings.push({ severity, code, message });
  };

  if (!input.warehouse) {
    push("BLOQUEANTE", "WAREHOUSE_MISSING", `Warehouse ${ADMINISTRATIVE_STOCK_WAREHOUSE_CODE} não existe.`);
  } else {
    if (input.warehouse.code.toUpperCase() !== ADMINISTRATIVE_STOCK_WAREHOUSE_CODE) {
      push(
        "BLOQUEANTE",
        "WAREHOUSE_CODE",
        `Warehouse code=${input.warehouse.code}; esperado=${ADMINISTRATIVE_STOCK_WAREHOUSE_CODE}.`
      );
    }
    if (input.warehouse.status !== "ACTIVE") {
      push("BLOQUEANTE", "WAREHOUSE_STATUS", `Warehouse status=${input.warehouse.status}; esperado=ACTIVE.`);
    }
    if (!input.warehouse.allowsMovements) {
      push("BLOQUEANTE", "WAREHOUSE_MOVEMENTS", "Warehouse ADMINISTRATIVO não permite movimentos.");
    }
    push("OK", "WAREHOUSE_OK", `Warehouse ${ADMINISTRATIVE_STOCK_WAREHOUSE_CODE} encontrado.`);
  }

  const byCode = new Map<string, AdministrativeStockItemSnapshot[]>();
  for (const item of input.items) {
    const key = item.code.trim().toUpperCase();
    const bucket = byCode.get(key) ?? [];
    bucket.push(item);
    byCode.set(key, bucket);
  }

  const expectedCodes = new Set(input.sourceRows.map((row) => row.code.trim().toUpperCase()));
  let foundCodes = 0;

  for (const code of expectedCodes) {
    const matches = byCode.get(code) ?? [];
    if (matches.length === 0) {
      push("BLOQUEANTE", "ITEM_MISSING", `Código ${code} do CSV não existe no InventoryItem.`);
      continue;
    }
    if (matches.length > 1) {
      push("BLOQUEANTE", "ITEM_DUPLICATE", `Código ${code} tem ${matches.length} InventoryItem.`);
      continue;
    }
    foundCodes += 1;
    const item = matches[0]!;
    if (item.itemType !== ADMINISTRATIVE_STOCK_ITEM_TYPE) {
      push(
        "BLOQUEANTE",
        "ITEM_TYPE",
        `${code}: itemType=${item.itemType}; esperado=${ADMINISTRATIVE_STOCK_ITEM_TYPE}.`
      );
    }
    if (!input.warehouse || item.defaultWarehouseId !== input.warehouse.id) {
      push(
        "BLOQUEANTE",
        "ITEM_DEFAULT_WAREHOUSE",
        `${code}: defaultWarehouseId não aponta para ADMINISTRATIVO.`
      );
    }
    if (item.defaultLocationId != null) {
      push(
        "BLOQUEANTE",
        "ITEM_DEFAULT_LOCATION",
        `${code}: defaultLocationId deveria ser null.`
      );
    }
    const balances = input.balanceCountByItemId.get(item.id) ?? 0;
    if (balances > 0) {
      push(
        "BLOQUEANTE",
        "UNEXPECTED_BALANCE",
        `${code}: encontrou ${balances} InventoryBalance (carga de cadastro não deveria criar saldo).`
      );
    }
    const movements = input.movementCountByItemId.get(item.id) ?? 0;
    if (movements > 0) {
      push(
        "BLOQUEANTE",
        "UNEXPECTED_MOVEMENT",
        `${code}: encontrou ${movements} InventoryMovement (carga de cadastro não deveria criar movimento).`
      );
    }
  }

  const status = findings.some((finding) => finding.severity === "BLOQUEANTE") ? "BLOQUEANTE" : "OK";
  if (status === "OK") {
    push(
      "OK",
      "VERIFY_OK",
      `VERIFY ok: ${foundCodes}/${expectedCodes.size} códigos ADMINISTRATIVE_SUPPLY sem saldo/movimento.`
    );
  }

  return {
    status,
    warehouse: input.warehouse,
    expectedCodes: expectedCodes.size,
    foundCodes,
    findings,
  };
}

export function formatAdministrativeStockVerifyReport(result: AdministrativeStockVerifyResult): string {
  const lines = [
    "=== ADMINISTRATIVE STOCK INITIAL LOAD VERIFY ===",
    `status: ${result.status}`,
    `warehouse: ${result.warehouse ? result.warehouse.code : "(ausente)"}`,
    `códigos esperados: ${result.expectedCodes}`,
    `códigos encontrados: ${result.foundCodes}`,
    "",
  ];
  for (const finding of result.findings) {
    lines.push(`[${finding.severity}] ${finding.code}: ${finding.message}`);
  }
  return lines.join("\n");
}

export function renderAdministrativeStockVerifyCsv(
  findings: readonly AdministrativeStockVerifyFinding[]
): string {
  const header = ["severity", "code", "message"];
  const escape = (value: string) => (/["\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [
    header.join(";"),
    ...findings.map((finding) => [finding.severity, finding.code, finding.message].map(escape).join(";")),
  ].join("\r\n");
}
