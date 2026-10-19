/**
 * Avaliação 180° de liderança (puro, sem I/O).
 *
 * Um questionário único (LD-01..LD-08) respondido em três perspectivas sobre o mesmo líder:
 * autoavaliação (SELF), liderados diretos (UPWARD) e superior (SUPERIOR). Muda só o sujeito da
 * frase; competência, comportamento, escala e período são os mesmos.
 *
 * Decisões aprovadas em 19/10/2026 (proposta, sujeita ao RH e jurídico):
 * - Comentários da perspectiva UPWARD nunca saem do servidor (nem para SUPER_ADMIN).
 * - Média da equipe só com pelo menos `minRespondents` (5) respostas válidas, por líder e por
 *   competência; abaixo disso, "Amostra insuficiente para divulgação".
 * - Nota calibrada inteira de 1 a 4, definida pelo superior com justificativa (não é média).
 * - Índice geral = média simples das competências com dado válido, com a cobertura ("7 de 8").
 *   Ausência nunca vira zero.
 */
import { FREQUENCY_SCALE, isFrequencyScore, type FrequencyScore } from "./performanceDomain.js";

export const LEADERSHIP_PERSPECTIVES = ["SELF", "UPWARD", "SUPERIOR"] as const;
export type LeadershipPerspective = (typeof LEADERSHIP_PERSPECTIVES)[number];

export const LEADERSHIP_ASSIGNMENT_KIND: Record<LeadershipPerspective, LeadershipAssignmentKind> = {
  SELF: "LEADERSHIP_SELF",
  UPWARD: "LEADERSHIP_UPWARD",
  SUPERIOR: "LEADERSHIP_SUPERIOR",
};
export type LeadershipAssignmentKind = "LEADERSHIP_SELF" | "LEADERSHIP_UPWARD" | "LEADERSHIP_SUPERIOR";

export function isLeadershipKind(kind: string): kind is LeadershipAssignmentKind {
  return kind === "LEADERSHIP_SELF" || kind === "LEADERSHIP_UPWARD" || kind === "LEADERSHIP_SUPERIOR";
}

export const LEADERSHIP_PERSPECTIVE_LABELS: Record<LeadershipPerspective, string> = {
  SELF: "Autoavaliação de liderança",
  UPWARD: "Avaliação pela equipe",
  SUPERIOR: "Avaliação pelo superior",
};

export const LEADERSHIP_KIND_LABELS: Record<LeadershipAssignmentKind, string> = {
  LEADERSHIP_SELF: "Autoavaliação de liderança",
  LEADERSHIP_UPWARD: "Avaliação do meu líder",
  LEADERSHIP_SUPERIOR: "Avaliação de liderança",
};

export type LeadershipQuestion = {
  code: string;
  competency: string;
  /** Comportamento observável avaliado (idêntico nas três perspectivas). */
  behavior: string;
  /** Primeira pessoa (o líder sobre si). */
  selfText: string;
  /** Liderado sobre o líder. */
  upwardText: string;
  /** Superior sobre o líder. */
  superiorText: string;
};

