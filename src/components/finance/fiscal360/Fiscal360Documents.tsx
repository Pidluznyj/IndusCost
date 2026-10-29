import React, { useEffect, useMemo, useState } from "react";
import {
  FISCAL360_OPERATION_CLASSES,
  FISCAL360_OPERATION_LABELS,
  FISCAL360_TAX_LABELS,
  fiscal360CompanyLabel,
  type Fiscal360OperationClass,
} from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { buildFiscal360Query, formatFiscal360Date, formatFiscal360DateTime, type Fiscal360UiFilters } from "@/src/lib/finance/fiscal360/fiscal360Client";
import type { Fiscal360DocumentDetail, Fiscal360DocumentsResponse } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { Badge, Callout, DataTable, Drawer, ErrorState, KeyValue, KpiCard, KpiGrid, LoadingState, Pagination, Section, money, statusTone } from "./Fiscal360Shared";
import { useFiscal360Resource } from "./useFiscal360Resource";

export function operationLabel(op: string): string {
  return FISCAL360_OPERATION_LABELS[op as Fiscal360OperationClass] ?? op;
}

export function Fiscal360Documents({ filters, refreshKey, onOpenDocument }: { filters: Fiscal360UiFilters; refreshKey: number; onOpenDocument: (id: string) => void }) {
  const [operationClass, setOperationClass] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters, operationClass, status, q]);
  const query = useMemo(() => buildFiscal360Query(filters, { operationClass, status, q, page, pageSize: 50 }), [filters, operationClass, status, q, page]);
  const { data, loading, error } = useFiscal360Resource<Fiscal360DocumentsResponse>("documents", query, refreshKey);
  const by = data?.byOperation ?? [];
  const sum = (pred: (b: (typeof by)[number]) => boolean, key: "vNF" | "officialRevenue" | "highlighted") => by.filter(pred).reduce((s, b) => s + b[key], 0);
  const select = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";
  return (
    <div className="space-y-4" data-testid="fiscal360-documents">
      <KpiGrid>
        <KpiCard label="Movimentação documental" value={money(sum((b) => b.fiscalStatus === "AUTHORIZED", "vNF"))} hint="vNF das notas autorizadas no filtro" source="NomusNfe (XML persistido)" />
        <KpiCard label="Faturamento externo elegível" value={money(sum(() => true, "officialRevenue"))} hint="Regra oficial: autorizada + venda de mercado + MARKET_REVENUE" source="fiscalNfeWhereSql" tone="good" />
        <KpiCard label="Operações internas (eliminadas)" value={money(sum((b) => b.operationClass === "INTERCOMPANY" && b.fiscalStatus === "AUTHORIZED", "vNF"))} hint="Fora do faturamento consolidado; tributos permanecem por CNPJ" />
        <KpiCard label="Documentos no filtro" value={(data?.total ?? 0).toLocaleString("pt-BR")} hint={`${by.filter((b) => b.fiscalStatus === "CANCELLED").reduce((s, b) => s + b.count, 0)} cancelado(s)`} />
      </KpiGrid>
      <Callout tone="warn">NFS-e: não há fonte operacional integrada. Serviços (inclusive Lazarios ↔ Koppetel) não aparecem aqui até existir integração confiável — nenhum documento é criado artificialmente.</Callout>
      <Section
        title="Documentos fiscais e classificação"
        subtitle="Valores extraídos do XML persistido. Movimentação documental ≠ faturamento elegível ≠ receita da DRE."
        actions={
          <div className="flex flex-wrap gap-2">
            <select className={select} value={operationClass} onChange={(e) => setOperationClass(e.target.value)} aria-label="Classificação" data-testid="fiscal360-docs-operation">
              <option value="">Todas as operações</option>
              {FISCAL360_OPERATION_CLASSES.map((op) => (
                <option key={op} value={op}>
                  {operationLabel(op)}
                </option>
              ))}
            </select>
            <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
              <option value="">Todas as situações</option>
              <option value="AUTHORIZED">Autorizadas</option>
              <option value="CANCELLED">Canceladas</option>
              <option value="OTHER">Outras</option>
            </select>
            <input className={`${select} w-40`} placeholder="Número, chave…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar documento" />
          </div>
        }
      >
        {error ? <ErrorState message={error} /> : null}
        {!data && loading ? <LoadingState /> : null}
        {data ? (
          <>
            {by.length ? (
              <div className="mb-3 flex flex-wrap gap-2" data-testid="fiscal360-docs-by-operation">
                {by
                  .filter((b) => b.fiscalStatus === "AUTHORIZED")
                  .map((b) => (
                    <React.Fragment key={`${b.operationClass}-${b.fiscalStatus}`}>
                      <Badge tone={b.operationClass === "MARKET_SALE" ? "good" : b.operationClass === "INTERCOMPANY" ? "info" : "neutral"}>
                        {operationLabel(b.operationClass)}: {b.count} · {money(b.vNF)}
                      </Badge>
                    </React.Fragment>
                  ))}
              </div>
            ) : null}
            <DataTable
              testId="fiscal360-docs-table"
              rows={data.rows}
              rowKey={(r) => r.nomusNfeId}
              onRowClick={(r) => onOpenDocument(r.nomusNfeId)}
              empty="Nenhum documento materializado no filtro."
              columns={[
                { key: "n", header: "Documento", render: (r) => (<><b>NF-e {r.numero ?? r.nomusExternalId}</b>{r.serie ? <span className="text-[#6B7280]"> / {r.serie}</span> : null}<br /><span className="text-[#6B7280]">{formatFiscal360Date(r.issueDate)}</span></>) },
                { key: "e", header: "Emitente", render: (r) => fiscal360CompanyLabel(r.companyCnpj) },
                { key: "d", header: "Destinatário", render: (r) => (r.recipientGroupCnpj ? <b>{fiscal360CompanyLabel(r.recipientGroupCnpj)}</b> : r.recipientCnpj ?? "—") },
                { key: "c", header: "Classificação", render: (r) => <Badge tone={r.operationClass === "MARKET_SALE" ? "good" : r.operationClass === "INTERCOMPANY" ? "info" : "neutral"}>{operationLabel(r.operationClass)}</Badge> },
                { key: "v", header: "vNF", align: "right", render: (r) => money(r.vNF) },
                { key: "t", header: "Tributos destacados", align: "right", render: (r) => money(r.highlightedTaxTotal) },
                { key: "x", header: "XML", render: (r) => <Badge tone={r.xmlStatus === "XML" ? "good" : "warn"}>{r.xmlStatus}</Badge> },
                { key: "s", header: "Situação", render: (r) => <Badge tone={statusTone(r.fiscalStatus)}>{r.fiscalStatus === "AUTHORIZED" ? "Autorizada" : r.fiscalStatus === "CANCELLED" ? "Cancelada" : "Outra"}</Badge> },
              ]}
            />
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        ) : null}
      </Section>
    </div>
  );
}

