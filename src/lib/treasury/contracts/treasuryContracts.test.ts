import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TREASURY_ACCOUNT_TYPES,
  TREASURY_ERROR_CODES,
  TREASURY_FIELD_LIMITS,
  TREASURY_MAX_PAGE_SIZE,
  TREASURY_PROJECTION_LAYERS,
  TREASURY_SIDES,
  TreasuryContractError,
  formatTreasuryTimestampIso,
  isTreasuryCivilDate,
  isTreasuryMoneyString,
  isTreasuryTimestampIso,
  parseTreasuryAccountsListQuery,
  parseTreasuryAuthorizedSort,
  parseTreasuryCivilDate,
  parseTreasuryCreateAccountInput,
  parseTreasuryEnum,
  parseTreasuryBoundedString,
  parseTreasuryManualLedgerEntryInput,
  parseTreasuryMoneyString,
  parseTreasuryPageSize,
  parseTreasuryPagination,
  parseTreasuryPromiseCreateInput,
  parseTreasuryTimestampIso,
  TREASURY_ACCOUNT_SORT_FIELDS,
} from "./treasuryContracts.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("treasuryContracts — money", () => {
  it("aceita valores monetários válidos e normaliza", () => {
    assert.equal(isTreasuryMoneyString("10.5"), true);
    assert.equal(parseTreasuryMoneyString("10.5", "amount"), "10.50");
    assert.equal(parseTreasuryMoneyString("-2", "amount"), "-2.00");
    assert.equal(parseTreasuryMoneyString("0.01", "amount"), "0.01");
  });

  it("rejeita valores monetários inválidos", () => {
    assert.equal(isTreasuryMoneyString("10,50"), false);
    assert.equal(isTreasuryMoneyString(10.5), false);
    assert.equal(isTreasuryMoneyString("1e2"), false);
    assert.throws(
      () => parseTreasuryMoneyString("10,50", "amount"),
      (err: unknown) =>
        err instanceof TreasuryContractError && err.code === "INVALID_MONEY"
    );
    assert.throws(
      () => parseTreasuryMoneyString("", "amount"),
      (err: unknown) =>
        err instanceof TreasuryContractError && err.code === "REQUIRED_FIELD"
    );
  });
});

describe("treasuryContracts — dates", () => {
  it("aceita datas civis YYYY-MM-DD reais", () => {
    assert.equal(isTreasuryCivilDate("2026-07-27"), true);
    assert.equal(parseTreasuryCivilDate("2026-02-28"), "2026-02-28");
  });

  it("rejeita datas inválidas e datetime em campo civil", () => {
    assert.equal(isTreasuryCivilDate("2026-02-30"), false);
    assert.equal(isTreasuryCivilDate("2026-07-27T12:00:00Z"), false);
    assert.equal(isTreasuryCivilDate("27/07/2026"), false);
    assert.throws(
      () => parseTreasuryCivilDate("2026-13-01"),
      (err: unknown) =>
        err instanceof TreasuryContractError &&
        err.code === "INVALID_CIVIL_DATE"
    );
  });

  it("timestamps exigem ISO com offset", () => {
    assert.equal(isTreasuryTimestampIso("2026-07-27T12:00:00.000Z"), true);
    assert.equal(isTreasuryTimestampIso("2026-07-27T09:00:00-03:00"), true);
    assert.equal(isTreasuryTimestampIso("2026-07-27T12:00:00+00:00"), true);
    assert.equal(isTreasuryTimestampIso("2026-07-27"), false);
    assert.equal(isTreasuryTimestampIso("2026-07-27T12:00:00"), false);
    assert.equal(
      formatTreasuryTimestampIso(new Date("2026-07-27T12:00:00.000Z")),
      "2026-07-27T12:00:00.000+00:00"
    );
    assert.equal(
      parseTreasuryTimestampIso("2026-07-27T12:00:00+00:00"),
      "2026-07-27T12:00:00+00:00"
    );
  });
});

describe("treasuryContracts — enums", () => {
  it("aceita enums conhecidos e nega desconhecidos", () => {
    assert.equal(parseTreasuryEnum("AR", TREASURY_SIDES, "side"), "AR");
    assert.equal(
      parseTreasuryEnum("CHECKING", TREASURY_ACCOUNT_TYPES, "accountType"),
      "CHECKING"
    );
    assert.ok(TREASURY_PROJECTION_LAYERS.includes("CONTRACTUAL"));
    assert.ok(TREASURY_PROJECTION_LAYERS.includes("MANUAL"));
    assert.equal(TREASURY_PROJECTION_LAYERS.length, 4);
    assert.throws(
      () => parseTreasuryEnum("XYZ", TREASURY_SIDES, "side"),
      (err: unknown) =>
        err instanceof TreasuryContractError && err.code === "INVALID_ENUM"
    );
    assert.throws(
      () => parseTreasuryEnum("", TREASURY_SIDES, "side"),
      (err: unknown) =>
        err instanceof TreasuryContractError && err.code === "REQUIRED_FIELD"
    );
  });
});

