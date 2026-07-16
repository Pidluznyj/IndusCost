import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED,
  NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE,
} from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import { mapNomusProductionOrderPayload } from "@/src/lib/nomusProductionOrdersMapper.js";
import {
  canonicalizeNomusProductionOrderValue,
  NOMUS_PRODUCTION_ORDER_TIMEZONE,
  normalizeNomusProductionOrderCode,
  normalizeNomusProductionOrderString,
  parseNomusProductionOrderDateTime,
  parseNomusProductionOrderDecimal,
  parseNomusProductionQuantity,
  stableNomusProductionOrderPayloadHash,
  stableSerializeNomusProductionOrderPayload,
  validateNomusProductionOrderPayload,
  wallTimeInTimeZoneToUtc,
} from "@/src/lib/nomusProductionOrdersParsers.js";

describe("parseNomusProductionOrderDecimal", () => {
  it("converte milhar pt-BR com ponto", () => {
    assert.equal(parseNomusProductionOrderDecimal("15.400").ok && parseNomusProductionOrderDecimal("15.400").value, 15400);
    assert.equal(parseNomusProductionQuantity("15.400"), 15400);
    assert.equal(parseNomusProductionQuantity("30.000"), 30000);
  });

  it("converte decimal com vírgula", () => {
    const parsed = parseNomusProductionOrderDecimal("0,002925");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value, 0.002925);
  });

  it("aceita inteiro simples", () => {
    assert.equal(parseNomusProductionQuantity("20"), 20);
  });

  it("null e vazio são ausência explícita (não viram 0)", () => {
    const nullResult = parseNomusProductionOrderDecimal(null);
    assert.equal(nullResult.ok, true);
    if (!nullResult.ok) return;
    assert.equal(nullResult.value, null);
    assert.equal(nullResult.absent, true);

    const empty = parseNomusProductionOrderDecimal("");
    assert.equal(empty.ok, true);
    if (!empty.ok) return;
    assert.equal(empty.value, null);
    assert.equal(empty.absent, true);

    const spaces = parseNomusProductionOrderDecimal("   ");
    assert.equal(spaces.ok, true);
    if (!spaces.ok) return;
    assert.equal(spaces.value, null);
    assert.equal(spaces.absent, true);
  });
});

describe("parseNomusProductionOrderDateTime", () => {
  it("interpreta dd/MM/yyyy HH:mm:ss em America/Sao_Paulo", () => {
    const parsed = parseNomusProductionOrderDateTime("10/03/2026 08:15:00");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.absent, false);
    assert.ok(parsed.value);

    const expected = wallTimeInTimeZoneToUtc({
      year: 2026,
      month: 3,
      day: 10,
      hour: 8,
      minute: 15,
      second: 0,
      timeZone: NOMUS_PRODUCTION_ORDER_TIMEZONE,
    });
    assert.ok(expected);
    assert.equal(parsed.value!.getTime(), expected!.getTime());

    // Conferência: wall clock em São Paulo.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: NOMUS_PRODUCTION_ORDER_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(parsed.value!).map((p) => [p.type, p.value])
    );
    assert.equal(parts.year, "2026");
    assert.equal(parts.month, "03");
    assert.equal(parts.day, "10");
    assert.equal(parts.hour, "08");
    assert.equal(parts.minute, "15");
    assert.equal(parts.second, "00");
  });

  it("permite ausência (null / vazio)", () => {
    const absentNull = parseNomusProductionOrderDateTime(null);
    assert.equal(absentNull.ok, true);
    if (!absentNull.ok) return;
    assert.equal(absentNull.value, null);
    assert.equal(absentNull.absent, true);

    const absentEmpty = parseNomusProductionOrderDateTime("");
    assert.equal(absentEmpty.ok, true);
    if (!absentEmpty.ok) return;
    assert.equal(absentEmpty.value, null);
    assert.equal(absentEmpty.absent, true);
  });

  it("registra data inválida como erro controlado", () => {
    const badFormat = parseNomusProductionOrderDateTime("2026-03-10");
    assert.equal(badFormat.ok, false);
    if (badFormat.ok) return;
    assert.equal(badFormat.error, "INVALID_DATE_FORMAT");

    const badDay = parseNomusProductionOrderDateTime("31/02/2026 10:00:00");
    assert.equal(badDay.ok, false);
    if (badDay.ok) return;
    assert.equal(badDay.error, "INVALID_DATE_VALUE");
  });
});

describe("normalizeNomusProductionOrderString", () => {
  it("faz trim e preserva códigos oficiais", () => {
    assert.equal(normalizeNomusProductionOrderString("  OP 05800 - 003  "), "OP 05800 - 003");
    assert.equal(normalizeNomusProductionOrderCode("  311.32AA  "), "311.32AA");
    assert.equal(normalizeNomusProductionOrderCode("00010"), "00010");
    assert.equal(normalizeNomusProductionOrderString(""), null);
    assert.equal(normalizeNomusProductionOrderString(null), null);
  });
});