export function Fiscal360DocumentDrawer({ nomusNfeId, onClose, refreshKey }: { nomusNfeId: string | null; onClose: () => void; refreshKey: number }) {
  const { data, loading, error } = useFiscal360Resource<Fiscal360DocumentDetail>(nomusNfeId ? `documents/${encodeURIComponent(nomusNfeId)}` : null, "", refreshKey);
  const d = data?.document;
  return (
    <Drawer open={Boolean(nomusNfeId)} title={d ? `NF-e ${d.numero ?? d.nomusExternalId}` : "Documento fiscal"} subtitle="Origem documental e classificação da operação" onClose={onClose}>
      {error ? <ErrorState message={error} /> : null}
      {!data && loading ? <LoadingState /> : null}
      {d && data ? (
        <>
          <KeyValue
            items={[
              ["Emitente", fiscal360CompanyLabel(d.companyCnpj)],
              ["Destinatário", d.recipientGroupCnpj ? `${fiscal360CompanyLabel(d.recipientGroupCnpj)} (grupo)` : d.recipientCnpj ?? "—"],
              ["Emissão", formatFiscal360Date(d.issueDate)],
              ["Natureza", d.natOp ?? "—"],
              ["Classificação", operationLabel(d.operationClass)],
              ["Faturamento oficial", d.isOfficialBilling ? `Sim · ${money(d.officialRevenueAmount)}` : "Não"],
              ["vNF", money(d.vNF)],
              ["Chave", <span key="k" className="break-all text-[11px]">{d.chave ?? "—"}</span>],
            ]}
          />
          <Section title="Tributos do cabeçalho (XML)">
            <DataTable
              rows={d.taxes}
              rowKey={(t) => t.taxType}
              empty="Sem tributos destacados no cabeçalho."
              columns={[
                { key: "t", header: "Tributo", render: (t) => FISCAL360_TAX_LABELS[t.taxType] ?? t.taxType },
                { key: "e", header: "Efeito", render: (t) => <Badge tone={t.effect === "DEBIT" ? "info" : "neutral"}>{t.effect}</Badge> },
                { key: "v", header: "Valor", align: "right", render: (t) => money(t.amount) },
              ]}
            />
            <p className="mt-2 text-[10px] text-[#9CA3AF]">DEBIT = destacado efetivo · ST/desonerado/informativo (IBS/CBS) nunca somados ao destacado. Destacado não é imposto pago.</p>
          </Section>
          <Section title="Tributos por item" subtitle={data.itemsTruncated ? "Exibindo os primeiros 500 registros." : undefined}>
            <DataTable
              rows={data.items}
              rowKey={(i) => `${i.itemNumber}-${i.taxType}`}
              empty="Sem linhas por item no XML persistido."
              columns={[
                { key: "n", header: "Item", render: (i) => i.itemNumber ?? "—" },
                { key: "t", header: "Tributo", render: (i) => i.taxType },
                { key: "c", header: "CFOP / NCM", render: (i) => `${i.cfop ?? "—"} / ${i.ncm ?? "—"}` },
                { key: "s", header: "CST/CSOSN", render: (i) => i.cst ?? i.csosn ?? "—" },
                { key: "b", header: "Base", align: "right", render: (i) => money(i.baseAmount) },
                { key: "r", header: "Alíq.", align: "right", render: (i) => (i.rate == null ? "—" : `${i.rate.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`) },
                { key: "v", header: "Valor", align: "right", render: (i) => money(i.amount) },
              ]}
            />
          </Section>
          {data.issues.length ? (
            <Section title="Pendências de qualidade">
              <ul className="space-y-1 text-[11px]">
                {data.issues.map((i) => (
                  <li key={i.id}>
                    <Badge tone={statusTone(i.severity)}>{i.severity}</Badge> {i.message} <span className="text-[#9CA3AF]">({i.status})</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <p className="text-[10px] text-[#9CA3AF]">
            Fonte: NomusNfe {d.nomusExternalId} + resumo XML ({String(d.parserVersion ?? "sem parser")}) · materializado em {formatFiscal360DateTime(String(d.materializedAt ?? ""))} · regra {String(d.ruleVersion ?? "")}
          </p>
        </>
      ) : null}
    </Drawer>
  );
}
