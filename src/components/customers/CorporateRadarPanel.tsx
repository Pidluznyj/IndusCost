import React, { useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";

type RadarLine = {
  kindLabel?: string;
  relatedCompany: string;
  creditStatusLabel?: string;
  evidence: string;
};

type RadarCard = {
  writes: "NONE";
  formal: RadarLine[];
  review: RadarLine[];
};

type RadarSignal = {
  pairKey: string;
  classification: string;
  patternCodes: string;
  evidenceSummary: string;
  status: string;
  priorityRank: number;
  evaluatedAt: string;
};

export function CorporateRadarCustomerCard({ customerId }: { customerId: string | null }) {
  const [data, setData] = useState<RadarCard | null>(null);
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    fetchJsonOk<RadarCard>(`/api/customers/${customerId}/corporate-radar`)
      .then((card) => {
        if (!cancelled) setData(card);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);
  if (!customerId || !data) return null;
  return (
    <section className="mx-4 mt-3 rounded-lg border border-border bg-card px-3 py-3 text-sm shrink-0" data-testid="corporate-radar-card">
      <h3 className="font-semibold">Empresas relacionadas e possíveis vínculos</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        O radar aponta coincidências. Só o vínculo confirmado entra no crédito. A dívida não é transferida.
      </p>
      {data.formal.length === 0 ? <p className="mt-2 text-xs">Nenhuma relação formal nesta leitura.</p> : null}
      {data.formal.map((line) => (
        <p key={`formal-${line.relatedCompany}`} className="mt-2 text-xs">
          Confirmável · {line.relatedCompany}. {line.evidence}
        </p>
      ))}
      {data.review.length > 0 ? (
        <p className="mt-2 text-xs">Existem possíveis vínculos pendentes de validação.</p>
      ) : null}
      {data.review.map((line) => (
        <p key={`review-${line.relatedCompany}`} className="mt-1 text-xs">
          Revisão · {line.relatedCompany}. {line.evidence}
        </p>
      ))}
    </section>
  );
}

export function CorporateRadarReviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [signals, setSignals] = useState<RadarSignal[]>([]);
  const [persisted, setPersisted] = useState(false);
  const [status, setStatus] = useState("OPEN");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchJsonOk<{ persisted: boolean; signals: RadarSignal[] }>("/api/commercial/corporate-radar")
      .then((payload) => {
        if (cancelled) return;
        setPersisted(payload.persisted);
        setSignals(payload.signals ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setPersisted(false);
          setSignals([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  if (!open) return null;
  const visible = signals.filter((row) => (status === "" ? true : row.status === status));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4" data-testid="corporate-radar-dialog">
      <div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Radar de Relacionamentos</h2>
          <button type="button" className="text-sm" onClick={onClose}>
            Fechar
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Candidato não é grupo confirmado. A ordenação usa a restrição já conhecida e o tipo de evidência, sem recalcular saldo.
        </p>
        <label className="mt-3 block text-xs">
          Situação
          <select className="mt-1 w-full rounded border border-border bg-card px-2 py-1" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="OPEN">Pendentes</option>
            <option value="PROMOTED">Confirmados</option>
            <option value="REJECTED">Rejeitados</option>
            <option value="">Todos</option>
          </select>
        </label>
        {!persisted ? <p className="mt-3 text-sm">A fila persistida ainda não está disponível nesta base. A leitura não grava vínculo.</p> : null}
        <ul className="mt-3 space-y-2">
          {visible.map((row) => (
            <li key={row.pairKey} className="rounded border border-border px-3 py-2 text-xs">
              <span className="font-medium">Prioridade {row.priorityRank}</span> · {row.patternCodes} · {row.status}
              <span className="mt-1 block">{row.evidenceSummary}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
