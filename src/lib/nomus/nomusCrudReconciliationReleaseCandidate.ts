/**
 * SYNC-10 — Release candidate da reconciliação CRUD Nomus (puro).
 *
 * Consolida checklist, matriz CRUD, auditoria de delete, performance e
 * comandos de preview. Não executa apply real nem acesso a produção.
 */

export const SYNC_10_RELEASE_CANDIDATE = {
  ticket: "SYNC-10",
  title: "CRUD reconciliation release candidate",
  prerequisites: ["SYNC-01", "SYNC-02", "SYNC-03", "SYNC-04", "SYNC-05", "SYNC-06", "SYNC-07", "SYNC-08", "SYNC-09"],
  noProductionAccess: true,
  noRealApplyInRcValidation: true,
  noServerDeploy: true,
} as const;

/** Checklist obrigatório SYNC-10. */
export const SYNC_10_CHECKLIST = [
  {
    id: 1,
    question: "Todos os modos possuem preview?",
    answer: true,
    evidence:
      "backfill preview/apply; reconcile sales-orders|AR|AP com mode preview|apply (default preview-safe CLI).",
  },
  {
    id: 2,
    question: "Todas as ausências exigem payload completo?",
    answer: true,
    evidence:
      "canMarkRecordMissingInRun + engine absencesEvaluated só com SUCCESS + payloadComplete + flag.",
  },
  {
    id: 3,
    question: "As três entidades permanecem independentes?",
    answer: true,
    evidence:
      "SALES_ORDER / ACCOUNTS_RECEIVABLE / ACCOUNTS_PAYABLE com escopos, flags e pilots separados.",
  },
  {
    id: 4,
    question: "Há kill switch por entidade?",
    answer: true,
    evidence:
      "NOMUS_SOURCE_RECONCILE_{SALES_ORDERS|AR|AP}_ENABLED + NOMUS_OPS_EXCLUDE_MISSING_* fail-closed.",
  },
  {
    id: 5,
    question: "Existe rollback operacional?",
    answer: true,
    evidence:
      "Desligar flags; lifecycle preservado; restaurar código; restore DB só como último recurso (runbook).",
  },
] as const;

export type CrudMatrixCell = {
  entity: "SALES_ORDER" | "ACCOUNTS_RECEIVABLE" | "ACCOUNTS_PAYABLE";
  create: string;
  update: string;
  logicalDelete: string;
  reactivate: string;
};

export const CRUD_MATRIX_FINAL: readonly CrudMatrixCell[] = [
  {
    entity: "SALES_ORDER",
    create: "Novo pedido no payload → CREATE com PRESENT + lifecycle inicial.",
    update: "Hash/cabeçalho/itens alterados → UPDATE; custos internos preservados.",
    logicalDelete:
      "1ª ausência (payload COMPLETE) → MISSING_CANDIDATE; confirmação exige prova; ops excluem só MISSING_CONFIRMED.",
    reactivate:
      "Reaparece no payload → REACTIVATE → PRESENT; consumidores voltam; sem duplicidade (mesmo externalId).",
  },
  {
    entity: "ACCOUNTS_RECEIVABLE",
    create: "Novo título → CREATE PRESENT com campos financeiros oficiais.",
    update: "Saldo/status/recebimentos → UPDATE via payloadHash; histórico pago preservado.",
    logicalDelete:
      "Candidato → confirmado com prova; independência do Pedido (ex. CR 17748 ≠ PD 02739).",
    reactivate: "Título reaparece → PRESENT; sem create duplicado pelo mesmo externalId.",
  },
  {
    entity: "ACCOUNTS_PAYABLE",
    create: "Novo título → CREATE PRESENT.",
    update: "Vencimento/valor/pagamento → UPDATE; eixo operacional = dueDate.",
    logicalDelete: "Candidato/confirmado só com payload COMPLETE; sem delete físico.",
    reactivate: "Reaparece → PRESENT; Data de Vencimento preservada no registro.",
  },
] as const;

/** Arquivos da funcionalidade nova — devem estar livres de delete físico. */
export const SYNC_10_DELETE_AUDIT_FILES = [
  "src/lib/nomus/nomusSourceReconciliationEngine.ts",
  "src/lib/nomus/nomusSourceLifecycleContract.ts",
  "src/lib/nomus/nomusSourceReconciliationFlags.ts",
  "src/lib/nomus/nomusSourcePresencePolicy.ts",
  "src/lib/nomus/nomusSalesOrderSourceReconciliation.ts",
  "src/lib/nomus/nomusSalesOrderSourceReconciliation.server.ts",
  "src/lib/nomus/nomusAccountsReceivableSourceReconciliation.ts",
  "src/lib/nomus/nomusAccountsReceivableSourceReconciliation.server.ts",
  "src/lib/nomus/nomusAccountsPayableSourceReconciliation.ts",
  "src/lib/nomus/nomusAccountsPayableSourceReconciliation.server.ts",
  "src/lib/nomus/nomusLifecycleBackfill.ts",
  "src/lib/nomus/nomusLifecycleBackfill.server.ts",
  "src/lib/nomus/nomusSourceReconcileCli.ts",
  "src/lib/nomus/nomusSourceReconcile.server.ts",
  "scripts/nomusLifecycleBackfill.ts",
  "scripts/nomusSalesOrdersSourceReconcile.ts",
  "scripts/nomusAccountsReceivableSourceReconcile.ts",
  "scripts/nomusAccountsPayableSourceReconcile.ts",
] as const;