describe("validateNomusProductionOrderPayload + rawPayload", () => {
  it("validação mínima e campos desconhecidos não quebram", () => {
    const validated = validateNomusProductionOrderPayload(
      NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE
    );
    assert.equal(validated.ok, true);
    assert.equal(validated.externalId, 30347);
    assert.ok(validated.payload);
    assert.equal(validated.payload!.campoDesconhecidoNomus != null, true);

    const invalid = validateNomusProductionOrderPayload("x");
    assert.equal(invalid.ok, false);
    assert.deepEqual(invalid.reasons, ["INVALID_PAYLOAD_OBJECT"]);

    const missingId = validateNomusProductionOrderPayload({ nome: "OP X" });
    assert.equal(missingId.ok, false);
    assert.deepEqual(missingId.reasons, ["MISSING_EXTERNAL_ID"]);
  });

  it("mapper preserva rawPayload e ignora campos desconhecidos", () => {
    const mapped = mapNomusProductionOrderPayload(
      NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE
    );
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.rawJson, NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(
      (mapped.row.rawJson as { campoDesconhecidoNomus?: unknown }).campoDesconhecidoNomus !=
        null,
      true
    );
    assert.equal(mapped.fieldErrors.length, 0);
  });
});

describe("stableNomusProductionOrderPayloadHash", () => {
  it("é determinístico com chaves ordenadas e estável", () => {
    const a = { b: 2, a: 1, nested: { z: 1, a: 2 } };
    const b = { nested: { a: 2, z: 1 }, a: 1, b: 2 };
    assert.equal(
      stableSerializeNomusProductionOrderPayload(a),
      stableSerializeNomusProductionOrderPayload(b)
    );
    assert.equal(
      stableNomusProductionOrderPayloadHash(a),
      stableNomusProductionOrderPayloadHash(b)
    );
    assert.match(stableNomusProductionOrderPayloadHash(a), /^[a-f0-9]{64}$/);
  });

  it("não inclui segredos nem timestamps locais", () => {
    const withSecrets = {
      id: 1,
      token: "secret-token",
      authorization: "Bearer x",
      syncedAt: "2026-07-16T12:00:00.000Z",
      firstSeenAt: "local",
      lastChangedAt: "local",
      dataAlteracao: "12/03/2026 17:40:22",
    };
    const canonical = canonicalizeNomusProductionOrderValue(withSecrets) as Record<
      string,
      unknown
    >;
    assert.equal("token" in canonical, false);
    assert.equal("authorization" in canonical, false);
    assert.equal("syncedAt" in canonical, false);
    assert.equal("firstSeenAt" in canonical, false);
    assert.equal("lastChangedAt" in canonical, false);
    assert.equal(canonical.dataAlteracao, "12/03/2026 17:40:22");
    assert.equal(canonical.id, 1);

    const hashA = stableNomusProductionOrderPayloadHash(withSecrets);
    const hashB = stableNomusProductionOrderPayloadHash({
      id: 1,
      dataAlteracao: "12/03/2026 17:40:22",
      password: "ignored",
    });
    assert.equal(hashA, hashB);
  });
});

describe("fixture OP 05800 - 003 (caso real)", () => {
  it("normaliza externalId, OP, quantidade e vínculo pedido/item", () => {
    const mapped = mapNomusProductionOrderPayload(
      NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE
    );
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;

    const expected = NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED;
    assert.equal(mapped.row.externalId, expected.externalId);
    assert.equal(mapped.row.name, expected.name);
    assert.ok(mapped.row.quantity?.equals(new Prisma.Decimal(expected.quantity)));
    assert.equal(mapped.row.salesLinks.length, 1);
    assert.equal(
      mapped.row.salesLinks[0]!.externalSalesOrderId,
      expected.externalSalesOrderId
    );
    assert.equal(
      mapped.row.salesLinks[0]!.externalSalesOrderItemId,
      expected.externalSalesOrderItemId
    );
    assert.equal(mapped.row.salesLinks[0]!.itemNumber, expected.itemNumber);
    assert.ok(
      mapped.row.salesLinks[0]!.linkedQuantity?.equals(
        new Prisma.Decimal(expected.linkedQuantity)
      )
    );
    assert.equal(expected.salesOrderCode, "PD 02534");
    assert.ok(mapped.row.openedAt);
    assert.ok(mapped.row.closedAt);
    assert.ok(mapped.row.payloadHash.length === 64);
  });

  it("datas inválidas no payload viram fieldErrors controlados", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 1,
      dataAbertura: "não-é-data",
      quantidade: "20",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.openedAt, null);
    assert.equal(mapped.fieldErrors.length, 1);
    assert.equal(mapped.fieldErrors[0]!.field, "openedAt");
    assert.equal(mapped.fieldErrors[0]!.error, "INVALID_DATE_FORMAT");
  });
});
