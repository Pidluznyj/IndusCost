/**
 * Preview determinístico — filtros semanticamente iguais precisam produzir a
 * MESMA forma canônica, e filtros diferentes precisam produzir formas
 * diferentes.
 *
 * O hash antigo montava o payload direto do objeto recebido: `JSON.stringify`
 * omite chave `undefined` e mantém `null`, então filtros idênticos em
 * significado geravam hashes distintos. No apply isso vira `RUN_TOKEN_MISMATCH`
 * espúrio.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCommissionReprocessFilters,
  serializeNormalizedCommissionReprocessFilters,
} from "./commissionReprocessFilterNormalization.js";

/** Forma canônica serializada — é o que alimenta o hash. */
function canon(filters: unknown): string {
  return serializeNormalizedCommissionReprocessFilters(
    normalizeCommissionReprocessFilters(filters as never)
  );
}

describe("normalização — null, undefined e omissão são o mesmo estado", () => {
  it("undefined, null e chave ausente convergem", () => {
    const a = canon({ customerExternalId: undefined });
    const b = canon({ customerExternalId: null });
    const c = canon({});
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it("objeto nulo inteiro não quebra", () => {
    assert.equal(canon(null), canon({}));
    assert.equal(canon(undefined), canon({}));
  });

  it("nenhuma chave sai como undefined na forma canônica", () => {
    const n = normalizeCommissionReprocessFilters({});
    for (const [key, value] of Object.entries(n)) {
      assert.notEqual(value, undefined, `chave ${key} veio undefined`);
    }
  });
});

describe("normalização — texto vazio e espaços", () => {
  it("string vazia equivale a sem filtro", () => {
    assert.equal(canon({ salesOrderCode: "" }), canon({ salesOrderCode: null }));
  });

  it("só espaços equivale a sem filtro", () => {
    assert.equal(canon({ productCode: "   " }), canon({ productCode: null }));
  });

  it("espaços em volta não mudam o filtro", () => {
    assert.equal(
      canon({ salesOrderCode: "  PD 02747  " }),
      canon({ salesOrderCode: "PD 02747" })
    );
  });

  it("caixa não muda o filtro de código", () => {
    assert.equal(
      canon({ salesOrderCode: "pd 02747" }),
      canon({ salesOrderCode: "PD 02747" })
    );
  });

  it("mas código diferente muda o hash", () => {
    assert.notEqual(
      canon({ salesOrderCode: "PD 02747" }),
      canon({ salesOrderCode: "PD 02748" })
    );
  });
});

describe("normalização — ids externos", () => {
  it("número e string numérica convergem", () => {
    assert.equal(
      canon({ customerExternalId: 464 }),
      canon({ customerExternalId: "464" })
    );
  });

  it("zero, negativo e NaN não são id válido", () => {
    const semFiltro = canon({});
    assert.equal(canon({ sellerExternalId: 0 }), semFiltro);
    assert.equal(canon({ sellerExternalId: -1 }), semFiltro);
    assert.equal(canon({ sellerExternalId: Number.NaN }), semFiltro);
  });

  it("id diferente muda o hash", () => {
    assert.notEqual(
      canon({ sellerExternalId: 464 }),
      canon({ sellerExternalId: 465 })
    );
  });
});

describe("normalização — datas", () => {
  it("Date e string ISO do mesmo dia convergem", () => {
    assert.equal(
      canon({ from: new Date("2026-07-10T00:00:00.000Z") }),
      canon({ from: "2026-07-10" })
    );
  });

  it("hora não diferencia — o filtro é por dia", () => {
    assert.equal(
      canon({ from: "2026-07-10T23:59:59.000Z" }),
      canon({ from: "2026-07-10" })
    );
  });

  it("dia diferente muda o hash", () => {
    assert.notEqual(canon({ from: "2026-07-10" }), canon({ from: "2026-07-11" }));
  });

  it("data inválida vira sem filtro em vez de lixo", () => {
    assert.equal(canon({ from: "não é data" }), canon({ from: null }));
    assert.equal(canon({ from: new Date("xx") }), canon({ from: null }));
  });
});

describe("normalização — flags booleanas", () => {
  it("ausente, undefined e false convergem", () => {
    assert.equal(canon({ includePaid: undefined }), canon({ includePaid: false }));
    assert.equal(canon({}), canon({ includePaid: false }));
  });

  it("valor 'truthy' não vira true por acidente", () => {
    assert.equal(canon({ includePaid: 1 }), canon({ includePaid: false }));
    assert.equal(canon({ includePaid: "true" }), canon({ includePaid: false }));
  });

  it("true muda o hash — é decisão financeira relevante", () => {
    assert.notEqual(canon({ includePaid: true }), canon({ includePaid: false }));
  });

  it("as três flags são independentes", () => {
    assert.notEqual(
      canon({ includeReleasedNotPaid: true }),
      canon({ includeConfirmedNotPaid: true })
    );
  });
});

describe("normalização — statuses", () => {
  it("ordem diferente do array não muda o hash", () => {
    assert.equal(
      canon({ statuses: ["paid", "forecast"] }),
      canon({ statuses: ["forecast", "paid"] })
    );
  });

  it("duplicatas não mudam o hash", () => {
    assert.equal(
      canon({ statuses: ["forecast", "forecast"] }),
      canon({ statuses: ["forecast"] })
    );
  });

  it("caixa e espaços são normalizados", () => {
    assert.equal(
      canon({ statuses: [" FORECAST "] }),
      canon({ statuses: ["forecast"] })
    );
  });

  it("valor desconhecido é descartado, não propagado", () => {
    assert.equal(
      canon({ statuses: ["forecast", "inexistente"] }),
      canon({ statuses: ["forecast"] })
    );
  });

  it("conjunto diferente muda o hash", () => {
    assert.notEqual(
      canon({ statuses: ["forecast"] }),
      canon({ statuses: ["forecast", "paid"] })
    );
  });

  it("não-array vira lista vazia", () => {
    assert.equal(canon({ statuses: "forecast" }), canon({ statuses: [] }));
  });

  it("ordem canônica é a do ciclo de vida, não alfabética", () => {
    const n = normalizeCommissionReprocessFilters({
      statuses: ["paid", "confirmed", "forecast", "released"],
    });
    assert.deepEqual(n.statuses, ["forecast", "confirmed", "released", "paid"]);
  });
});

describe("normalização — dateAxis e estabilidade geral", () => {
  it("eixo inválido cai no padrão issue", () => {
    assert.equal(canon({ dateAxis: "qualquer" }), canon({ dateAxis: "issue" }));
    assert.equal(canon({}), canon({ dateAxis: "issue" }));
  });

  it("eixo diferente muda o hash", () => {
    assert.notEqual(canon({ dateAxis: "issue" }), canon({ dateAxis: "settlement" }));
  });

  it("ordem das chaves do objeto de entrada é irrelevante", () => {
    const a = canon({ from: "2026-07-10", includePaid: true, statuses: ["paid"] });
    const b = canon({ statuses: ["paid"], includePaid: true, from: "2026-07-10" });
    assert.equal(a, b);
  });

  it("normalização é idempotente", () => {
    const uma = normalizeCommissionReprocessFilters({ salesOrderCode: " pd 1 " });
    const duas = normalizeCommissionReprocessFilters(uma);
    assert.deepEqual(uma, duas);
  });

  it("filtros ricos e equivalentes, escritos de formas diferentes, convergem", () => {
    const viaUi = canon({
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: "2026-07-31T23:59:59.999Z",
      salesOrderCode: "  pd 02747 ",
      customerExternalId: "464",
      statuses: ["paid", "forecast", "paid"],
      includePaid: true,
      includeReleasedNotPaid: undefined,
      productCode: "",
    });
    const viaApi = canon({
      from: "2026-07-01",
      to: "2026-07-31",
      salesOrderCode: "PD 02747",
      customerExternalId: 464,
      statuses: ["forecast", "paid"],
      includePaid: true,
      includeReleasedNotPaid: false,
      productCode: null,
      dateAxis: "issue",
    });
    assert.equal(viaUi, viaApi);
  });
});
