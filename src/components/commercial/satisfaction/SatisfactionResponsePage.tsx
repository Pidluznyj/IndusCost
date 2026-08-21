/**
 * Resposta individual do cliente.
 *
 * Mostra cada pergunta com a nota E o rótulo textual (1 Ruim … 5 Excelente) —
 * quem lê não precisa memorizar a escala. O histórico do cliente compara
 * SEMPRE por `question.code`, nunca por posição na lista.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { formatDate, formatRating, satisfactionApi } from "./satisfactionApi.js";

const RATING_LABELS: Record<number, string> = {
  1: "Ruim",
  2: "Regular",
  3: "Bom",
  4: "Ótimo",
  5: "Excelente",
};

function ratingTone(value: number): string {
  if (value <= 2) return "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]";
  if (value === 3) return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
  return "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]";
}

export function SatisfactionResponsePage() {
  const { responseId = "" } = useParams();
  const [data, setData] = useState<{ response: any; history: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await satisfactionApi.getResponse(responseId);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar a resposta.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [responseId]);

  /** Agrupa o histórico por código de pergunta — comparação semântica. */
  const historyByCode = useMemo(() => {
    const map = new Map<string, Array<{ campaignName: string; rating: number }>>();
    for (const entry of data?.history ?? []) {
      const list = map.get(entry.questionCode) ?? [];
      list.push({ campaignName: entry.campaignName, rating: entry.rating });
      map.set(entry.questionCode, list);
    }
    return map;
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-[#F1F5F9]" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-[14px] text-[#B91C1C]">
        {error ?? "Resposta não encontrada."}
      </div>
    );
  }

  const response = data.response;

  return (
    <div className="space-y-4">
      <Link
        to="/commercial/satisfaction"
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#1D4ED8] hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para Satisfação
      </Link>

      <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold text-[#0F172A]">{response.customerName}</h2>
            <p className="text-[13px] text-[#64748B]">
              {response.campaign?.name} · respondido por {response.respondentName ?? "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
              Nota média
            </p>
            <p className="text-[26px] font-bold text-[#0F172A]">
              {formatRating(response.averageRating)}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-[#64748B]">Data da resposta</dt>
            <dd className="font-medium text-[#0F172A]">
              {formatDate(response.originalSubmittedAt ?? response.submittedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-[#64748B]">Responsável comercial</dt>
            <dd className="font-medium text-[#0F172A]">
              {response.responsibleCommercialName ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[#64748B]">Origem</dt>
            <dd className="font-medium text-[#0F172A]">
              {response.source === "INDIVIDUAL_LINK"
                ? "Link individual"
                : response.source === "GENERAL_LINK"
                  ? "Link geral"
                  : "Importação histórica"}
            </dd>
          </div>
        </dl>

        {response.alertLevel === "CRITICAL" ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Cliente em alerta: há nota {response.lowestRating} nesta resposta. Vale um contato
              do responsável comercial.
            </span>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <div className="border-b border-[#E2E8F0] px-4 py-3">
          <h3 className="text-[14px] font-semibold text-[#0F172A]">Respostas</h3>
        </div>
        <ul className="divide-y divide-[#F1F5F9]">
          {(response.answers ?? []).map((answer: any) => {
            const history = historyByCode.get(answer.questionCode) ?? [];
            return (
              <li key={answer.questionCode} className="px-4 py-3">
                <p className="text-[14px] font-medium text-[#0F172A]">{answer.label}</p>
                {answer.ratingValue != null ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] font-semibold ${ratingTone(answer.ratingValue)}`}
                    >
                      <span className="text-[15px]">{answer.ratingValue}</span>
                      {/* Rótulo junto do número: significado nunca só por cor. */}
                      <span>{RATING_LABELS[answer.ratingValue]}</span>
                    </span>
                    {history.length > 1 ? (
                      <span className="text-[12px] text-[#94A3B8]">
                        Histórico: {history.map((h) => h.rating).join(" → ")}
                      </span>
                    ) : null}
                  </div>
                ) : answer.textValue ? (
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-[#334155]">
                    {answer.textValue}
                  </p>
                ) : answer.dateValue ? (
                  <p className="mt-1 text-[13px] text-[#334155]">{formatDate(answer.dateValue)}</p>
                ) : (
                  <p className="mt-1 text-[13px] italic text-[#94A3B8]">Não respondido</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
