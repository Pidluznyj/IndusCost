import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Power,
  QrCode,
  RefreshCw,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFleetApiError } from "@/src/components/fleet/fleetUi";
import {
  buildPublicReservationUrl,
  resolveClientPublicReservationBaseUrl,
} from "@/src/lib/fleetPublicReservationLink";

type LinkInfo = {
  enabled: boolean;
  token: string | null;
  baseUrl: string | null;
  configuredBaseUrl: string | null;
  url: string | null;
  needsBaseUrlConfig?: boolean;
};

type Props = {
  canManage: boolean;
};

export function FleetPublicReservationQrPanel({ canManage }: Props) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareUrl = useMemo(() => {
    if (!info?.token) return null;
    const clientBase = resolveClientPublicReservationBaseUrl(
      info.baseUrl ?? info.configuredBaseUrl,
      window.location.origin
    );
    if (info.url && !info.url.startsWith("/")) return info.url;
    if (clientBase) return buildPublicReservationUrl(info.token, clientBase);
    return info.url;
  }, [info]);

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
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar. Copie manualmente o link.");
    }
  };

  const openUrl = () => {
    if (!shareUrl) return;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
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

  const toggleEnabled = async () => {
    if (!canManage || !info) return;
    setToggling(true);
    setError(null);
    try {
      const next = !info.enabled;
      await fetchJsonOk("/api/fleet/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: [{ key: "publicReservationEnabled", value: next ? "true" : "false" }],
        }),
      });
      await load();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao alterar status."));
    } finally {
      setToggling(false);
    }
  };

  const qrSrc = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(shareUrl)}`
    : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-slate-600" />
        <h3 className="font-semibold text-slate-900">Reserva pública / QR Code</h3>
      </div>
      <p className="text-sm text-slate-600">
        Envie o link abaixo para colaboradores na rede interna ou VPN. Ao abrir, a primeira tela será o
        campo de CPF — sem necessidade de login no ERP.
      </p>
      <p className="text-xs text-slate-500">
        Configure <strong>publicReservationBaseUrl</strong> nos parâmetros (ex.:{" "}
        <code className="text-slate-700">http://192.168.100.5:3000</code>) para que o link copiado não
        use <code>127.0.0.1</code>.
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
            {info?.baseUrl && (
              <span className="text-xs text-slate-500">Base: {info.baseUrl}</span>
            )}
            {info?.needsBaseUrlConfig && (
              <span className="text-amber-700 text-xs">
                Defina publicReservationBaseUrl para gerar link compartilhável.
              </span>
            )}
            {!info?.token && (
              <span className="text-amber-700">Token ainda não gerado.</span>
            )}
          </div>

          {canManage && (
            <button
              type="button"
              disabled={toggling}
              onClick={() => void toggleEnabled()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {toggling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              {info?.enabled ? "Desativar solicitação pública" : "Ativar solicitação pública"}
            </button>
          )}

          {shareUrl ? (
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {qrSrc && (
                <img
                  src={qrSrc}
                  alt="QR Code do link público de reserva"
                  className="rounded-lg border border-slate-200 bg-white p-2"
                  width={220}
                  height={220}
                />
              )}
              <div className="flex-1 space-y-2 min-w-0">
                <p className="text-sm font-medium text-slate-800">Link para enviar aos usuários:</p>
                <div className="flex items-start gap-2">
                  <Link2 className="h-4 w-4 mt-1 shrink-0 text-slate-500" />
                  <code className="text-xs break-all text-slate-800 bg-slate-50 rounded px-2 py-1 block">
                    {shareUrl}
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
                  <button
                    type="button"
                    onClick={openUrl}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir link
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
                  O QR Code aponta para o mesmo link. Funciona na rede interna/VPN — não expõe o sistema
                  à internet externa.
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