/** Perguntas canônicas propostas. Códigos estáveis; textos sujeitos à validação do RH. */
export const PROPOSED_LEADERSHIP_QUESTIONS: readonly LeadershipQuestion[] = [
  {
    code: "LD-01",
    competency: "Clareza",
    behavior: "Comunica expectativas e prioridades de forma compreensível.",
    selfText: "Eu comunico expectativas e prioridades à minha equipe de forma compreensível.",
    upwardText: "Meu líder comunica expectativas e prioridades de forma compreensível.",
    superiorText: "Este líder comunica expectativas e prioridades à equipe de forma compreensível.",
  },
  {
    code: "LD-02",
    competency: "Respeito",
    behavior: "Trata as pessoas com respeito e profissionalismo.",
    selfText: "Eu trato as pessoas da minha equipe com respeito e profissionalismo.",
    upwardText: "Meu líder trata as pessoas com respeito e profissionalismo.",
    superiorText: "Este líder trata as pessoas da equipe com respeito e profissionalismo.",
  },
  {
    code: "LD-03",
    competency: "Comunicação",
    behavior: "Compartilha informações e mudanças relevantes em tempo adequado.",
    selfText: "Eu comunico mudanças e informações importantes à minha equipe em tempo adequado.",
    upwardText: "Meu líder comunica mudanças e informações importantes à equipe em tempo adequado.",
    superiorText: "Este líder comunica mudanças e informações importantes à equipe em tempo adequado.",
  },
  {
    code: "LD-04",
    competency: "Apoio",
    behavior: "Orienta a equipe na resolução de dificuldades.",
    selfText: "Eu oriento a minha equipe na resolução de dificuldades.",
    upwardText: "Meu líder orienta a equipe na resolução de dificuldades.",
    superiorText: "Este líder orienta a equipe na resolução de dificuldades.",
  },
  {
    code: "LD-05",
    competency: "Justiça",
    behavior: "Age com critérios justos e consistentes.",
    selfText: "Eu ajo com critérios justos e consistentes com a minha equipe.",
    upwardText: "Meu líder age com critérios justos e consistentes com a equipe.",
    superiorText: "Este líder age com critérios justos e consistentes com a equipe.",
  },
  {
    code: "LD-06",
    competency: "Feedback",
    behavior: "Oferece orientações sobre acertos e melhorias.",
    selfText: "Eu ofereço à minha equipe orientações sobre acertos e melhorias.",
    upwardText: "Meu líder oferece orientações sobre acertos e melhorias.",
    superiorText: "Este líder oferece à equipe orientações sobre acertos e melhorias.",
  },
  {
    code: "LD-07",
    competency: "Desenvolvimento",
    behavior: "Estimula aprendizagem e crescimento.",
    selfText: "Eu estimulo a aprendizagem e o crescimento da minha equipe.",
    upwardText: "Meu líder estimula a aprendizagem e o crescimento da equipe.",
    superiorText: "Este líder estimula a aprendizagem e o crescimento da equipe.",
  },
  {
    code: "LD-08",
    competency: "Exemplo",
    behavior: "Demonstra os comportamentos e padrões que exige.",
    selfText: "Eu demonstro os comportamentos e padrões que exijo da minha equipe.",
    upwardText: "Meu líder demonstra os comportamentos e padrões que exige.",
    superiorText: "Este líder demonstra os comportamentos e padrões que exige da equipe.",
  },
];

export const LEADERSHIP_CODES = PROPOSED_LEADERSHIP_QUESTIONS.map((q) => q.code);

export function questionText(q: Pick<LeadershipQuestion, "selfText" | "upwardText" | "superiorText">, perspective: LeadershipPerspective): string {
  return perspective === "SELF" ? q.selfText : perspective === "UPWARD" ? q.upwardText : q.superiorText;
}

export type LeadershipRules = {
  /** Respostas válidas mínimas para divulgar a média da equipe (por líder e por competência). */
  minRespondents: number;
  /** Letras mínimas do comentário obrigatório (notas 1 e 4). */
  commentMinLetters: number;
  /** Diferença entre perspectivas que conta como divergência relevante. */
  divergenceThreshold: number;
};

export const PROPOSED_LEADERSHIP_RULES: LeadershipRules = { minRespondents: 5, commentMinLetters: 15, divergenceThreshold: 1.5 };

export function parseLeadershipRules(value: unknown): LeadershipRules {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const int = (x: unknown, fallback: number, min: number, max: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : fallback);
  const threshold = typeof v.divergenceThreshold === "number" && v.divergenceThreshold >= 0.5 && v.divergenceThreshold <= 3 ? v.divergenceThreshold : PROPOSED_LEADERSHIP_RULES.divergenceThreshold;
  return {
    // Nunca abaixo de 3: com menos respondentes a média identifica quem respondeu.
    minRespondents: int(v.minRespondents, PROPOSED_LEADERSHIP_RULES.minRespondents, 3, 50),
    commentMinLetters: int(v.commentMinLetters, PROPOSED_LEADERSHIP_RULES.commentMinLetters, 10, 200),
    divergenceThreshold: threshold,
  };
}

// ---------------------------------------------------------------- comentários

/** Nota que exige comentário: os extremos da escala. */
export function commentRequired(score: number | null | undefined): boolean {
  return score === 1 || score === 4;
}

/**
 * Comentário obrigatório precisa descrever algo observável. Recusa texto curto, de uma ou duas
 * palavras, repetitivo ou artificial ("aaaaaaa", "ok ok ok ok"). Não exige citar pessoas.
 */
