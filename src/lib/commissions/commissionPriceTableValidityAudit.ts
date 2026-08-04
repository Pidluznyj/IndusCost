/**
 * Auditoria de VIGÊNCIA das versões de tabela comercial — pura, read-only.
 *
 * MOTIVO (defeito D3, confirmado em produção)
 * Versões com `effectiveTo` igual ao `effectiveFrom` (janela de largura zero) e
 * outras com `effectiveTo` ANTERIOR ao `effectiveFrom`. Contra o filtro de
 * vigência `effectiveFrom <= data < effectiveTo`, nenhuma dessas casa em data
 * alguma — a resolução ponto-no-tempo simplesmente não acha tabela, e o item
 * vira `NO_COMMERCIAL_PRICE_TABLE` sem que falte cadastro de fato.
 *
 * REGRA OFICIAL DE SUCESSÃO (base do AUTO_REPAIRABLE)
 * Versões da mesma tabela formam uma linha do tempo contínua: o fim de uma é o
 * início da seguinte. Então `effectiveTo(N) = effectiveFrom(N+1)`, derivado da
 * própria sucessão — fonte oficial e inequívoca, não inferência por id ou
 * `createdAt`. Quando a sucessora é ambígua (duas versões com o mesmo
 * `effectiveFrom`) ou inexistente, NÃO há reparo automático.
 *
 * Este módulo classifica e PROPÕE. Não repara, não escreve.
 */

export type PriceTableVersionAuditRow = {
  tableId: string;
  tableCode: string;
  versionId: string;
  versionNumber: number;
  status: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  publishedAt: Date | null;
  itemCount: number;
};

export type PriceTableValidityIssueKind =
  | "ZERO_WIDTH_VALIDITY"
  | "INVERTED_VALIDITY"
  | "MISSING_EFFECTIVE_FROM"
  | "DUPLICATE_EFFECTIVE_FROM"
  | "OVERLAPPING_VERSIONS"
  | "VALIDITY_GAP"
  | "PUBLISHED_WITHOUT_VALIDITY"
  | "RETROACTIVE_PUBLICATION";

/** Confiança na correção proposta — governa o que o apply pode tocar. */
export type PriceTableEvidenceClass =
  | "AUTO_REPAIRABLE"
  | "MANUAL_REVIEW_REQUIRED"
  | "UNRESOLVED";

export type PriceTableValidityIssue = {
  kind: PriceTableValidityIssueKind;
  evidenceClass: PriceTableEvidenceClass;
  tableId: string;
  tableCode: string;
  versionId: string;
  versionNumber: number;
  status: string;
  currentEffectiveFrom: Date | null;
  currentEffectiveTo: Date | null;
  /** Preenchido só quando AUTO_REPAIRABLE. */
  proposedEffectiveFrom: Date | null;
  proposedEffectiveTo: Date | null;
  /** De onde saiu a proposta — auditável, nunca "achismo". */
  evidenceSource: string | null;
  rule: string;
  detail: string;
  risk: "HIGH" | "MEDIUM" | "LOW";
};

