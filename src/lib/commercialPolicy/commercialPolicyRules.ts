/**
 * Regras puras da Política Comercial obrigatória (SELLER).
 * Sem Prisma e sem texto oficial: o conteúdo vem da versão publicada.
 */
import { createHash } from "node:crypto";

export const COMMERCIAL_POLICY_TYPE = "COMMERCIAL_POLICY";
export const COMMERCIAL_POLICY_AUDIENCE = "SELLER";
export const POLICY_ACCEPTANCE_REQUIRED_CODE = "POLICY_ACCEPTANCE_REQUIRED";
export const COMMERCIAL_POLICY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const COMMERCIAL_POLICY_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const COMMERCIAL_POLICY_PHOTO_REQUIRED = true;

export type CommercialPolicyStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export type PolicyQuestionOption = { id: string; text: string };

export type PolicyQuestion = {
  id: string;
  prompt: string;
  options: PolicyQuestionOption[];
  correctOptionId: string;
  explanation: string;
  reviewChapterId?: string;
};

export type PolicyVersionBody = {
  title: string;
  content: string;
  summaryRules: string[];
  declarations: string[];
  questions: PolicyQuestion[];
};

export type PublicPolicyQuestion = {
  id: string;
  prompt: string;
  options: PolicyQuestionOption[];
  reviewChapterId?: string;
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPolicyContent(body: PolicyVersionBody): string {
  return sha256Hex(
    stableStringify({
      title: body.title,
      content: body.content,
      summaryRules: body.summaryRules,
      declarations: body.declarations,
      questions: body.questions,
    })
  );
}

export function toPublicQuestions(questions: PolicyQuestion[]): PublicPolicyQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    options: question.options.map((option) => ({ id: option.id, text: option.text })),
    ...(question.reviewChapterId ? { reviewChapterId: question.reviewChapterId } : {}),
  }));
}

export function validatePolicyDraft(body: PolicyVersionBody): string | null {
  if (!body.title.trim()) return "Informe o título da versão.";
  if (body.content.trim().length < 40) return "Cole o texto oficial da política antes de publicar.";
  if (body.summaryRules.length < 1 || body.summaryRules.some((rule) => !rule.trim())) {
    return "Informe ao menos uma regra principal.";
  }
  if (body.declarations.length < 1 || body.declarations.some((line) => !line.trim())) {
    return "Informe as declarações que o vendedor precisará aceitar.";
  }
  if (new Set(body.declarations).size !== body.declarations.length) {
    return "As declarações não podem se repetir.";
  }
  if (body.questions.length < 1) return "A versão precisa de ao menos uma pergunta.";
  const ids = new Set<string>();
  for (const question of body.questions) {
    if (!question.id.trim() || !question.prompt.trim()) return "Toda pergunta precisa de enunciado.";
    if (ids.has(question.id)) return "As perguntas não podem repetir o identificador.";
    ids.add(question.id);
    if (question.options.length < 2) return "Toda pergunta precisa de ao menos duas opções.";
    if (!question.options.some((option) => option.id === question.correctOptionId)) {
      return "A resposta correta precisa ser uma das opções.";
    }
    if (question.options.some((option) => !option.text.trim())) return "Toda opção precisa de texto.";
  }
  return null;
}

export type SubmittedAnswer = { questionId: string; optionId: string };

export function scoreQuestionnaire(
  questions: PolicyQuestion[],
  answers: SubmittedAnswer[]
): { passed: boolean; results: Array<{ questionId: string; correct: boolean; explanation: string }> } {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer.optionId]));
  const results = questions.map((question) => {
    const selected = byId.get(question.id) ?? "";
    return {
      questionId: question.id,
      correct: selected === question.correctOptionId,
      explanation: question.explanation,
    };
  });
  const answeredAll = questions.every((question) => byId.has(question.id));
  return { passed: answeredAll && results.every((result) => result.correct), results };
}

export function declarationsMatch(expected: string[], submitted: string[]): boolean {
  if (expected.length !== submitted.length) return false;
  return expected.every((line, index) => line === submitted[index]);
}

export type EvidencePayloadInput = {
  policyVersionId: string;
  policyVersion: number;
  policyHash: string;
  userId: string;
  userNameSnapshot: string;
  userEmailSnapshot: string;
  role: string;
  sellerExternalId: number | null;
  acceptedAtServer: string;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string;
  reauthChallengeId: string;
  photoHash: string;
  photoStorageReference: string;
  questionnaireAttemptId: string;
  answers: SubmittedAnswer[];
  declarationsAccepted: string[];
  normativeSnapshotHash?: string;
  changeSetHash?: string;
  previousPolicyVersionId?: string | null;
  appCommit: string | null;
};

export function buildEvidenceHash(input: EvidencePayloadInput): { hash: string; payload: EvidencePayloadInput } {
  const payload = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as EvidencePayloadInput;
  return { hash: sha256Hex(stableStringify(payload)), payload };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function inspectPolicyPhoto(input: {
  mimeType: string;
  bytes: Buffer;
}): { ok: true; mimeType: "image/jpeg" | "image/png" } | { ok: false; message: string } {
  if (input.bytes.byteLength < 16) return { ok: false, message: "A imagem está vazia." };
  if (input.bytes.byteLength > COMMERCIAL_POLICY_PHOTO_MAX_BYTES) {
    return { ok: false, message: "A imagem passa de 2 MB." };
  }
  const isJpeg = input.bytes.subarray(0, 3).equals(JPEG);
  const isPng = input.bytes.subarray(0, 8).equals(PNG);
  if (input.mimeType === "image/jpeg" && isJpeg) return { ok: true, mimeType: "image/jpeg" };
  if (input.mimeType === "image/png" && isPng) return { ok: true, mimeType: "image/png" };
  return { ok: false, message: "Envie uma imagem JPEG ou PNG capturada na câmera." };
}

export function decodePolicyPhoto(imageBase64: string): Buffer | null {
  const trimmed = imageBase64.trim();
  if (!trimmed || trimmed.length > COMMERCIAL_POLICY_PHOTO_MAX_BYTES * 2) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) return null;
  try {
    return Buffer.from(trimmed, "base64");
  } catch {
    return null;
  }
}
