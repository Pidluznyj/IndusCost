import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TREASURY_ALERT_SETTINGS } from "../contracts/treasuryAlertConfig.js";
import {
  buildTreasuryAlerts,
  filterTreasuryAlertsForCivilDate,
} from "./treasuryAlertRules.js";
import {
  normalizeTreasuryAlertSettingsFields,
  parseTreasuryAlertSettingsInput,
} from "./treasuryAlertSettingsRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

const NOW = Date.parse("2026-08-14T15:00:00.000Z");

describe("treasuryAlertRules — por tipo", () => {
  it("saldo negativo", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      accounts: [
        {
          accountId: "a1",
          availableBalance: "-10.00",
          minimumBalance: "0.00",
          lastBalanceAtIso: "2026-08-14T12:00:00.000Z",
        },
      ],
    });
    assert.ok(alerts.some((a) => a.kind === "NEGATIVE_BALANCE"));
  });

  it("saldo abaixo do mínimo", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      accounts: [
        {
          accountId: "a1",
          availableBalance: "50.00",
          minimumBalance: "100.00",
          lastBalanceAtIso: "2026-08-14T12:00:00.000Z",
        },
      ],
    });
    assert.ok(alerts.some((a) => a.kind === "BELOW_MINIMUM"));
  });

  it("recebimento relevante não realizado", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      receivables: [
        {
          officialTitleId: "r1",
          customerKey: "c1",
          openAmount: "15000.00",
          expectedDate: "2026-08-10",
        },
      ],
    });
    assert.ok(alerts.some((a) => a.kind === "RELEVANT_RECEIPT_NOT_RECEIVED"));
  });

  it("concentração em poucos clientes", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      receivables: [
        {
          officialTitleId: "r1",
          customerKey: "c1",
          openAmount: "80.00",
          expectedDate: null,
        },
        {
          officialTitleId: "r2",
          customerKey: "c2",
          openAmount: "10.00",
          expectedDate: null,
        },
        {
          officialTitleId: "r3",
          customerKey: "c3",
          openAmount: "5.00",
          expectedDate: null,
        },
        {
          officialTitleId: "r4",
          customerKey: "c4",
          openAmount: "5.00",
          expectedDate: null,
        },
      ],
    });
    assert.ok(alerts.some((a) => a.kind === "CUSTOMER_CONCENTRATION"));
  });

  it("sync atrasada", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      syncFreshness: [
        { side: "AR", lastSuccessAtIso: "2026-08-01T00:00:00.000Z" },
      ],
    });
    assert.ok(alerts.some((a) => a.kind === "SYNC_DELAYED"));
  });

  it("saldo desatualizado", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      accounts: [
        {
          accountId: "a1",
          availableBalance: "10.00",
          minimumBalance: "0.00",
          lastBalanceAtIso: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    assert.ok(alerts.some((a) => a.kind === "STALE_BALANCE"));
  });

  it("promessa vencida", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      promises: [
        {
          id: "p1",
          officialTitleId: "r1",
          promisedDate: "2026-08-01",
          status: "ACTIVE",
          promisedAmount: "100.00",
        },
      ],
    });
    assert.ok(alerts.some((a) => a.kind === "EXPIRED_PROMISE"));
  });

  it("pagamento crítico", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      payables: [
        {
          officialTitleId: "ap1",
          openAmount: "500.00",
          isCritical: true,
          isProgrammed: false,
        },
      ],
    });
    assert.ok(alerts.some((a) => a.kind === "CRITICAL_PAYMENT"));
  });

  it("respeita enabledByKind e alertsEnabled", () => {
    const settings = normalizeTreasuryAlertSettingsFields({
      ...DEFAULT_TREASURY_ALERT_SETTINGS,
      enabledByKind: {
        ...DEFAULT_TREASURY_ALERT_SETTINGS.enabledByKind,
        NEGATIVE_BALANCE: false,
      },
    });
    const alerts = buildTreasuryAlerts(settings, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      accounts: [
        {
          accountId: "a1",
          availableBalance: "-1.00",
          minimumBalance: "0.00",
          lastBalanceAtIso: "2026-08-14T12:00:00.000Z",
        },
      ],
    });
    assert.equal(
      alerts.filter((a) => a.kind === "NEGATIVE_BALANCE").length,
      0
    );

    const off = buildTreasuryAlerts(
      { ...DEFAULT_TREASURY_ALERT_SETTINGS, alertsEnabled: false },
      {
        asOfCivilDate: "2026-08-14",
        nowEpochMs: NOW,
        accounts: [
          {
            accountId: "a1",
            availableBalance: "-1.00",
            minimumBalance: "0.00",
            lastBalanceAtIso: "2026-08-14T12:00:00.000Z",
          },
        ],
      }
    );
    assert.equal(off.length, 0);
  });

  it("filtra alertas por dia civil", () => {
    const alerts = buildTreasuryAlerts(DEFAULT_TREASURY_ALERT_SETTINGS, {
      asOfCivilDate: "2026-08-14",
      nowEpochMs: NOW,
      projectionDays: [
        {
          civilDate: "2026-08-20",
          accountId: null,
          closingBalance: "-5.00",
        },
      ],
    });
    assert.equal(
      filterTreasuryAlertsForCivilDate(alerts, "2026-08-20").length,
      1
    );
    assert.equal(
      filterTreasuryAlertsForCivilDate(alerts, "2026-08-14").length,
      0
    );
  });
});

describe("treasuryAlertSettingsRules", () => {
  it("parse rejeita share > 100", () => {
    assert.throws(
      () =>
        parseTreasuryAlertSettingsInput({
          customerConcentrationMinSharePercent: "120",
        }),
      TreasuryDomainError
    );
  });

  it("normaliza defaults e severidade", () => {
    const fields = parseTreasuryAlertSettingsInput({
      severityByKind: { STALE_BALANCE: "CRITICAL" },
      relevantReceiptMinAmount: "20000",
    });
    assert.equal(fields.severityByKind.STALE_BALANCE, "CRITICAL");
    assert.equal(fields.relevantReceiptMinAmount, "20000.00");
  });
});