function sameTime(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

/** Ordena por início e desempata por número — sucessão determinística. */
function byTimeline(
  a: PriceTableVersionAuditRow,
  b: PriceTableVersionAuditRow
): number {
  const at = a.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bt = b.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (at !== bt) return at - bt;
  return a.versionNumber - b.versionNumber;
}

/**
 * DRAFT nunca vigorou, então vigência incoerente nela não é defeito — é estado
 * normal de rascunho. Auditar DRAFT só geraria ruído.
 */
function auditable(rows: readonly PriceTableVersionAuditRow[]) {
  return rows.filter((r) => r.status !== "DRAFT");
}

export function auditPriceTableValidity(
  rows: readonly PriceTableVersionAuditRow[]
): PriceTableValidityIssue[] {
  const issues: PriceTableValidityIssue[] = [];

  const byTable = new Map<string, PriceTableVersionAuditRow[]>();
  for (const row of auditable(rows)) {
    byTable.set(row.tableId, [...(byTable.get(row.tableId) ?? []), row]);
  }

  for (const [, versions] of byTable) {
    const timeline = [...versions].sort(byTimeline);
    /**
     * Versões já acusadas de vigência estruturalmente quebrada. A lacuna que
     * elas deixam é CONSEQUÊNCIA, não defeito próprio: reportar as duas daria
     * dois achados com propostas concorrentes para a mesma causa.
     */
    const brokenValidity = new Set<string>();

    for (let i = 0; i < timeline.length; i += 1) {
      const v = timeline[i]!;
      const base = {
        tableId: v.tableId,
        tableCode: v.tableCode,
        versionId: v.versionId,
        versionNumber: v.versionNumber,
        status: v.status,
        currentEffectiveFrom: v.effectiveFrom,
        currentEffectiveTo: v.effectiveTo,
      };

      // Sucessora: primeira versão com início ESTRITAMENTE posterior.
      const successors = timeline.filter(
        (o) =>
          o.versionId !== v.versionId &&
          o.effectiveFrom != null &&
          v.effectiveFrom != null &&
          o.effectiveFrom.getTime() > v.effectiveFrom.getTime()
      );
      const nextStart = successors[0]?.effectiveFrom ?? null;
      const ambiguousSuccessor =
        successors.length > 1 &&
        sameTime(successors[0]!.effectiveFrom, successors[1]!.effectiveFrom);

      if (!v.effectiveFrom) {
        issues.push({
          ...base,
          kind: "MISSING_EFFECTIVE_FROM",
          evidenceClass: "UNRESOLVED",
          proposedEffectiveFrom: null,
          proposedEffectiveTo: null,
          evidenceSource: null,
          rule: "Versão não-DRAFT precisa de início de vigência.",
          detail: `Versão ${v.versionNumber} (${v.status}) sem effectiveFrom — não é possível saber quando valeu.`,
          risk: "HIGH",
        });
        continue;
      }

      const zeroWidth = sameTime(v.effectiveFrom, v.effectiveTo);
      const inverted =
        v.effectiveTo != null &&
        v.effectiveTo.getTime() < v.effectiveFrom.getTime();

      if (zeroWidth || inverted) {
        brokenValidity.add(v.versionId);
        // Reparo só quando a sucessão dá a data de forma inequívoca.
        const repairable = nextStart != null && !ambiguousSuccessor;
        issues.push({
          ...base,
          kind: zeroWidth ? "ZERO_WIDTH_VALIDITY" : "INVERTED_VALIDITY",
          evidenceClass: repairable ? "AUTO_REPAIRABLE" : "MANUAL_REVIEW_REQUIRED",
          proposedEffectiveFrom: repairable ? v.effectiveFrom : null,
          proposedEffectiveTo: repairable ? nextStart : null,
          evidenceSource: repairable
            ? `effectiveFrom da versão sucessora ${successors[0]!.versionNumber}`
            : null,
          rule: "effectiveTo(N) = effectiveFrom(N+1) — o fim de uma versão é o início da seguinte.",
          detail: zeroWidth
            ? `Versão ${v.versionNumber}: fim igual ao início — não cobre data alguma.`
            : `Versão ${v.versionNumber}: fim anterior ao início — vigência impossível.`,
          risk: "HIGH",
        });
        continue;
      }

      if (v.status === "PUBLISHED" && v.effectiveTo != null && nextStart == null) {
        // Publicada e fechada sem sucessora: a partir do fim, nada vigora.
        issues.push({
          ...base,
          kind: "PUBLISHED_WITHOUT_VALIDITY",
          evidenceClass: "MANUAL_REVIEW_REQUIRED",
          proposedEffectiveFrom: null,
          proposedEffectiveTo: null,
          evidenceSource: null,
          rule: "Versão PUBLISHED sem sucessora deveria ter vigência aberta.",
          detail: `Versão ${v.versionNumber} é a última e tem fim definido — vendas após ${v.effectiveTo.toISOString().slice(0, 10)} ficam sem tabela.`,
          risk: "HIGH",
        });
      }

      if (v.publishedAt && v.publishedAt.getTime() > v.effectiveFrom.getTime()) {
        issues.push({
          ...base,
          kind: "RETROACTIVE_PUBLICATION",
          evidenceClass: "MANUAL_REVIEW_REQUIRED",
          proposedEffectiveFrom: null,
          proposedEffectiveTo: null,
          evidenceSource: null,
          rule: "Publicação posterior ao início da vigência altera cálculo já materializado.",
          detail: `Versão ${v.versionNumber} publicada em ${v.publishedAt.toISOString().slice(0, 10)} valendo desde ${v.effectiveFrom.toISOString().slice(0, 10)} — snapshots do intervalo podem estar defasados.`,
          risk: "MEDIUM",
        });
      }

      const prev = timeline[i - 1];
      if (prev?.effectiveFrom && sameTime(prev.effectiveFrom, v.effectiveFrom)) {
        issues.push({
          ...base,
          kind: "DUPLICATE_EFFECTIVE_FROM",
          evidenceClass: "MANUAL_REVIEW_REQUIRED",
          proposedEffectiveFrom: null,
          proposedEffectiveTo: null,
          evidenceSource: null,
          rule: "Duas versões não podem começar no mesmo instante.",
          detail: `Versões ${prev.versionNumber} e ${v.versionNumber} começam em ${v.effectiveFrom.toISOString().slice(0, 10)} — a escolha na data fica ambígua.`,
          risk: "HIGH",
        });
      }

      if (prev?.effectiveFrom && prev.effectiveTo && v.effectiveFrom) {
        const prevEnd = prev.effectiveTo.getTime();
        const thisStart = v.effectiveFrom.getTime();
        if (prevEnd > thisStart) {
          issues.push({
            ...base,
            kind: "OVERLAPPING_VERSIONS",
            evidenceClass: "MANUAL_REVIEW_REQUIRED",
            proposedEffectiveFrom: null,
            proposedEffectiveTo: null,
            evidenceSource: null,
            rule: "Vigências não podem se sobrepor.",
            detail: `Versão ${prev.versionNumber} termina depois do início da ${v.versionNumber} — há datas com duas versões válidas.`,
            risk: "HIGH",
          });
        } else if (prevEnd < thisStart && !brokenValidity.has(prev.versionId)) {
          // A lacuna é da versão ANTERIOR (cujo fim ficou curto), não desta —
          // a proposta altera o `effectiveTo` dela. Atribuir a esta versão
          // apontaria o registro errado para quem for reparar.
          //
          // Pulada quando a anterior já foi acusada de vigência quebrada: ali a
          // lacuna é CONSEQUÊNCIA, e reportar as duas geraria dois achados com
          // propostas concorrentes para a mesma causa.
          issues.push({
            tableId: prev.tableId,
            tableCode: prev.tableCode,
            versionId: prev.versionId,
            versionNumber: prev.versionNumber,
            status: prev.status,
            currentEffectiveFrom: prev.effectiveFrom,
            currentEffectiveTo: prev.effectiveTo,
            kind: "VALIDITY_GAP",
            evidenceClass: "AUTO_REPAIRABLE",
            proposedEffectiveFrom: prev.effectiveFrom,
            proposedEffectiveTo: v.effectiveFrom,
            evidenceSource: `effectiveFrom da versão sucessora ${v.versionNumber}`,
            rule: "effectiveTo(N) = effectiveFrom(N+1) — a linha do tempo não tem buraco.",
            detail: `Sem tabela entre ${prev.effectiveTo.toISOString().slice(0, 10)} e ${v.effectiveFrom.toISOString().slice(0, 10)}; vendas no intervalo não resolvem.`,
            risk: "HIGH",
          });
        }
      }
    }
  }

  return issues;
}

export type PriceTableValiditySummary = {
  versionsAnalyzed: number;
  issueCount: number;
  countsByClass: Record<PriceTableEvidenceClass, number>;
  countsByKind: Record<string, number>;
  affectedTableCodes: string[];
};

export function summarizePriceTableValidity(
  rows: readonly PriceTableVersionAuditRow[],
  issues: readonly PriceTableValidityIssue[]
): PriceTableValiditySummary {
  const countsByClass: Record<PriceTableEvidenceClass, number> = {
    AUTO_REPAIRABLE: 0,
    MANUAL_REVIEW_REQUIRED: 0,
    UNRESOLVED: 0,
  };
  const countsByKind: Record<string, number> = {};
  for (const i of issues) {
    countsByClass[i.evidenceClass] += 1;
    countsByKind[i.kind] = (countsByKind[i.kind] ?? 0) + 1;
  }
  return {
    versionsAnalyzed: rows.length,
    issueCount: issues.length,
    countsByClass,
    countsByKind,
    affectedTableCodes: [...new Set(issues.map((i) => i.tableCode))].sort(),
  };
}
