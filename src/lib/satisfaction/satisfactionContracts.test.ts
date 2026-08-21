/**
 * Contratos do domínio de Satisfação.
 *
 * Cobre a imutabilidade semântica do V1, a máquina de estados da campanha, o
 * status derivado do convite (fonte única) e a validação de respostas —
 * incluindo a regra de que pergunta não respondida não vira linha.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCampaignTransition,
  canDeleteCampaign,
  canTransitionCampaign,
  getRatingLabel,
  isCampaignAcceptingResponses,
  isCampaignSemanticallyLocked,
  isValidRating,
  normalizeCompanyNameKey,
  normalizeTaxIdDigits,
  normalizeText,
  parseCampaignCreateInput,
  parseCampaignUpdateInput,
  parseSubmitInput,
  resolveCampaignUnavailableReason,
  resolveInvitationStatus,
  SATISFACTION_INPUT_LIMITS,
  SATISFACTION_RATING_LABELS,
  SATISFACTION_V1_RATING_CODES,
  SatisfactionContractError,
  slugifyCampaignCode,
  validateAnswers,
  type SatisfactionQuestionSpec,
} from "./satisfactionContracts.js";

const RATING_Q = (code: string, order: number, required = true): SatisfactionQuestionSpec => ({
  id: `id-${code}`,
  code,
  label: code,
  type: "RATING",
  sortOrder: order,
  required,
  scaleMin: 1,
  scaleMax: 5,
});

describe("questionário histórico V1", () => {
  it("preserva a escala 1..5 com os rótulos históricos", () => {
    assert.deepEqual(SATISFACTION_RATING_LABELS, {
      1: "Ruim",
      2: "Regular",
      3: "Bom",
      4: "Ótimo",
      5: "Excelente",
    });
    assert.equal(getRatingLabel(4), "Ótimo");
  });

  it("mantém exatamente os seis critérios avaliativos, na ordem histórica", () => {
    assert.deepEqual(SATISFACTION_V1_RATING_CODES, [
      "COMMERCIAL_SERVICE",
      "QUOTE_ORDER_RESPONSE_TIME",
      "DELIVERY_DEADLINE",
      "ORDER_CONFORMITY",
      "PRODUCT_QUALITY",
      "TECHNICAL_SUPPORT",
    ]);
    assert.equal(SATISFACTION_V1_RATING_CODES.length, 6);
  });

  it('não introduz o artefato "Choose / Opção 1" do Google Forms', () => {
    const codes = SATISFACTION_V1_RATING_CODES.map(String);
    assert.equal(
      codes.some((c) => /choose|opcao|opção/i.test(c)),
      false
    );
  });
});

describe("normalizadores", () => {
  it("normalizeText corta no limite e devolve null para vazio", () => {
    assert.equal(normalizeText("  ok  ", 10), "ok");
    assert.equal(normalizeText("", 10), null);
    assert.equal(normalizeText("abcdefghijk", 5), "abcde");
    assert.equal(normalizeText(42, 5), null);
  });

  it("normalizeTaxIdDigits ignora máscara", () => {
    assert.equal(normalizeTaxIdDigits("12.345.678/0001-90"), "12345678000190");
    assert.equal(normalizeTaxIdDigits("sem digito"), null);
  });

  it("normalizeCompanyNameKey casa grafias diferentes da mesma empresa", () => {
    const a = normalizeCompanyNameKey("Metalúrgica Silva LTDA");
    const b = normalizeCompanyNameKey("metalurgica  silva ltda.");
    assert.equal(a, b);
  });
});

describe("máquina de estados da campanha", () => {
  it("permite apenas o fluxo oficial", () => {
    assert.equal(canTransitionCampaign("DRAFT", "OPEN"), true);
    assert.equal(canTransitionCampaign("DRAFT", "SCHEDULED"), true);
    assert.equal(canTransitionCampaign("SCHEDULED", "OPEN"), true);
    assert.equal(canTransitionCampaign("OPEN", "CLOSED"), true);
    assert.equal(canTransitionCampaign("CLOSED", "ARCHIVED"), true);
  });

  it("bloqueia retrocesso e saltos", () => {
    assert.equal(canTransitionCampaign("OPEN", "DRAFT"), false);
    assert.equal(canTransitionCampaign("CLOSED", "OPEN"), false);
    assert.equal(canTransitionCampaign("ARCHIVED", "OPEN"), false);
    assert.equal(canTransitionCampaign("DRAFT", "ARCHIVED"), false);
  });

  it("assertCampaignTransition lança erro de contrato", () => {
    assert.throws(
      () => assertCampaignTransition("CLOSED", "OPEN"),
      (err: unknown) =>
        err instanceof SatisfactionContractError && err.code === "INVALID_TRANSITION"
    );
  });

  it("campanha publicada fica semanticamente congelada", () => {
    assert.equal(isCampaignSemanticallyLocked("DRAFT", null), false);
    assert.equal(isCampaignSemanticallyLocked("DRAFT", new Date()), true);
    assert.equal(isCampaignSemanticallyLocked("OPEN", null), true);
  });

  it("só DRAFT nunca publicado e sem dependências pode ser excluído", () => {
    const base = { status: "DRAFT" as const, publishedAt: null, invitationCount: 0, responseCount: 0 };
    assert.equal(canDeleteCampaign(base), true);
    assert.equal(canDeleteCampaign({ ...base, invitationCount: 1 }), false);
    assert.equal(canDeleteCampaign({ ...base, responseCount: 1 }), false);
    assert.equal(canDeleteCampaign({ ...base, publishedAt: new Date() }), false);
    assert.equal(canDeleteCampaign({ ...base, status: "CLOSED" }), false);
  });
});

describe("janela de resposta", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("aceita resposta apenas com status OPEN dentro da janela", () => {
    assert.equal(
      isCampaignAcceptingResponses({ status: "OPEN", opensAt: null, closesAt: null }, now),
      true
    );
    assert.equal(
      isCampaignAcceptingResponses({ status: "DRAFT", opensAt: null, closesAt: null }, now),
      false
    );
  });

  it("respeita abertura futura e encerramento passado", () => {
    assert.equal(
      isCampaignAcceptingResponses(
        { status: "OPEN", opensAt: new Date("2026-07-01T00:00:00Z"), closesAt: null },
        now
      ),
      false
    );
    assert.equal(
      isCampaignAcceptingResponses(
        { status: "OPEN", opensAt: null, closesAt: new Date("2026-06-01T00:00:00Z") },
        now
      ),
      false
    );
  });

  it("motivo de indisponibilidade é específico para a mensagem do cliente", () => {
    assert.equal(
      resolveCampaignUnavailableReason({ status: "SCHEDULED", opensAt: null, closesAt: null }, now),
      "NOT_STARTED"
    );
    assert.equal(
      resolveCampaignUnavailableReason({ status: "CLOSED", opensAt: null, closesAt: null }, now),
      "CLOSED"
    );
    assert.equal(
      resolveCampaignUnavailableReason({ status: "OPEN", opensAt: null, closesAt: null }, now),
      null
    );
  });
});

describe("status derivado do convite (fonte única)", () => {
  const d = new Date();

  it("precedência: revogado > concluído > iniciado > aberto > não aberto", () => {
    assert.equal(
      resolveInvitationStatus({ revokedAt: d, completedAt: d, startedAt: d, firstOpenedAt: d }),
      "REVOKED"
    );
    assert.equal(
      resolveInvitationStatus({ revokedAt: null, completedAt: d, startedAt: d, firstOpenedAt: d }),
      "COMPLETED"
    );
    assert.equal(
      resolveInvitationStatus({ revokedAt: null, completedAt: null, startedAt: d, firstOpenedAt: d }),
      "STARTED"
    );
    assert.equal(
      resolveInvitationStatus({ revokedAt: null, completedAt: null, startedAt: null, firstOpenedAt: d }),
      "OPENED"
    );
    assert.equal(
      resolveInvitationStatus({ revokedAt: null, completedAt: null, startedAt: null, firstOpenedAt: null }),
      "NOT_OPENED"
    );
  });
});

describe("validação de respostas", () => {
  const questions = [
    RATING_Q("PRODUCT_QUALITY", 1),
    RATING_Q("DELIVERY_DEADLINE", 2),
    {
      id: "id-OPEN_FEEDBACK",
      code: "OPEN_FEEDBACK",
      label: "Comentário",
      type: "TEXT" as const,
      sortOrder: 3,
      required: true,
      scaleMin: null,
      scaleMax: null,
    },
    {
      id: "id-TAX_ID",
      code: "TAX_ID",
      label: "CNPJ",
      type: "TAX_ID" as const,
      sortOrder: 4,
      required: false,
      scaleMin: null,
      scaleMax: null,
    },
  ];

  const complete = [
    { questionCode: "PRODUCT_QUALITY", ratingValue: 5 },
    { questionCode: "DELIVERY_DEADLINE", ratingValue: 3 },
    { questionCode: "OPEN_FEEDBACK", textValue: "tudo certo" },
  ];

  it("aceita submissão completa e devolve as respostas em ordem de pergunta", () => {
    const result = validateAnswers(questions, complete, { enforceRequired: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.answers.map((a) => a.questionCode),
      ["PRODUCT_QUALITY", "DELIVERY_DEADLINE", "OPEN_FEEDBACK"]
    );
  });

  it("ELIMINATÓRIO: pergunta não respondida NÃO vira linha (ausência, nunca zero)", () => {
    const result = validateAnswers(questions, complete, { enforceRequired: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.answers.some((a) => a.questionCode === "TAX_ID"),
      false,
      "opcional sem resposta não pode gerar linha"
    );
    for (const answer of result.answers) {
      assert.notEqual(answer.ratingValue, 0, "nenhuma nota pode ser 0");
    }
  });

  it("exige obrigatórias no submit", () => {
    const result = validateAnswers(questions, [{ questionCode: "PRODUCT_QUALITY", ratingValue: 4 }], {
      enforceRequired: true,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const missing = result.issues.filter((i) => i.code === "REQUIRED_MISSING").map((i) => i.questionCode);
    assert.deepEqual(missing.sort(), ["DELIVERY_DEADLINE", "OPEN_FEEDBACK"]);
  });

  it("NÃO exige obrigatórias no rascunho — autosave aceita parcial", () => {
    const result = validateAnswers(questions, [{ questionCode: "PRODUCT_QUALITY", ratingValue: 4 }], {
      enforceRequired: false,
    });
    assert.equal(result.ok, true);
  });

  it("rejeita nota fora da escala, inclusive 0 e 6", () => {
    for (const bad of [0, 6, -1, 2.5]) {
      const result = validateAnswers(questions, [{ questionCode: "PRODUCT_QUALITY", ratingValue: bad }], {
        enforceRequired: false,
      });
      assert.equal(result.ok, false, `nota ${bad} deveria ser rejeitada`);
      if (result.ok) continue;
      assert.equal(result.issues[0]?.code, "INVALID_RATING");
    }
  });

  it("rejeita pergunta que não pertence à campanha", () => {
    const result = validateAnswers(questions, [{ questionCode: "NAO_EXISTE", ratingValue: 5 }], {
      enforceRequired: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues[0]?.code, "UNKNOWN_QUESTION");
  });

  it("payload duplicado gera uma única linha (última vence)", () => {
    const result = validateAnswers(
      questions,
      [
        ...complete,
        { questionCode: "PRODUCT_QUALITY", ratingValue: 2 },
      ],
      { enforceRequired: true }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const quality = result.answers.filter((a) => a.questionCode === "PRODUCT_QUALITY");
    assert.equal(quality.length, 1);
    assert.equal(quality[0]?.ratingValue, 2);
  });

  it("comentário respeita o limite de tamanho do servidor", () => {
    const huge = "x".repeat(SATISFACTION_INPUT_LIMITS.openFeedback + 500);
    const result = validateAnswers(
      questions,
      [
        { questionCode: "PRODUCT_QUALITY", ratingValue: 5 },
        { questionCode: "DELIVERY_DEADLINE", ratingValue: 5 },
        { questionCode: "OPEN_FEEDBACK", textValue: huge },
      ],
      { enforceRequired: true }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const feedback = result.answers.find((a) => a.questionCode === "OPEN_FEEDBACK");
    assert.equal(feedback?.textValue?.length, SATISFACTION_INPUT_LIMITS.openFeedback);
  });
});

describe("parsers administrativos", () => {
  const base = {
    name: "Satisfação 2026",
    referenceStart: "2026-01-01T00:00:00Z",
    referenceEnd: "2026-12-31T00:00:00Z",
  };

  it("cria campanha com código derivado do nome", () => {
    const parsed = parseCampaignCreateInput(base);
    assert.equal(parsed.name, "Satisfação 2026");
    assert.equal(parsed.code, "SATISFACAO_2026");
    assert.equal(parsed.allowGeneralLink, false);
  });

  it("não duplica o ano quando o nome já o contém", () => {
    assert.equal(slugifyCampaignCode("Satisfação 2026", new Date("2026-01-01T00:00:00Z")), "SATISFACAO_2026");
    assert.equal(slugifyCampaignCode("Anual", new Date("2026-01-01T00:00:00Z")), "ANUAL_2026");
  });

  it("exige nome e datas válidas", () => {
    assert.throws(() => parseCampaignCreateInput({ ...base, name: "  " }), SatisfactionContractError);
    assert.throws(
      () => parseCampaignCreateInput({ ...base, referenceStart: "data-ruim" }),
      SatisfactionContractError
    );
  });

  it("rejeita período invertido", () => {
    assert.throws(
      () =>
        parseCampaignCreateInput({
          ...base,
          referenceStart: "2026-12-31T00:00:00Z",
          referenceEnd: "2026-01-01T00:00:00Z",
        }),
      (err: unknown) => err instanceof SatisfactionContractError && err.code === "INVALID_RANGE"
    );
  });

  it("update parcial só toca o que veio", () => {
    const parsed = parseCampaignUpdateInput({ name: "Novo nome" });
    assert.deepEqual(Object.keys(parsed), ["name"]);
  });
});

describe("parser da submissão pública", () => {
  it("normaliza e limita todos os campos livres", () => {
    const parsed = parseSubmitInput({
      answers: [{ questionCode: "PRODUCT_QUALITY", ratingValue: 5 }],
      respondentName: "  Maria  ",
      respondentPhone: "(11) 99999-0000",
      declaredCompanyName: "x".repeat(500),
      idempotencyKey: "chave-1",
      turnstileToken: "tk",
    });
    assert.equal(parsed.respondentName, "Maria");
    assert.equal(parsed.declaredCompanyName?.length, SATISFACTION_INPUT_LIMITS.companyName);
    assert.equal(parsed.answers.length, 1);
    assert.equal(parsed.idempotencyKey, "chave-1");
  });

  it("payload hostil não quebra o parser", () => {
    const parsed = parseSubmitInput({ answers: "nao-e-array", respondentName: { a: 1 } });
    assert.deepEqual(parsed.answers, []);
    assert.equal(parsed.respondentName, null);
  });

  it("descarta item de resposta sem questionCode", () => {
    const parsed = parseSubmitInput({ answers: [{ ratingValue: 5 }, { questionCode: "OK", ratingValue: 4 }] });
    assert.equal(parsed.answers.length, 1);
    assert.equal(parsed.answers[0]?.questionCode, "OK");
  });
});

describe("isValidRating", () => {
  it("aceita só inteiros de 1 a 5", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 0, 6, -1, 1.5, "3", null, undefined, NaN].map((v) => isValidRating(v)),
      [true, true, true, true, true, false, false, false, false, false, false, false, false]
    );
  });
});