export function commentProblem(text: string | null | undefined, minLetters: number): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters < minLetters) return `Descreva um comportamento, exemplo ou situação observada (pelo menos ${minLetters} letras).`;
  const words = (t.toLowerCase().match(/\p{L}{2,}/gu) ?? []);
  if (words.length < 3) return "Use pelo menos três palavras para descrever o que foi observado.";
  if (new Set(words).size < 3) return "O comentário repete as mesmas palavras. Descreva o que foi observado.";
  if (/(.)\1{4,}/u.test(t.replace(/\s/g, ""))) return "O comentário parece artificial. Descreva o que foi observado.";
  const compact = t.replace(/\s/g, "").toLowerCase();
  const counts = new Map<string, number>();
  for (const ch of compact) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  if (Math.max(...counts.values()) / compact.length > 0.4) return "O comentário parece artificial. Descreva o que foi observado.";
  return null;
}

export type LeadershipAnswer = { kind: "pending" } | { kind: "score"; score: FrequencyScore; comment?: string | null } | { kind: "notObserved"; comment?: string | null };

export function leadershipAnswerProblem(answer: LeadershipAnswer, rules: LeadershipRules): string | null {
  if (answer.kind === "pending" || answer.kind === "notObserved") return null;
  if (!isFrequencyScore(answer.score)) return "Escolha uma resposta da escala.";
  if (commentRequired(answer.score)) return commentProblem(answer.comment, rules.commentMinLetters);
  return null;
}

// ---------------------------------------------------------------- consolidação

export type LeadershipStoredAnswer = { questionCode: string; kind: "pending" | "score" | "notObserved"; score: number | null };

/** Uma perspectiva individual (autoavaliação ou superior): nota por competência, sem média entre pessoas. */
export type PersonalPerspective = {
  submitted: boolean;
  scores: Record<string, number | null>;
  index: number | null;
  coverage: number;
};

export function personalPerspective(answers: readonly LeadershipStoredAnswer[] | null, codes: readonly string[] = LEADERSHIP_CODES): PersonalPerspective {
  if (!answers) return { submitted: false, scores: Object.fromEntries(codes.map((c) => [c, null])), index: null, coverage: 0 };
  const scores: Record<string, number | null> = {};
  for (const code of codes) {
    const a = answers.find((x) => x.questionCode === code);
    scores[code] = a && a.kind === "score" && isFrequencyScore(a.score) ? a.score : null;
  }
  const valid = codes.map((c) => scores[c]).filter((v): v is number => v != null);
  return { submitted: true, scores, index: valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null, coverage: valid.length };
}

export type TeamCompetency = {
  code: string;
  /** Respostas válidas (sem "Não sei"). Sempre informada: não identifica ninguém sozinha. */
  validCount: number;
  disclosed: boolean;
  mean: number | null;
  /** Desvio-padrão populacional, só quando divulgado. */
  dispersion: number | null;
};

export type TeamPerspective = {
  /** Liderados que enviaram a avaliação. */
  respondents: number;
  /** A equipe atingiu o mínimo de respondentes. */
  disclosed: boolean;
  competencies: TeamCompetency[];
  /** Média das competências divulgadas (peso igual). */
  index: number | null;
  coverage: number;
  message: string | null;
};

export const INSUFFICIENT_SAMPLE_MESSAGE = "Amostra insuficiente para divulgação";

/**
 * Média da equipe por competência. Cada respondente conta uma vez por competência; "Não sei" fica
 * fora; competência com menos de `minRespondents` respostas válidas não é divulgada, e a equipe
 * inteira só aparece com `minRespondents` respondentes. Nada individual sai daqui.
 */
