/**
 * CARACTERIZAÇÃO — IDs de NFe que alimentam a consulta de AR do pedido.
 *
 * `referencia()` é transcrição literal do trecho de `loadOrderFullAuditUncached`
 * que monta o `nfeMap` (etapa das relacionadas + laço sequencial dos facts),
 * seguida de `[...nfeMap.keys()].filter(id => id > 0)`. Ela guarda entradas com
 * a mesma forma que o audit guarda, incluindo campos que não participam da
 * escolha de chave, para que o fluxo de controle fique idêntico.
 *
 * Além do OLD × NEW, os casos decisivos têm expectativa escrita à mão — senão
 * uma transcrição errada nos dois lados passaria despercebida.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectOrderReceivableNfeIds,
  type ReceivableNfeFactInput,
  type ReceivableNfeRelatedInput,
} from "@/src/lib/finance/orderAuditReceivableNfeIds.js";

type Entrada = {
  relatedNfes: ReceivableNfeRelatedInput[];
  facts: ReceivableNfeFactInput[];
};

/** Transcrição literal do algoritmo do audit. */
function referencia(input: Entrada): number[] {
  type LegacyEntry = {
    nfeExternalId: number;
    numero: string | null;
    // campos que o audit carrega mas que não decidem chave:
    chave: string | null;
    status: number | null;
  };
  const nfeMap = new Map<number, LegacyEntry>();

  for (const related of input.relatedNfes) {
    if (related.nfeExternalId <= 0) continue;
    if (nfeMap.has(related.nfeExternalId)) continue;
    nfeMap.set(related.nfeExternalId, {
      nfeExternalId: related.nfeExternalId,
      numero: related.numero,
      chave: null,
      status: null,
    });
  }

  const relatedByNumber = new Map<string, number>();
  for (const related of input.relatedNfes) {
    const num = related.numero?.trim();
    if (num && !relatedByNumber.has(num)) {
      relatedByNumber.set(num, related.nfeExternalId);
    }
  }

  for (let factIndex = 0; factIndex < input.facts.length; factIndex++) {
    const fact = input.facts[factIndex]!;
    const nfeNumber = fact.nfeNumber?.trim();
    const evidenceNfeId =
      fact.nfeExternalId != null && fact.nfeExternalId > 0
        ? fact.nfeExternalId
        : fact.stockDocumentIdNfe != null && fact.stockDocumentIdNfe > 0
          ? fact.stockDocumentIdNfe
          : null;
    if (!nfeNumber && fact.nfeHeaderValue == null && evidenceNfeId == null) {
      continue;
    }

    let nfeEntry: LegacyEntry | undefined =
      evidenceNfeId != null ? nfeMap.get(evidenceNfeId) : undefined;

    if (!nfeEntry && nfeNumber) {
      const knownId = relatedByNumber.get(nfeNumber);
      if (knownId != null) nfeEntry = nfeMap.get(knownId);
      if (!nfeEntry) {
        for (const v of nfeMap.values()) {
          if (v.numero?.trim() === nfeNumber) {
            nfeEntry = v;
            break;
          }
        }
      }
    }

    if (!nfeEntry && evidenceNfeId != null) {
      nfeEntry = {
        nfeExternalId: evidenceNfeId,
        numero: nfeNumber ?? null,
        chave: null,
        status: null,
      };
      nfeMap.set(evidenceNfeId, nfeEntry);
    }

    if (!nfeEntry && nfeNumber) {
      const surrogate = -(nfeMap.size + 1);
      nfeEntry = {
        nfeExternalId: surrogate,
        numero: nfeNumber,
        chave: null,
        status: null,
      };
      nfeMap.set(surrogate, nfeEntry);
    }
  }

  return [...nfeMap.keys()].filter((id) => id > 0);
}

function rel(nfeExternalId: number, numero: string | null = null) {
  return { nfeExternalId, numero };
}

