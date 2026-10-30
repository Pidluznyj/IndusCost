import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FISCAL360_CHECK_LABELS, FISCAL360_TAX_LABELS, fiscal360CompanyLabel } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { buildFiscal360Query, fetchFiscal360, formatFiscal360Date, formatFiscal360Month, type Fiscal360Capabilities, type Fiscal360UiFilters } from "@/src/lib/finance/fiscal360/fiscal360Client";
import { FISCAL360_BATCH_MAX, type Fiscal360ApTitleRow, type Fiscal360BatchDecisionType, type Fiscal360BatchKeys, type Fiscal360BatchResult, type Fiscal360Page, type Fiscal360ReconciliationResponse, type Fiscal360ReconciliationRow } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { EMPTY_FISCAL360_SEARCH, Fiscal360BatchForm, Fiscal360BatchResultNotice, Fiscal360Checkbox, Fiscal360SearchFields, Fiscal360SelectionBar, type Fiscal360SearchValue } from "./Fiscal360BatchActions";
import { Fiscal360DecisionForm, type DecisionTarget } from "./Fiscal360Decisions";
import { Badge, ButtonLike, Callout, DataTable, ErrorState, KpiCard, KpiGrid, LoadingState, Pagination, Section, money, statusTone } from "./Fiscal360Shared";
import { useFiscal360Resource } from "./useFiscal360Resource";

type Selection = {
  selected: Set<string>;
  toggle: (key: string, on: boolean) => void;
  setMany: (keys: string[], on: boolean) => void;
  replace: (keys: string[]) => void;
  clear: () => void;
};

function useSelection(): Selection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set<string>());
  const setMany = useCallback((keys: string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }, []);
  const toggle = useCallback((key: string, on: boolean) => setMany([key], on), [setMany]);
  const replace = useCallback((keys: string[]) => setSelected(new Set(keys)), []);
  const clear = useCallback(() => setSelected(new Set<string>()), []);
  return { selected, toggle, setMany, replace, clear };
}

const reconSelectable = (r: Fiscal360ReconciliationRow) => r.status !== "OK" && r.status !== "ACCEPTED";