export function teamPerspective(byRespondent: readonly (readonly LeadershipStoredAnswer[])[], rules: LeadershipRules, codes: readonly string[] = LEADERSHIP_CODES): TeamPerspective {
  const respondents = byRespondent.length;
  const teamDisclosed = respondents >= rules.minRespondents;
  const competencies: TeamCompetency[] = codes.map((code) => {
    const values = byRespondent
      .map((answers) => answers.find((a) => a.questionCode === code))
      .filter((a): a is LeadershipStoredAnswer => Boolean(a && a.kind === "score" && isFrequencyScore(a.score)))
      .map((a) => a.score as number);
    const disclosed = teamDisclosed && values.length >= rules.minRespondents;
    if (!disclosed) return { code, validCount: values.length, disclosed: false, mean: null, dispersion: null };
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const dispersion = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    return { code, validCount: values.length, disclosed: true, mean, dispersion };
  });
  const shown = competencies.filter((c) => c.disclosed && c.mean != null);
  return {
    respondents,
    disclosed: teamDisclosed,
    competencies,
    index: shown.length ? shown.reduce((s, c) => s + (c.mean as number), 0) / shown.length : null,
    coverage: shown.length,
    message: teamDisclosed ? (shown.length < codes.length ? `${INSUFFICIENT_SAMPLE_MESSAGE} em ${codes.length - shown.length} competência(s).` : null) : INSUFFICIENT_SAMPLE_MESSAGE,
  };
}

/** Índice de notas inteiras (calibrada). Exige as 8 notas. */
export function calibratedIndex(scores: Record<string, number>, codes: readonly string[] = LEADERSHIP_CODES): number | null {
  const values = codes.map((c) => scores[c]).filter((v) => isFrequencyScore(v));
  return values.length === codes.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

export function formatScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------- comparação e calibração

export type CompetencyComparison = {
  code: string;
  competency: string;
  behavior: string;
  self: number | null;
  superior: number | null;
  team: number | null;
  teamDisclosed: boolean;
  teamValidCount: number;
  divergences: string[];
};

export function compareCompetencies(input: {
  questions: readonly Pick<LeadershipQuestion, "code" | "competency" | "behavior">[];
  self: PersonalPerspective;
  superior: PersonalPerspective;
  team: TeamPerspective;
  rules: LeadershipRules;
}): CompetencyComparison[] {
  return input.questions.map((q) => {
    const self = input.self.scores[q.code] ?? null;
    const superior = input.superior.scores[q.code] ?? null;
    const t = input.team.competencies.find((c) => c.code === q.code);
    const team = t?.disclosed ? t.mean : null;
    const divergences: string[] = [];
    const gap = (a: number | null, b: number | null) => (a != null && b != null ? Math.abs(a - b) : 0);
    if (gap(team, self) >= input.rules.divergenceThreshold) divergences.push("Equipe × autoavaliação");
    if (gap(team, superior) >= input.rules.divergenceThreshold) divergences.push("Equipe × superior");
    if (gap(self, superior) >= input.rules.divergenceThreshold) divergences.push("Autoavaliação × superior");
    return { code: q.code, competency: q.competency, behavior: q.behavior, self, superior, team, teamDisclosed: Boolean(t?.disclosed), teamValidCount: t?.validCount ?? 0, divergences };
  });
}

/**
 * Por que a nota calibrada desta competência precisa de justificativa. Usa só o que o calibrador
 * vê: média da equipe suprimida não entra em nenhuma regra (não dá para deduzir respostas).
 */
export function justificationReasons(row: CompetencyComparison, calibrated: number): string[] {
  const reasons: string[] = [];
  if (calibrated === 1 || calibrated === 4) reasons.push("Nota extrema");
  if (row.superior != null && Math.abs(calibrated - row.superior) >= 1) reasons.push("Diferente da avaliação do superior");
  if (row.team != null && Math.abs(calibrated - row.team) >= 1) reasons.push("Diferente da média da equipe");
  if (row.divergences.length > 0) reasons.push("Perspectivas divergentes");
  if (!row.teamDisclosed || row.self == null || row.superior == null) reasons.push("Evidência limitada");
  return reasons;
}

export const LEADERSHIP_JUSTIFICATION_MIN = 15;
export const LEADERSHIP_SCALE = FREQUENCY_SCALE;

/** Mais fortes e prioridades de desenvolvimento pela nota calibrada (empates pela ordem do código). */
export function strengthsAndPriorities(scores: Record<string, number>, questions: readonly Pick<LeadershipQuestion, "code" | "competency">[]) {
  const rows = questions.map((q) => ({ code: q.code, competency: q.competency, score: scores[q.code] })).filter((r) => isFrequencyScore(r.score));
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return { strengths: sorted.filter((r) => r.score >= 3).slice(0, 3), priorities: [...sorted].reverse().filter((r) => r.score <= 2).slice(0, 3) };
}
