import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("treasuryPerformance audit — wiring", () => {
  it("posição e relatórios usam batch ACL/saldos", () => {
    const position = readFileSync(
      join(here, "services/treasuryFinancialPositionService.server.ts"),
      "utf8"
    );
    const report = readFileSync(
      join(here, "services/treasuryReportService.server.ts"),
      "utf8"
    );
    const bank = readFileSync(
      join(here, "services/treasuryBankMovementQueryService.server.ts"),
      "utf8"
    );
    assert.match(position, /listAccessForUser/);
    assert.match(position, /findLatestByAccountIds/);
    assert.match(report, /listAccessForUser/);
    assert.match(bank, /listAccessForUser/);
  });

  it("OFX createMovements usa createMany skipDuplicates", () => {
    const repo = readFileSync(
      join(here, "repositories/treasuryBankMovementRepository.server.ts"),
      "utf8"
    );
    const apply = readFileSync(
      join(here, "services/treasuryBankImportOfxApplyService.server.ts"),
      "utf8"
    );
    assert.match(repo, /createMany/);
    assert.match(repo, /skipDuplicates:\s*true/);
    assert.match(apply, /createMovements\(movementData/);
    assert.doesNotMatch(apply, /for \(const data of movementData\)[\s\S]*createMovements\(\[data\]/);
  });

  it("exception engine lista statuses abertos em uma query", () => {
    const engine = readFileSync(
      join(here, "services/treasuryExceptionEngineService.server.ts"),
      "utf8"
    );
    assert.match(engine, /statuses:\s*\[\.\.\.TREASURY_OPEN_EXCEPTION_STATUSES\]/);
    assert.doesNotMatch(engine, /for \(const status of TREASURY_OPEN_EXCEPTION_STATUSES\)/);
  });

  it("listagens CR/CP adiam rawPayload", () => {
    const ar = readFileSync(
      join(here, "repositories/treasuryReceivableQueryRepository.server.ts"),
      "utf8"
    );
    const ap = readFileSync(
      join(here, "repositories/treasuryPayableQueryRepository.server.ts"),
      "utf8"
    );
    assert.match(ar, /AR_SELECT_BASE/);
    assert.match(ar, /needsReceivableRawPayloadEarly/);
    assert.match(ap, /AP_SELECT_BASE/);
  });

  it("migration de índices de performance existe", () => {
    const mig = readFileSync(
      join(
        here,
        "../../../prisma/migrations/20260820120000_treasury_perf_indexes/migration.sql"
      ),
      "utf8"
    );
    assert.match(mig, /NomusAccountsReceivable_settlementDate_idx/);
    assert.match(mig, /TreasuryProjectionRun_company_scenario_status_finished_idx/);
  });
});
