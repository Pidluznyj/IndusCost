/**
 * Auditoria de cobertura unitária obrigatória da Tesouraria (Prompt 59).
 * Garante existência dos arquivos de regra — sem espelhar implementação.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const REQUIRED_DOMAIN_TESTS: Array<{ area: string; file: string }> = [
  { area: "contas", file: "domain/treasuryAccountRules.test.ts" },
  { area: "saldos", file: "domain/treasuryBalanceRules.test.ts" },
  { area: "permissoes", file: "treasuryPermissions.test.ts" },
  { area: "expectativas", file: "domain/treasuryReceivableExpectationRules.test.ts" },
  { area: "promessas", file: "domain/treasuryPaymentPromiseRules.test.ts" },
  { area: "cobranca", file: "domain/treasuryCollectionActionRules.test.ts" },
  { area: "contestacao", file: "domain/treasuryDisputeRules.test.ts" },
  { area: "pagamentos", file: "domain/treasuryPayableProgrammingRules.test.ts" },
  { area: "consulta-cr", file: "domain/treasuryReceivableQueryRules.test.ts" },
  { area: "consulta-cp", file: "domain/treasuryPayableQueryRules.test.ts" },
  { area: "projecao", file: "domain/treasuryProjectionEngine.test.ts" },
  { area: "dupla-contagem", file: "domain/treasuryFinancialIdentityRules.test.ts" },
  { area: "decimal", file: "treasuryMoney.test.ts" },
  { area: "datas", file: "domain/treasuryMovementDateRules.test.ts" },
  { area: "transferencias", file: "domain/treasuryTransferRules.test.ts" },
  { area: "excecoes", file: "domain/treasuryExceptionRules.test.ts" },
  { area: "fechamento", file: "domain/treasuryDailyClosingRules.test.ts" },
  { area: "ofx", file: "domain/treasuryOfxPreviewRules.test.ts" },
  { area: "conciliacao", file: "domain/treasuryReconciliationMatchRules.test.ts" },
  { area: "relatorios", file: "domain/treasuryReportRules.test.ts" },
];

describe("treasuryUnitCoverage — checklist obrigatória", () => {
  it("todos os arquivos de teste de regra obrigatórios existem", () => {
    const missing = REQUIRED_DOMAIN_TESTS.filter(
      (item) => !existsSync(join(here, item.file))
    );
    assert.deepEqual(
      missing,
      [],
      `Faltam testes de regra: ${missing.map((m) => m.area).join(", ")}`
    );
  });
});