describe("treasuryContracts — pagination & sort", () => {
  it("paginação padrão e limites", () => {
    assert.deepEqual(parseTreasuryPagination({}), {
      page: 1,
      pageSize: 50,
    });
    assert.equal(parseTreasuryPageSize("25"), 25);
    assert.throws(
      () => parseTreasuryPageSize(String(TREASURY_MAX_PAGE_SIZE + 1)),
      (err: unknown) =>
        err instanceof TreasuryContractError && err.code === "PAYLOAD_TOO_LARGE"
    );
    assert.throws(
      () => parseTreasuryPageSize("0"),
      (err: unknown) =>
        err instanceof TreasuryContractError && err.code === "VALIDATION_ERROR"
    );
  });

  it("ordenação autorizada; campo desconhecido negado", () => {
    const ok = parseTreasuryAuthorizedSort({
      sortBy: "name",
      sortDirection: "desc",
      allowed: TREASURY_ACCOUNT_SORT_FIELDS,
      defaultSortBy: "code",
    });
    assert.deepEqual(ok, { sortBy: "name", sortDirection: "desc" });
    assert.throws(
      () =>
        parseTreasuryAuthorizedSort({
          sortBy: "password",
          allowed: TREASURY_ACCOUNT_SORT_FIELDS,
          defaultSortBy: "code",
        }),
      (err: unknown) =>
        err instanceof TreasuryContractError &&
        err.code === "UNKNOWN_SORT_FIELD"
    );
  });
});

describe("treasuryContracts — required fields & size limits", () => {
  it("exige campos obrigatórios em create account", () => {
    assert.throws(
      () => parseTreasuryCreateAccountInput({ name: "Conta XPTO" }),
      (err: unknown) =>
        err instanceof TreasuryContractError && err.code === "REQUIRED_FIELD"
    );
    const parsed = parseTreasuryCreateAccountInput({
      companyCode: "LAZARIOS",
      code: "CX01",
      name: "Caixa principal",
      institutionName: "Banco X",
      accountType: "CASH",
      agencyMasked: "****1",
      accountNumberMasked: "****9999",
    });
    assert.equal(parsed.currency, "BRL");
    assert.equal(parsed.includeInConsolidated, true);
    assert.equal(parsed.minimumBalance, "0.00");
  });

  it("rejeita strings acima do limite", () => {
    const tooLong = "x".repeat(TREASURY_FIELD_LIMITS.name + 1);
    assert.throws(
      () => parseTreasuryBoundedString(tooLong, "name"),
      (err: unknown) =>
        err instanceof TreasuryContractError && err.code === "PAYLOAD_TOO_LARGE"
    );
  });

  it("valida lançamento manual e promessa com money/date/enum", () => {
    const entry = parseTreasuryManualLedgerEntryInput({
      accountId: "acc-1",
      civilDate: "2026-07-27",
      amount: "100.00",
      direction: "DEBIT",
      nature: "MANUAL",
      memo: "ajuste",
    });
    assert.equal(entry.amount, "100.00");
    const promise = parseTreasuryPromiseCreateInput({
      side: "AR",
      nomusExternalId: "123",
      promisedDate: "2026-08-01",
      promisedAmount: "50",
    });
    assert.equal(promise.promisedAmount, "50.00");
  });

  it("lista contas aplica filtros/paginação", () => {
    const q = parseTreasuryAccountsListQuery({
      page: "2",
      pageSize: "10",
      sortBy: "createdAt",
      sortDirection: "desc",
      search: "caixa",
      isActive: "true",
      companyCode: "LAZARIOS",
    });
    assert.equal(q.page, 2);
    assert.equal(q.pageSize, 10);
    assert.equal(q.sortBy, "createdAt");
    assert.equal(q.search, "caixa");
    assert.equal(q.isActive, true);
    assert.equal(q.companyCode, "LAZARIOS");
  });
});

describe("treasuryContracts — client-safe graph", () => {
  it("arquivos de contracts não importam Prisma nem *.server", () => {
    const files = readdirSync(here).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")
    );
    assert.ok(files.length >= 8);
    for (const file of files) {
      const source = readFileSync(join(here, file), "utf8");
      assert.doesNotMatch(source, /@prisma\/client|from ["'].*prisma/);
      assert.doesNotMatch(source, /\.server\.js|\.server["']/);
    }
  });

  it("códigos de erro conhecidos estão estáveis", () => {
    assert.ok(TREASURY_ERROR_CODES.includes("INVALID_MONEY"));
    assert.ok(TREASURY_ERROR_CODES.includes("UNKNOWN_SORT_FIELD"));
  });
});
