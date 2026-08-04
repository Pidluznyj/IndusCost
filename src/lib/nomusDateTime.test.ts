/**
 * Parser de data do Nomus — o defeito original e as bordas.
 *
 * Caso de referência: CP 01350, aberta no Nomus em 03/08/2026, gravada no
 * IndusCost como 2026-03-08 porque `new Date("03/08/2026")` aplica o formato
 * americano MM/DD.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nomusDateTimeToCivilKey,
  parseNomusBrazilianDateTime,
  parseNomusBrazilianDateTimeOrNull,
} from "./nomusDateTime.js";

function civil(input: string): string | null {
  const r = parseNomusBrazilianDateTime(input);
  return r.ok ? nomusDateTimeToCivilKey(r.value) : null;
}

describe("nomusDateTime — formato brasileiro DD/MM", () => {
  it("CP 01350: 03/08/2026 é 3 de AGOSTO, não 8 de março", () => {
    assert.equal(civil("03/08/2026 00:00:00"), "2026-08-03");
  });

  it("12/08/2026 não vira 08/12/2026", () => {
    assert.equal(civil("12/08/2026 00:00:00"), "2026-08-12");
    assert.notEqual(civil("12/08/2026 00:00:00"), "2026-12-08");
  });

  it("dia > 12 não seria sequer parseável como mês americano", () => {
    assert.equal(civil("31/08/2026 00:00:00"), "2026-08-31");
  });

  it("aceita hora sem segundos e sem hora nenhuma", () => {
    assert.equal(civil("03/08/2026 14:30"), "2026-08-03");
    assert.equal(civil("03/08/2026"), "2026-08-03");
  });

  it("aceita dia e mês com um dígito", () => {
    assert.equal(civil("3/8/2026"), "2026-08-03");
  });
});

describe("nomusDateTime — a hora não desloca o dia civil", () => {
  it("meia-noite permanece no mesmo dia (sem shift por UTC)", () => {
    const r = parseNomusBrazilianDateTime("03/08/2026 00:00:00");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    // Componentes locais: em UTC-3 a montagem por Date.UTC exibiria 02/08.
    assert.equal(r.value.getFullYear(), 2026);
    assert.equal(r.value.getMonth(), 7); // agosto = 7
    assert.equal(r.value.getDate(), 3);
  });

  it("23:59:59 continua no mesmo dia civil", () => {
    assert.equal(civil("03/08/2026 23:59:59"), "2026-08-03");
  });

  it("preserva hora, minuto e segundo", () => {
    const r = parseNomusBrazilianDateTime("03/08/2026 14:25:36");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.getHours(), 14);
    assert.equal(r.value.getMinutes(), 25);
    assert.equal(r.value.getSeconds(), 36);
  });
});

describe("nomusDateTime — validação com diagnóstico", () => {
  it("31/02/2026 é inválido e diz por quê", () => {
    const r = parseNomusBrazilianDateTime("31/02/2026 00:00:00");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.reason, /dia inválido/i);
    assert.match(r.reason, /28/);
  });

  it("29/02 é válido em ano bissexto e inválido fora dele", () => {
    assert.equal(civil("29/02/2028 00:00:00"), "2028-02-29");
    assert.equal(parseNomusBrazilianDateTime("29/02/2026").ok, false);
  });

  it("mês 13 é rejeitado", () => {
    const r = parseNomusBrazilianDateTime("01/13/2026");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.reason, /mês inválido/i);
  });

  it("hora, minuto e segundo fora de faixa são rejeitados", () => {
    assert.equal(parseNomusBrazilianDateTime("03/08/2026 24:00:00").ok, false);
    assert.equal(parseNomusBrazilianDateTime("03/08/2026 10:60:00").ok, false);
    assert.equal(parseNomusBrazilianDateTime("03/08/2026 10:00:60").ok, false);
  });

  it("ano implausível é rejeitado", () => {
    assert.equal(parseNomusBrazilianDateTime("03/08/1800").ok, false);
  });

  it("formato estranho é rejeitado com o texto original no motivo", () => {
    const r = parseNomusBrazilianDateTime("2026-08-03");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.reason, /fora do formato/i);
  });

  it("vazio, nulo e tipos errados são rejeitados sem lançar", () => {
    assert.equal(parseNomusBrazilianDateTime("").ok, false);
    assert.equal(parseNomusBrazilianDateTime(null).ok, false);
    assert.equal(parseNomusBrazilianDateTime(undefined).ok, false);
    assert.equal(parseNomusBrazilianDateTime(42).ok, false);
  });

  it("Date válido passa direto; Date inválido é recusado", () => {
    const d = new Date(2026, 7, 3);
    const r = parseNomusBrazilianDateTime(d);
    assert.equal(r.ok, true);
    assert.equal(parseNomusBrazilianDateTime(new Date("xx")).ok, false);
  });

  it("a variante OrNull devolve null em vez de Result", () => {
    assert.equal(parseNomusBrazilianDateTimeOrNull("31/02/2026"), null);
    assert.ok(parseNomusBrazilianDateTimeOrNull("03/08/2026") instanceof Date);
  });
});

describe("nomusDateTime — NÃO usa o parser implícito do JavaScript", () => {
  it("difere de new Date() justamente no caso do defeito", () => {
    // Prova viva: o parser implícito lê MM/DD e devolve março.
    const implicito = new Date("03/08/2026 00:00:00");
    assert.equal(implicito.getMonth(), 2, "sanidade: JS lê 03 como março");

    const r = parseNomusBrazilianDateTime("03/08/2026 00:00:00");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.getMonth(), 7, "nosso parser lê 08 como agosto");
    assert.notEqual(r.value.getTime(), implicito.getTime());
  });
});
