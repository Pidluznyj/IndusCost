import React, { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Loader2, QrCode, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFleetApiError } from "@/src/components/fleet/fleetUi";

type LinkInfo = {
  enabled: boolean;
  token: string | null;
  url: string | null;
};

type Props = {
  canManage: boolean;
};

export function FleetPublicReservationQrPanel({ canManage }: Props) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<LinkInfo>("/api/fleet/public-reservation/link");
      setInfo(data);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar link público."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copyUrl = async () => {
    if (!info?.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar. Copie manualmente o link.");
    }
  };

  const regenerate = async () => {
    if (!canManage) return;
    if (!window.confirm("Gerar novo token invalidará QR Codes e links anteriores. Continuar?")) return;
    setRegenerating(true);
    setError(null);
    try {
      await fetchJsonOk("/api/fleet/public-reservation/regenerate-token", { method: "POST" });
      await load();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao regenerar token."));
    } finally {
      setRegenerating(false);
    }
  };

  const qrSrc = info?.url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(info.url)}`
    : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-slate-600" />
        <h3 className="font-semibold text-slate-900">Link público / QR Code</h3>
      </div>
      <p className="text-sm text-slate-600">
        Colaboradores podem escanear o QR Code ou abrir o link para solicitar reserva sem entrar no ERP.
        Ative em <strong>publicReservationEnabled</strong> nos parâmetros abaixo e salve.
      </p>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={
                info?.enabled
                  ? "rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800"
                  : "rounded-full bg-slate-100 px-2 py-0.5 text-slate-600"
              }
            >
              {info?.enabled ? "Ativo" : "Inativo"}
            </span>
            {!info?.token && (
              <span className="text-amber-700">Token ainda não gerado — use Regenerar token.</span>
            )}
          </div>

          {info?.url ? (
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {qrSrc && (
                <img
                  src={qrSrc}
                  alt="QR Code da URL pública de reserva"
                  className="rounded-lg border border-slate-200 bg-white p-2"
                  width={220}
                  height={220}
                />
              )}
              <div className="flex-1 space-y-2 min-w-0">
                <div className="flex items-start gap-2">
                  <Link2 className="h-4 w-4 mt-1 shrink-0 text-slate-500" />
                  <code className="text-xs break-all text-slate-800 bg-slate-50 rounded px-2 py-1 block">
                    {info.url}
                  </code>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void copyUrl()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <Copy className="h-4 w-4" />
                    {copied ? "Copiado!" : "Copiar link"}
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      disabled={regenerating}
                      onClick={() => void regenerate()}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      {regenerating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Regenerar token
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Imprima o QR Code em cartaz na recepção ou área comum. O link não expõe dados internos.
                </p>
              </div>
            </div>
          ) : (
            canManage && (
              <button
                type="button"
                disabled={regenerating}
                onClick={() => void regenerate()}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Gerar token e link
              </button>
            )
          )}
        </>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