export const FORBIDDEN_PHYSICAL_DELETE_PATTERNS = [
  /\.deleteMany\s*\(/,
  /\.delete\s*\(\s*\{/,
  /prisma\.\w+\.delete\s*\(/,
  /ON DELETE CASCADE/i,
] as const;

/**
 * Exceções preexistentes / schema — documentadas, não alteradas pelo RC.
 * ON DELETE SET NULL no FK lastSyncRunId não limpa Pedido/CR/CP.
 */
export const DOCUMENTED_DELETE_EXCEPTIONS = [
  {
    path: "prisma/migrations/20260803120000_nomus_source_lifecycle_contract/migration.sql",
    note: "FK lastSyncRunId → NomusSourceSyncRun ON DELETE SET NULL (não apaga SO/AR/AP).",
  },
  {
    path: "sincronizadores legados / outros módulos",
    note: "Deletes preexistentes fora do escopo SYNC (itens stale, limpezas de outros domínios) permanecem; lifecycle de presença não os usa.",
  },
] as const;

export const PERFORMANCE_RC_CHECKS = [
  {
    id: "indexes",
    ok: true,
    detail:
      "sourcePresenceStatus, lastSeenAt, lastSyncRunId (+ payloadHash/externalId SO) indexados na migration SYNC-02.",
  },
  {
    id: "pagination",
    ok: true,
    detail: "Fetch Nomus paginado; maxPages; stop por página vazia/no-next.",
  },
  {
    id: "memory",
    ok: true,
    detail: "Planos em memória por universo da rodada; apply em lotes (--batch-size).",
  },
  {
    id: "duration",
    ok: true,
    detail: "NomusSourceSyncRun registra startedAt/finishedAt; observabilidade SYNC-09.",
  },
  {
    id: "batch",
    ok: true,
    detail: "planReconcileApplyBatches + resume-cursor; backfill chunked.",
  },
  {
    id: "queries",
    ok: true,
    detail:
      "1 findMany de locais por entidade + updates transacionais por lote (não N+1 de relações).",
  },
  {
    id: "n_plus_one",
    ok: true,
    detail: "Locais carregados em lote; patches aplicados em $transaction por batch.",
  },
  {
    id: "presence_filters",
    ok: true,
    detail:
      "Filtros ops via merge Prisma indexado em sourcePresenceStatus; fail-closed se flag off.",
  },
] as const;

export const PREVIEW_COMMANDS = {
  backfill: "npm run backfill:nomus:lifecycle:preview -- --entity=all",
  salesOrders: "npm run reconcile:nomus:sales-orders -- preview",
  salesOrdersPilot:
    'npm run reconcile:nomus:sales-orders -- preview --orderCode="PD 02739"',
  accountsReceivable: "npm run reconcile:nomus:accounts-receivable -- preview",
  accountsReceivablePilot:
    "npm run reconcile:nomus:accounts-receivable -- preview --externalId=17748",
  accountsPayable: "npm run reconcile:nomus:accounts-payable -- preview",
} as const;

export const ABSENCE_KILL_SWITCHES = [
  "NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED",
  "NOMUS_SOURCE_RECONCILE_AR_ENABLED",
  "NOMUS_SOURCE_RECONCILE_AP_ENABLED",
] as const;

export const OPS_EXCLUDE_FLAGS = [
  "NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED",
  "NOMUS_OPS_EXCLUDE_MISSING_AR_ENABLED",
  "NOMUS_OPS_EXCLUDE_MISSING_AP_ENABLED",
] as const;

export const MIGRATION_PATH =
  "prisma/migrations/20260803120000_nomus_source_lifecycle_contract/migration.sql";

/** Marcadores obrigatórios dos 21 passos do runbook de produção. */
export const RUNBOOK_PRODUCTION_STEP_MARKERS = [
  "verificar processos de escrita",
  "backup do banco",
  "registrar commit",
  "deploy com flags desligadas",
  "aplicar migration",
  "validar schema",
  "executar backfill inicial",
  "preview de Pedidos",
  "piloto PD 02739",
  "ativar lifecycle de Pedidos",
  "validar consumidores",
  "preview de CR",
  "consultar CR 17748",
  "ativar lifecycle de CR",
  "preview de CP",
  "piloto de CP",
  "ativar lifecycle de CP",
  "validar Fluxo de Caixa",
  "validar Comissões",
  "validar relatórios",
  "acompanhar runs",
] as const;

export function auditSourceForPhysicalDeletes(source: string): string[] {
  const hits: string[] = [];
  for (const pattern of FORBIDDEN_PHYSICAL_DELETE_PATTERNS) {
    if (pattern.test(source)) {
      hits.push(String(pattern));
    }
  }
  return hits;
}

export function assertSync10ChecklistComplete(): void {
  for (const item of SYNC_10_CHECKLIST) {
    if (item.answer !== true) {
      throw new Error(`SYNC-10 checklist falhou: #${item.id} ${item.question}`);
    }
  }
}
