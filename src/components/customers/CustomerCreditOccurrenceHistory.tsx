import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  COMMERCIAL_CREDIT_OCCURRENCE_KINDS,
  COMMERCIAL_CREDIT_OCCURRENCE_KIND_LABEL,
  type CommercialCreditOccurrenceView,
} from "@/src/lib/commercial/commercialCreditOccurrence";

const MANAGE_PERMISSIONS = [
  "commercial.credit.exception.grant",
  "commercial.credit.exception.grant.board",
];

type EvidenceDraft = { fileName: string; mimeType: string; contentBase64: string };

async function readEvidence(file: File): Promise<EvidenceDraft> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    fileName: file.name,
    mimeType: file.type,
    contentBase64: btoa(binary),
  };
}

export function CustomerCreditOccurrenceHistoryView({
  occurrences,
  canManage,
  loading,
  error,
  pending,
  onRefresh,
  onCreate,
  onRegularize,
  onWithdraw,
}: {
  occurrences: readonly CommercialCreditOccurrenceView[];
  canManage: boolean;
  loading?: boolean;
  error?: string | null;
  pending?: boolean;
  onRefresh?: () => void;
  onCreate?: (input: {
    kind: string;
    titleExternalId: number | null;
    occurredAt: string;
    justification: string;
    evidences: EvidenceDraft[];
  }) => Promise<void>;
  onRegularize?: (occurrenceId: string, justification: string, evidences: EvidenceDraft[]) => Promise<void>;
  onWithdraw?: (occurrenceId: string, justification: string, evidences: EvidenceDraft[]) => Promise<void>;
}) {
  const [kind, setKind] = useState<string>("PROTEST_FORWARDED");
  const [titleExternalId, setTitleExternalId] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [justification, setJustification] = useState("");
  const [files, setFiles] = useState<EvidenceDraft[]>([]);
  const [closeFor, setCloseFor] = useState<string | null>(null);
  const [closeMode, setCloseMode] = useState<"REGULARIZATION" | "PROTEST_WITHDRAWN">("REGULARIZATION");
  const [closeJustification, setCloseJustification] = useState("");
  const [closeFiles, setCloseFiles] = useState<EvidenceDraft[]>([]);

  return (
    <section className="rounded-lg border p-3 space-y-3 text-sm min-w-0" data-testid="credit-occurrence-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Ocorrências de crédito</h3>
        {onRefresh ? (
          <button type="button" className="text-xs underline" onClick={onRefresh} data-testid="credit-occurrence-refresh">
            Atualizar histórico
          </button>
        ) : null}
      </div>
      {loading ? <p data-testid="credit-occurrence-loading">Carregando ocorrências…</p> : null}
      {error ? (
        <p className="text-red-700" data-testid="credit-occurrence-error">
          {error}
        </p>
      ) : null}
      {occurrences.length === 0 && !loading ? <p>Sem ocorrência registrada.</p> : null}
      <ul className="space-y-2">
        {occurrences.map((row) => (
          <li key={row.id} className="rounded-md border p-2 break-words" data-testid={`credit-occurrence-${row.kind}`}>
            <p className="font-medium">
              {row.kindLabel}
              {row.blocksCredit ? " · Pendência crítica de crédito" : ""}
            </p>
            <p className="text-xs text-slate-600">
              {row.occurredAtLabel} · {row.statusLabel} · {row.originLabel}
              {row.titleReference ? ` · ${row.titleReference}` : ""}
            </p>
            <p>{row.justification}</p>
            {row.evidenceFileNames.length > 0 ? (
              <p className="text-xs">Comprovantes: {row.evidenceFileNames.join(", ")}</p>
            ) : null}
            {canManage && row.blocksCredit ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => {
                    setCloseFor(row.id);
                    setCloseMode("REGULARIZATION");
                  }}
                >
                  Regularizar
                </button>
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => {
                    setCloseFor(row.id);
                    setCloseMode("PROTEST_WITHDRAWN");
                  }}
                >
                  Retirar protesto
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage && closeFor ? (
        <form
          className="space-y-2 rounded-md border p-2"
          data-testid="credit-occurrence-close"
          onSubmit={(event) => {
            event.preventDefault();
            const action = closeMode === "REGULARIZATION" ? onRegularize : onWithdraw;
            if (!action) return;
            void action(closeFor, closeJustification, closeFiles)
              .then(() => {
                setCloseFor(null);
                setCloseJustification("");
                setCloseFiles([]);
              })
              .catch(() => undefined);
          }}
        >
          <p className="font-medium">{closeMode === "REGULARIZATION" ? "Regularização" : "Retirada do protesto"}</p>
          <textarea
            className="w-full rounded border px-2 py-1"
            value={closeJustification}
            onChange={(event) => setCloseJustification(event.target.value)}
            placeholder="Justificativa e autorização"
            required
          />
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void readEvidence(file).then((draft) => setCloseFiles([draft]));
            }}
          />
          <button type="submit" className="rounded border px-2 py-1" disabled={pending}>
            Confirmar encerramento
          </button>
        </form>
      ) : null}
      {canManage && onCreate ? (
        <form
          className="space-y-2"
          data-testid="credit-occurrence-form"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = titleExternalId.trim() ? Number(titleExternalId) : null;
            void onCreate({
              kind,
              titleExternalId: parsed != null && Number.isInteger(parsed) ? parsed : null,
              occurredAt,
              justification,
              evidences: files,
            })
              .then(() => {
                setJustification("");
                setFiles([]);
              })
              .catch(() => undefined);
          }}
        >
          <p className="font-medium">Registrar ocorrência</p>
          <label className="block space-y-1">
            <span className="text-xs">Tipo</span>
            <select className="w-full rounded border px-2 py-1" value={kind} onChange={(event) => setKind(event.target.value)}>
              {COMMERCIAL_CREDIT_OCCURRENCE_KINDS.filter(
                (item) => item !== "REGULARIZATION" && item !== "PROTEST_WITHDRAWN"
              ).map((item) => (
                <option key={item} value={item}>
                  {COMMERCIAL_CREDIT_OCCURRENCE_KIND_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs">Título oficial</span>
            <input
              className="w-full rounded border px-2 py-1"
              inputMode="numeric"
              value={titleExternalId}
              onChange={(event) => setTitleExternalId(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs">Data</span>
            <input
              type="date"
              className="w-full rounded border px-2 py-1"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
              required
            />
          </label>
          <textarea
            className="w-full rounded border px-2 py-1"
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            placeholder="Justificativa"
            required
          />
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void readEvidence(file).then((draft) => setFiles([draft]));
            }}
          />
          <button type="submit" className="rounded border px-2 py-1" disabled={pending}>
            Salvar ocorrência
          </button>
        </form>
      ) : null}
    </section>
  );
}

export function CustomerCreditOccurrenceHistory({ customerId }: { customerId: string }) {
  const auth = useAuth();
  const assigned = auth.authUser?.permissions ?? [];
  const canManage = MANAGE_PERMISSIONS.some((key) => assigned.includes(key));
  const [occurrences, setOccurrences] = useState<CommercialCreditOccurrenceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<{ occurrences: CommercialCreditOccurrenceView[] }>(
        `/api/customers/${customerId}/credit-occurrences`
      );
      setOccurrences(payload.occurrences ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as ocorrências.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, body: unknown) {
    setPending(true);
    setError(null);
    try {
      await fetchJsonOk(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar a ocorrência.");
      throw cause;
    } finally {
      setPending(false);
    }
  }

  return (
    <CustomerCreditOccurrenceHistoryView
      occurrences={occurrences}
      canManage={canManage}
      loading={loading}
      error={error}
      pending={pending}
      onRefresh={() => void load()}
      onCreate={
        canManage
          ? (input) =>
              send(`/api/customers/${customerId}/credit-occurrences`, input)
          : undefined
      }
      onRegularize={
        canManage
          ? (occurrenceId, justification, evidences) =>
              send(`/api/customers/${customerId}/credit-occurrences/${occurrenceId}/regularize`, {
                justification,
                evidences,
              })
          : undefined
      }
      onWithdraw={
        canManage
          ? (occurrenceId, justification, evidences) =>
              send(`/api/customers/${customerId}/credit-occurrences/${occurrenceId}/withdraw`, {
                justification,
                evidences,
              })
          : undefined
      }
    />
  );
}