function f(over: Partial<ReceivableNfeFactInput> = {}): ReceivableNfeFactInput {
  return {
    nfeNumber: null,
    nfeHeaderValue: null,
    nfeExternalId: null,
    stockDocumentIdNfe: null,
    ...over,
  };
}

const CASOS: Array<{ nome: string; entrada: Entrada; esperado?: number[] }> = [
  { nome: "1. vazio", entrada: { relatedNfes: [], facts: [] }, esperado: [] },
  {
    nome: "2. somente relacionadas",
    entrada: { relatedNfes: [rel(100, "555"), rel(101, "556")], facts: [] },
    esperado: [100, 101],
  },
  {
    nome: "3. somente fact com nfeExternalId",
    entrada: { relatedNfes: [], facts: [f({ nfeExternalId: 200 })] },
    esperado: [200],
  },
  {
    nome: "4. FALLBACK: fact sem nfeExternalId, com stockDocumentIdNfe",
    entrada: { relatedNfes: [], facts: [f({ stockDocumentIdNfe: 300 })] },
    esperado: [300],
  },
  {
    nome: "5. somente fact com número → surrogate, nada positivo",
    entrada: { relatedNfes: [], facts: [f({ nfeNumber: "777" })] },
    esperado: [],
  },
  {
    nome: "6. relacionada + fact com o MESMO id",
    entrada: {
      relatedNfes: [rel(100, "555")],
      facts: [f({ nfeExternalId: 100, nfeNumber: "555" })],
    },
    esperado: [100],
  },
  {
    nome: "7. CRÍTICO: fact de id diferente casa por número → id NÃO entra",
    entrada: {
      relatedNfes: [rel(100, "555")],
      facts: [f({ nfeExternalId: 200, nfeNumber: "555" })],
    },
    esperado: [100],
  },
  {
    nome: "8. duplicatas de relacionadas",
    entrada: {
      relatedNfes: [rel(100, "555"), rel(100, "555"), rel(101, "556")],
      facts: [],
    },
    esperado: [100, 101],
  },
  {
    nome: "9. múltiplas relacionadas + múltiplos facts novos",
    entrada: {
      relatedNfes: [rel(100, "555"), rel(101, "556")],
      facts: [f({ nfeExternalId: 200 }), f({ nfeExternalId: 201 })],
    },
    esperado: [100, 101, 200, 201],
  },
  {
    nome: "10. fact sem número, sem header e sem id é ignorado",
    entrada: { relatedNfes: [rel(100)], facts: [f()] },
    esperado: [100],
  },
  {
    nome: "11. ids zero/negativos não viram chave",
    entrada: {
      relatedNfes: [rel(0, "555"), rel(-5, "556"), rel(102, "557")],
      facts: [f({ nfeExternalId: 0, stockDocumentIdNfe: 0, nfeHeaderValue: 10 })],
    },
    esperado: [102],
  },
  {
    nome: "12. N:N — mesma NFe relacionada e citada em facts",
    entrada: {
      relatedNfes: [rel(100, "555")],
      facts: [
        f({ nfeExternalId: 100, nfeNumber: "555" }),
        f({ nfeExternalId: 100, nfeNumber: "555" }),
      ],
    },
    esperado: [100],
  },
  {
    nome: "13. positivos + surrogate convivendo",
    entrada: {
      relatedNfes: [rel(100, "555")],
      facts: [f({ nfeNumber: "888" }), f({ nfeExternalId: 201 })],
    },
    esperado: [100, 201],
  },
  {
    nome: "14. SURROGATE REUTILIZADO: fact posterior casa por número",
    entrada: {
      relatedNfes: [],
      facts: [
        f({ nfeNumber: "888" }), // cria surrogate -1
        f({ nfeNumber: "888", nfeExternalId: 400 }), // casa com o surrogate
      ],
    },
    esperado: [], // 400 NÃO entra
  },
  {
    nome: "15. dois facts, mesmo número, ids diferentes",
    entrada: {
      relatedNfes: [],
      facts: [
        f({ nfeExternalId: 500, nfeNumber: "999" }),
        f({ nfeExternalId: 501, nfeNumber: "999" }),
      ],
    },
    esperado: [500], // o segundo casa por número com o primeiro
  },
  {
    nome: "16. mesmo número, segundo fact sem id",
    entrada: {
      relatedNfes: [],
      facts: [f({ nfeExternalId: 500, nfeNumber: "999" }), f({ nfeNumber: "999" })],
    },
    esperado: [500],
  },
  {
    nome: "17. nfeExternalId tem precedência sobre stockDocumentIdNfe",
    entrada: {
      relatedNfes: [],
      facts: [f({ nfeExternalId: 600, stockDocumentIdNfe: 700 })],
    },
    esperado: [600],
  },
  {
    nome: "18. ordem final segue a inserção, não a numérica",
    entrada: {
      relatedNfes: [rel(900, "A"), rel(100, "B")],
      facts: [f({ nfeExternalId: 500 }), f({ nfeExternalId: 300 })],
    },
    esperado: [900, 100, 500, 300],
  },
  {
    nome: "19. header sem número e sem id não cria chave",
    entrada: { relatedNfes: [rel(100)], facts: [f({ nfeHeaderValue: 1234 })] },
    esperado: [100],
  },
  {
    nome: "20. número com espaços casa com relacionada",
    entrada: {
      relatedNfes: [rel(100, "  555  ")],
      facts: [f({ nfeExternalId: 200, nfeNumber: "555" })],
    },
    esperado: [100],
  },
];

