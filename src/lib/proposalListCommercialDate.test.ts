/**
 * Filtro, ordenação e agrupamento da listagem pela data COMERCIAL.
 *
 * Caso de referência: CP 01350 — `externalOpenedAt` 03/08/2026 e `createdAt`
 * 04/08/2026. Antes, filtro/ordenação/KPI usavam `createdAt`, então ela
 * respondia ao filtro de 04/08 e sumia do de 03/08.
 *
 * A coluna `commercialDate` é GERADA no Postgres. O teste garante que a
 * expressão SQL da migration e a regra do domínio dizem a MESMA coisa — se
 * divergirem, a tela mostra uma data e a ordenação usa outra.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildProposalListCommercialDateWhere,
  buildProposalListOrderBy,
  PROPOSAL_COMMERCIAL_DATE_FIELD,
} from "./proposalListQuery.js";
import { resolveProposalCommercialDate } from "./proposalCommercialDate.js";

const MIGRATION =
  "prisma/migrations/20260804120000_proposal_commercial_date/migration.sql";

describe("proposalListQuery — recorte por data comercial", () => {
  it("usa commercialDate, nunca createdAt", () => {
    const where = buildProposalListCommercialDateWhere(
      new Date(2026, 7, 3),
      new Date(2026, 7, 3, 23, 59, 59)
    );
    assert.ok("commercialDate" in where);
    assert.equal("createdAt" in where, false);
  });

  it("sem datas não filtra nada", () => {
    assert.deepEqual(buildProposalListCommercialDateWhere(null, null), {});
  });

  it("aceita só início ou só fim", () => {
    const onlyStart = buildProposalListCommercialDateWhere(
      new Date(2026, 7, 3),
      null
    );
    assert.deepEqual(Object.keys(onlyStart.commercialDate!), ["gte"]);
    const onlyEnd = buildProposalListCommercialDateWhere(
      null,
      new Date(2026, 7, 3)
    );
    assert.deepEqual(Object.keys(onlyEnd.commercialDate!), ["lte"]);
  });

  it("CP 01350 entra no filtro de 03/08 e fica fora do de 04/08", () => {
    // A proposta é representada pelo valor da coluna gerada: 03/08.
    const cp01350 = new Date(2026, 7, 3);

    const filtro03 = buildProposalListCommercialDateWhere(
      new Date(2026, 7, 3, 0, 0, 0),
      new Date(2026, 7, 3, 23, 59, 59)
    ).commercialDate!;
    assert.ok(cp01350 >= filtro03.gte! && cp01350 <= filtro03.lte!);

    const filtro04 = buildProposalListCommercialDateWhere(
      new Date(2026, 7, 4, 0, 0, 0),
      new Date(2026, 7, 4, 23, 59, 59)
    ).commercialDate!;
    assert.equal(cp01350 >= filtro04.gte!, false);
  });

  it("agosto inteiro continua contendo a CP 01350", () => {
    const range = buildProposalListCommercialDateWhere(
      new Date(2026, 7, 1),
      new Date(2026, 7, 31, 23, 59, 59)
    ).commercialDate!;
    const cp01350 = new Date(2026, 7, 3);
    assert.ok(cp01350 >= range.gte! && cp01350 <= range.lte!);
  });
});

describe("proposalListQuery — ordenação", () => {
  it("ordena por data comercial, não por createdAt", () => {
    const orderBy = buildProposalListOrderBy();
    assert.equal(Object.keys(orderBy[0]!)[0], PROPOSAL_COMMERCIAL_DATE_FIELD);
    assert.equal(
      orderBy.some((o) => "createdAt" in o),
      false
    );
  });

  it("desempata por number — sem isso a paginação duplica ou perde registro", () => {
    const orderBy = buildProposalListOrderBy();
    assert.equal(orderBy.length, 2);
    assert.deepEqual(orderBy[1], { number: "desc" });
  });

  it("é ordenação de banco (não há ordenação em memória a paginar)", () => {
    // O contrato é um array de campos Prisma; se alguém trocar por comparador
    // em memória, este teste quebra e a paginação volta a ser inconsistente.
    for (const clause of buildProposalListOrderBy()) {
      const [field, dir] = Object.entries(clause)[0]!;
      assert.equal(typeof field, "string");
      assert.ok(dir === "asc" || dir === "desc");
    }
  });
});

describe("commercialDate — migration e domínio dizem a mesma coisa", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("a coluna é GERADA e somente leitura", () => {
    assert.match(sql, /GENERATED ALWAYS AS/);
    assert.match(sql, /STORED/);
  });

  it("prioriza externalOpenedAt quando há origem externa", () => {
    assert.match(sql, /"sourceSystem" IS NOT NULL/);
    assert.match(sql, /btrim\("sourceSystem"\) <> ''/);
    assert.match(sql, /THEN "externalOpenedAt"/);
  });

  it("cai em createdAt no ELSE (fallback documentado)", () => {
    assert.match(sql, /ELSE timezone\('America\/Sao_Paulo', "createdAt"\)/);
  });

  it("NÃO usa COALESCE cru entre timestamptz e timestamp", () => {
    // COALESCE(timestamptz, timestamp) exige cast dependente do TimeZone da
    // sessão — não é IMMUTABLE e o Postgres recusaria a coluna gerada.
    assert.equal(/COALESCE\("externalOpenedAt",\s*"createdAt"\)/.test(sql), false);
  });

  it("cria índice que serve a ordenação padrão", () => {
    assert.match(sql, /CREATE INDEX IF NOT EXISTS "Proposal_commercialDate_number_idx"/);
    assert.match(sql, /"commercialDate" DESC, "number" DESC/);
  });

  it("a regra do domínio concorda com a expressão SQL, caso a caso", () => {
    const casos = [
      {
        nome: "Nomus com data de origem → usa a origem",
        row: {
          sourceSystem: "NOMUS",
          externalOpenedAt: new Date(2026, 7, 3),
          createdAt: new Date(2026, 7, 4),
        },
        esperado: new Date(2026, 7, 3),
      },
      {
        nome: "Nomus sem data de origem → cai em createdAt",
        row: {
          sourceSystem: "NOMUS",
          externalOpenedAt: null,
          createdAt: new Date(2026, 7, 4),
        },
        esperado: new Date(2026, 7, 4),
      },
      {
        nome: "interna → createdAt, ignorando externalOpenedAt residual",
        row: {
          sourceSystem: null,
          externalOpenedAt: new Date(2020, 0, 1),
          createdAt: new Date(2026, 7, 4),
        },
        esperado: new Date(2026, 7, 4),
      },
      {
        nome: "sourceSystem só com espaços não conta como externa",
        row: {
          sourceSystem: "   ",
          externalOpenedAt: new Date(2020, 0, 1),
          createdAt: new Date(2026, 7, 4),
        },
        esperado: new Date(2026, 7, 4),
      },
    ];

    for (const caso of casos) {
      const domain = resolveProposalCommercialDate(caso.row);
      assert.equal(
        domain?.getTime(),
        caso.esperado.getTime(),
        `domínio divergiu: ${caso.nome}`
      );
    }
  });
});

describe("propostas internas continuam funcionando", () => {
  it("proposta sem origem externa usa createdAt e é ordenável", () => {
    const interna = {
      sourceSystem: null,
      externalOpenedAt: null,
      createdAt: new Date(2026, 7, 4),
    };
    const d = resolveProposalCommercialDate(interna)!;
    const range = buildProposalListCommercialDateWhere(
      new Date(2026, 7, 4, 0, 0, 0),
      new Date(2026, 7, 4, 23, 59, 59)
    ).commercialDate!;
    assert.ok(d >= range.gte! && d <= range.lte!);
  });
});
