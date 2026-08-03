/**
 * Regressão de fuso na carga do fechamento diário oficial.
 *
 * `TreasuryDailyClosing.civilDate` é `@db.Date`: o Postgres devolve meia-noite
 * UTC. Se o limite do filtro for montado com meia-noite LOCAL
 * (`civilDateToLocalDate`), em UTC-3 ele vira 03:00Z e o fechamento do próprio
 * dia do limite cai fora do `gte` — o saldo informado daquele dia sumiria da
 * tela e a cadeia de saldos seguiria errada a partir dali.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateUtcRange } from "./treasuryCaixaService.server.js";

describe("treasuryCaixaService — civilDateUtcRange", () => {
  it("ancora o limite inferior na meia-noite UTC do próprio dia", () => {
    const { gte } = civilDateUtcRange("2026-01-01", "2026-12-31");
    assert.equal(gte.toISOString(), "2026-01-01T00:00:00.000Z");
  });

  it("limite superior é EXCLUSIVO no dia seguinte (inclui o último dia)", () => {
    const { lt } = civilDateUtcRange("2026-01-01", "2026-12-31");
    assert.equal(lt.toISOString(), "2027-01-01T00:00:00.000Z");
  });

  it("um fechamento gravado no primeiro dia do range entra no filtro", () => {
    const { gte, lt } = civilDateUtcRange("2026-03-01", "2026-03-31");
    // Como o Postgres devolve @db.Date: meia-noite UTC.
    const closing = new Date("2026-03-01T00:00:00.000Z");
    assert.ok(closing >= gte, "fechamento do primeiro dia não pode ficar fora");
    assert.ok(closing < lt);
  });

  it("um fechamento no último dia do range entra no filtro", () => {
    const { gte, lt } = civilDateUtcRange("2026-03-01", "2026-03-31");
    const closing = new Date("2026-03-31T00:00:00.000Z");
    assert.ok(closing >= gte);
    assert.ok(closing < lt, "fechamento do último dia não pode ficar fora");
  });

  it("o dia seguinte ao fim do range fica de fora", () => {
    const { lt } = civilDateUtcRange("2026-03-01", "2026-03-31");
    const closing = new Date("2026-04-01T00:00:00.000Z");
    assert.ok(closing >= lt);
  });

  it("NÃO usa meia-noite local — este é o bug que o teste trava", () => {
    const { gte } = civilDateUtcRange("2026-01-01", "2026-01-31");
    const localMidnight = new Date(2026, 0, 1, 0, 0, 0, 0);
    // Em qualquer fuso com offset negativo (America/Sao_Paulo), a meia-noite
    // local é DEPOIS da meia-noite UTC — e excluiria o próprio dia.
    if (localMidnight.getTime() !== gte.getTime()) {
      assert.ok(
        gte.getTime() <= localMidnight.getTime(),
        "o limite UTC precisa ser <= a meia-noite local para não perder o dia"
      );
    }
  });

  it("vira o ano corretamente no limite superior", () => {
    const { lt } = civilDateUtcRange("2026-12-31", "2026-12-31");
    assert.equal(lt.toISOString(), "2027-01-01T00:00:00.000Z");
  });

  it("vira o mês corretamente no limite superior", () => {
    const { lt } = civilDateUtcRange("2026-02-01", "2026-02-28");
    assert.equal(lt.toISOString(), "2026-03-01T00:00:00.000Z");
  });
});