describe("CARACTERIZAÇÃO — IDs de NFe para a consulta de AR", () => {
  for (const caso of CASOS) {
    it(caso.nome, () => {
      const old = referencia(caso.entrada);
      const neo = collectOrderReceivableNfeIds(caso.entrada);
      assert.deepEqual(neo, old, "extraída difere da transcrição do audit");
      if (caso.esperado) {
        assert.deepEqual(
          neo,
          caso.esperado,
          "resultado difere da expectativa escrita à mão"
        );
      }
    });
  }

  it("RISCO FINANCEIRO: a união ingênua traria um CR que o audit não vê", () => {
    // related Y=100 com número N; fact X=200 com o mesmo número N.
    // Existe um CR com sourceInvoiceId = 200.
    const entrada: Entrada = {
      relatedNfes: [rel(100, "555")],
      facts: [f({ nfeExternalId: 200, nfeNumber: "555" })],
    };

    const correto = collectOrderReceivableNfeIds(entrada);
    assert.deepEqual(correto, [100], "só a relacionada entra");

    // A fórmula antiga (união de conjuntos) traria 200 junto.
    const uniaoIngenua = [
      ...new Set([
        ...entrada.relatedNfes.map((r) => r.nfeExternalId),
        ...entrada.facts
          .map((x) => x.nfeExternalId)
          .filter((id): id is number => id != null && id > 0),
      ]),
    ];
    assert.deepEqual(uniaoIngenua, [100, 200]);

    // Um CR pendurado na NFe 200 seria puxado pela união e NÃO pelo audit.
    const crs = [
      { sourceInvoiceId: 100, amountReceivable: 400 },
      { sourceInvoiceId: 200, amountReceivable: 600 },
    ];
    const cobertosCorreto = crs.filter((cr) =>
      correto.includes(cr.sourceInvoiceId)
    );
    const cobertosUniao = crs.filter((cr) =>
      uniaoIngenua.includes(cr.sourceInvoiceId)
    );
    assert.equal(
      cobertosCorreto.reduce((s, c) => s + c.amountReceivable, 0),
      400
    );
    assert.equal(
      cobertosUniao.reduce((s, c) => s + c.amountReceivable, 0),
      1000,
      "a união inflaria a cobertura em 600 — é este o erro que a função evita"
    );
  });
});