export function Fiscal360Reconciliation({
  filters,
  refreshKey,
  caps,
  onOpenPayment,
}: {
  filters: Fiscal360UiFilters;
  refreshKey: number;
  caps: Fiscal360Capabilities;
  onOpenPayment: (anchorKey: string) => void;
}) {
  const [checkType, setCheckType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [apPage, setApPage] = useState(1);
  const [decision, setDecision] = useState<DecisionTarget | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [search, setSearch] = useState<Fiscal360SearchValue>(EMPTY_FISCAL360_SEARCH);
  const [apSearch, setApSearch] = useState<Fiscal360SearchValue>(EMPTY_FISCAL360_SEARCH);
  const reconSelection = useSelection();
  const apSelection = useSelection();
  const [batch, setBatch] = useState<Fiscal360BatchDecisionType | null>(null);
  const [batchResult, setBatchResult] = useState<Fiscal360BatchResult | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);
  const clearRecon = reconSelection.clear;
  const clearAp = apSelection.clear;
  // A marcação vale para o que está à vista: mudar o filtro não pode deixar item escondido marcado.
  useEffect(() => {
    setPage(1);
    clearRecon();
    setBatch((current) => (current === "ACCEPT_DIVERGENCE" ? null : current));
  }, [filters, checkType, status, search, clearRecon]);
  useEffect(() => {
    setApPage(1);
    clearAp();
    setBatch((current) => (current === "ACCEPT_DIVERGENCE" ? current : null));
  }, [filters, apSearch, clearAp]);
  const searchParams = useMemo(() => ({ q: search.q, minAmount: search.minAmount, maxAmount: search.maxAmount }), [search]);
  const apSearchParams = useMemo(() => ({ q: apSearch.q, minAmount: apSearch.minAmount, maxAmount: apSearch.maxAmount }), [apSearch]);
  const query = useMemo(() => buildFiscal360Query(filters, { checkType, status, page, pageSize: 50, ...searchParams }), [filters, checkType, status, page, searchParams]);
  const { data, loading, error, reload } = useFiscal360Resource<Fiscal360ReconciliationResponse>("reconciliation", query, refreshKey);
  const apQuery = useMemo(() => buildFiscal360Query(filters, { classification: "PENDING", page: apPage, pageSize: 20, ...apSearchParams }), [filters, apPage, apSearchParams]);
  const pending = useFiscal360Resource<Fiscal360Page<Fiscal360ApTitleRow>>("ap-titles", apQuery, refreshKey);

  const count = (types: string[], statuses?: string[]) =>
    (data?.summary ?? []).filter((s) => types.includes(s.checkType) && (!statuses || statuses.includes(s.status))).reduce((a, s) => a + s.count, 0);
  const select = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";
  const afterDecision = () => {
    setDecision(null);
    setDone("Decisão registrada com trilha de auditoria. O processamento incremental aplicará o efeito.");
    reload();
    pending.reload();
  };
  const afterBatch = (result: Fiscal360BatchResult) => {
    const selection = batch === "ACCEPT_DIVERGENCE" ? reconSelection : apSelection;
    // Só o que falhou fica marcado, para tentar de novo.
    selection.replace(result.failed.map((f) => f.target));
    setBatch(null);
    setBatchResult(result);
    setDone(null);
    reload();
    pending.reload();
  };
  const selectAll = async (path: string, queryString: string, selection: Selection) => {
    setSelectingAll(true);
    setSelectError(null);
    try {
      const res = await fetchFiscal360<Fiscal360BatchKeys>(path, queryString);
      selection.replace(res.keys);
      if (res.total > res.keys.length) setSelectError(`O filtro tem ${res.total.toLocaleString("pt-BR")} itens. Foram marcados os primeiros ${FISCAL360_BATCH_MAX}; registre este lote e marque os próximos.`);
    } catch (err) {
      setSelectError(err instanceof Error ? err.message : "Não foi possível marcar os itens do filtro.");
    } finally {
      setSelectingAll(false);
    }
  };
  const openBatch = (type: Fiscal360BatchDecisionType) => {
    setDecision(null);
    setBatchResult(null);
    setBatch(type);
  };
  const reconPageKeys = (data?.rows ?? []).filter(reconSelectable).map((r) => r.itemKey);
  const reconOnPage = reconPageKeys.filter((k) => reconSelection.selected.has(k)).length;
  const apPageKeys = (pending.data?.rows ?? []).map((r) => String(r.apExternalId));
  const apOnPage = apPageKeys.filter((k) => apSelection.selected.has(k)).length;

  return (
    <div className="space-y-4" data-testid="fiscal360-reconciliation">
      <KpiGrid>
        <KpiCard label="Guias sem vínculo com AP" value={count(["GUIDE_WITHOUT_AP"])} tone={count(["GUIDE_WITHOUT_AP"]) ? "warn" : undefined} source="Guia × contas a pagar" />
        <KpiCard label="Títulos tributários sem guia" value={count(["AP_TAX_WITHOUT_GUIDE"])} tone={count(["AP_TAX_WITHOUT_GUIDE"]) ? "warn" : undefined} source="AP classificado (confiança alta)" />
        <KpiCard label="Possíveis pagamentos duplicados" value={count(["POSSIBLE_DUPLICATE", "DUPLICATE_AP_LINK"], ["REVIEW"])} tone={count(["POSSIBLE_DUPLICATE", "DUPLICATE_AP_LINK"], ["REVIEW"]) ? "danger" : undefined} source="Contados uma única vez" />
        <KpiCard label="Apuração × guia divergente" value={count(["APURATION_VS_GUIDE"], ["DIVERGENT", "MISSING"])} hint={`${count(["COMPETENCE_WITHOUT_CLOSING"])} competência(s) sem fechamento · ${count(["CREDITS_UNRECONCILED"], ["REVIEW"])} crédito(s) a conciliar`} source="FiscalApurationLine × guias" />
      </KpiGrid>
      {done ? <Callout>{done}</Callout> : null}
      {batchResult ? <Fiscal360BatchResultNotice result={batchResult} /> : null}
      {selectError ? <Callout tone="warn">{selectError}</Callout> : null}
      {decision ? <Fiscal360DecisionForm target={decision} onCancel={() => setDecision(null)} onDone={afterDecision} /> : null}
      <Section
        title="Fila de conciliação"
        subtitle="Apuração × guia × contas a pagar × baixa × comprovante. Itens OK ficam ocultos por padrão."
        actions={
          <div className="flex flex-wrap gap-2">
            <select className={select} value={checkType} onChange={(e) => setCheckType(e.target.value)} aria-label="Checagem" data-testid="fiscal360-recon-check">
              <option value="">Todas as checagens</option>
              {Object.entries(FISCAL360_CHECK_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
              <option value="">Exceções (sem OK)</option>
              {["DIVERGENT", "MISSING", "REVIEW", "ACCEPTED", "OK"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <Fiscal360SearchFields placeholder="Mensagem, guia ou título AP" amountLabel="Diferença" onChange={setSearch} testId="fiscal360-recon-search" />
        {caps.reconcile ? (
          <Fiscal360SelectionBar
            count={reconSelection.selected.size}
            selectingAll={selectingAll}
            onSelectAll={() => void selectAll("reconciliation/keys", buildFiscal360Query(filters, { checkType, status, ...searchParams }), reconSelection)}
            onClear={reconSelection.clear}
            testId="fiscal360-recon-selection"
          >
            <ButtonLike variant="primary" onClick={() => openBatch("ACCEPT_DIVERGENCE")} testId="fiscal360-recon-batch-accept">
              Aceitar marcados com justificativa
            </ButtonLike>
          </Fiscal360SelectionBar>
        ) : null}
        {batch === "ACCEPT_DIVERGENCE" ? <Fiscal360BatchForm decisionType={batch} itemKeys={[...reconSelection.selected]} onCancel={() => setBatch(null)} onDone={afterBatch} /> : null}
        {error ? <ErrorState message={error} /> : null}
        {!data && loading ? <LoadingState /> : null}
        {data ? (
          <>
            <DataTable
              testId="fiscal360-recon-table"
              rows={data.rows}
              rowKey={(r) => r.itemKey}
              onRowClick={(r) => (r.subjectType === "PAYMENT_FACT" && r.subjectId ? onOpenPayment(r.subjectId) : undefined)}
              empty="Nenhuma exceção de conciliação no filtro."
              columns={[
                ...(caps.reconcile
                  ? [
                      {
                        key: "sel",
                        header: (
                          <Fiscal360Checkbox
                            label="Marcar os itens desta página"
                            checked={reconPageKeys.length > 0 && reconOnPage === reconPageKeys.length}
                            indeterminate={reconOnPage > 0 && reconOnPage < reconPageKeys.length}
                            onChange={(on) => reconSelection.setMany(reconPageKeys, on)}
                            testId="fiscal360-recon-select-page"
                          />
                        ),
                        render: (r: Fiscal360ReconciliationRow) =>
                          reconSelectable(r) ? (
                            <Fiscal360Checkbox label={`Marcar: ${r.message}`} checked={reconSelection.selected.has(r.itemKey)} onChange={(on) => reconSelection.toggle(r.itemKey, on)} testId="fiscal360-recon-select-row" />
                          ) : null,
                      },
                    ]
                  : []),
                { key: "c", header: "Checagem", render: (r) => (<><b>{FISCAL360_CHECK_LABELS[r.checkType] ?? r.checkType}</b><br /><span className="text-[11px] text-[#6B7280]">{r.message}</span></>) },
                { key: "e", header: "Empresa", render: (r) => fiscal360CompanyLabel(r.companyCnpj) },
                { key: "m", header: "Competência", render: (r) => formatFiscal360Month(r.competenceMonth) },
                { key: "t", header: "Tributo", render: (r) => (r.taxType ? FISCAL360_TAX_LABELS[r.taxType] ?? r.taxType : "—") },
                { key: "x", header: "Esperado", align: "right", render: (r) => money(r.expectedAmount) },
                { key: "a", header: "Encontrado", align: "right", render: (r) => money(r.actualAmount) },
                { key: "d", header: "Diferença", align: "right", render: (r) => money(r.difference) },
                { key: "s", header: "Situação", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
                {
                  key: "act",
                  header: "",
                  render: (r) =>
                    caps.reconcile && r.status !== "OK" && r.status !== "ACCEPTED" ? (
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[#1D4ED8] hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBatch(null);
                          setDecision({ decisionType: "ACCEPT_DIVERGENCE", itemKey: r.itemKey });
                        }}
                      >
                        Aceitar com justificativa
                      </button>
                    ) : null,
                },
              ]}
            />
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        ) : null}
      </Section>
      <Section title="Títulos do AP pendentes de classificação" subtitle="Indício tributário sem confiança suficiente. Não entram no total pago até revisão (o termo “imposto” sozinho nunca classifica).">
        <Fiscal360SearchFields placeholder="Descrição, favorecido, documento, classificação ou nº do AP" amountLabel="Valor" onChange={setApSearch} testId="fiscal360-ap-search" />
        {caps.reclassify ? (
          <Fiscal360SelectionBar
            count={apSelection.selected.size}
            selectingAll={selectingAll}
            onSelectAll={() => void selectAll("ap-titles/pending-keys", buildFiscal360Query(filters, apSearchParams), apSelection)}
            onClear={apSelection.clear}
            testId="fiscal360-ap-selection"
          >
            <ButtonLike variant="quiet" onClick={() => openBatch("AP_CONFIRM_TAX")} testId="fiscal360-ap-batch-confirm">
              Marcados são tributo
            </ButtonLike>
            <ButtonLike onClick={() => openBatch("AP_REJECT_TAX")} testId="fiscal360-ap-batch-reject">
              Marcados não são tributo
            </ButtonLike>
          </Fiscal360SelectionBar>
        ) : null}
        {batch === "AP_CONFIRM_TAX" || batch === "AP_REJECT_TAX" ? (
          <React.Fragment key={batch}>
            <Fiscal360BatchForm decisionType={batch} apExternalIds={[...apSelection.selected].map(Number)} onCancel={() => setBatch(null)} onDone={afterBatch} />
          </React.Fragment>
        ) : null}
        {pending.error ? <ErrorState message={pending.error} /> : null}
        {pending.data ? (
          <>
            <DataTable
              testId="fiscal360-pending-ap"
              rows={pending.data.rows}
              rowKey={(r) => String(r.apExternalId)}
              empty="Nenhum título pendente de classificação."
              columns={[
                ...(caps.reclassify
                  ? [
                      {
                        key: "sel",
                        header: (
                          <Fiscal360Checkbox
                            label="Marcar os títulos desta página"
                            checked={apPageKeys.length > 0 && apOnPage === apPageKeys.length}
                            indeterminate={apOnPage > 0 && apOnPage < apPageKeys.length}
                            onChange={(on) => apSelection.setMany(apPageKeys, on)}
                            testId="fiscal360-ap-select-page"
                          />
                        ),
                        render: (r: Fiscal360ApTitleRow) => (
                          <Fiscal360Checkbox label={`Marcar título ${r.apExternalId}`} checked={apSelection.selected.has(String(r.apExternalId))} onChange={(on) => apSelection.toggle(String(r.apExternalId), on)} testId="fiscal360-ap-select-row" />
                        ),
                      },
                    ]
                  : []),
                { key: "id", header: "AP Nomus", render: (r) => <b>{r.apExternalId}</b> },
                { key: "d", header: "Descrição / favorecido", render: (r) => (<>{r.description ?? "—"}<br /><span className="text-[#6B7280]">{r.personName ?? "—"} · {r.nomusClassification ?? "sem classificação"}</span></>) },
                { key: "e", header: "Empresa", render: (r) => fiscal360CompanyLabel(r.companyCnpj) },
                { key: "v", header: "Vencimento", render: (r) => formatFiscal360Date(r.dueDate) },
                { key: "a", header: "Valor", align: "right", render: (r) => money(r.amountOriginal) },
                { key: "s", header: "Sugestão", render: (r) => (<>{r.suggestedTaxType ? FISCAL360_TAX_LABELS[r.suggestedTaxType] ?? r.suggestedTaxType : "—"}<br /><Badge tone="warn">{r.classificationConfidence}</Badge></>) },
                {
                  key: "act",
                  header: "",
                  render: (r) =>
                    caps.reclassify ? (
                      <div className="flex flex-col gap-1">
                        <ButtonLike variant="quiet" onClick={() => setDecision({ decisionType: "AP_CONFIRM_TAX", apExternalId: r.apExternalId, suggestedTaxType: r.suggestedTaxType })}>
                          É tributo
                        </ButtonLike>
                        <ButtonLike onClick={() => setDecision({ decisionType: "AP_REJECT_TAX", apExternalId: r.apExternalId })}>Não é tributo</ButtonLike>
                      </div>
                    ) : null,
                },
              ]}
            />
            <Pagination page={pending.data.page} pageSize={pending.data.pageSize} total={pending.data.total} onPage={setApPage} />
          </>
        ) : pending.loading ? (
          <LoadingState />
        ) : null}
      </Section>
      <Section title="Regras de vínculo automático">
        <p className="text-[12px] text-[#4B5563]">
          O processador vincula pela chave explícita da guia (título AP informado) ou por decisão manual. Correspondências apenas prováveis (mesma empresa, tributo, competência e valor) não viram pagamento: geram “possível duplicidade” e contam uma única vez. Pagamentos parciais, estornos e cancelamentos impedem conciliação silenciosa. Detalhes em docs/finance/fiscal-intelligence-360-reconciliation.md.
        </p>
      </Section>
    </div>
  );
}
