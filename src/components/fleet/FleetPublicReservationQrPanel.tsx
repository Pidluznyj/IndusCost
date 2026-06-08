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
import { copyTextToClipboard } from "@/src/lib/clipboardCopy";
import { formatFleetApiError } from "@/src/components/fleet/fleetUi";
import {
  buildPublicReservationShareLinks,
  resolveClientPublicReservationBaseUrl,
} from "@/src/lib/fleetPublicReservationLink";

type LinkInfo = {
  enabled: boolean;
  token: string | null;
  baseUrl: string | null;
  configuredBaseUrl: string | null;
  slug?: string | null;
  shortUrl?: string | null;
  shortPath?: string | null;
  technicalUrl?: string | null;
  technicalPath?: string | null;
  url: string | null;
  shareUrl?: string | null;
  needsBaseUrlConfig?: boolean;
};

type Props = {
  canManage: boolean;
};

type CopyTarget = "short" | "technical" | null;

export function FleetPublicReservationQrPanel({ canManage }: Props) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const clientBase = useMemo(() => {
    if (!info) return null;
    return resolveClientPublicReservationBaseUrl(
      info.baseUrl ?? info.configuredBaseUrl,
      window.location.origin
    );
  }, [info]);

  const links = useMemo(() => {
    if (!info?.token) return null;
    const built = buildPublicReservationShareLinks({
      token: info.token,
      baseUrl: clientBase,
      slug: info.slug,
    });
    if (info.shortUrl && info.shortUrl.startsWith("http")) {
      return { ...built, shortUrl: info.shortUrl, shareUrl: info.shortUrl || built.shareUrl };
    }
    if (info.technicalUrl && info.technicalUrl.startsWith("http")) {
      return {
        ...built,
        technicalUrl: info.technicalUrl,
        shareUrl: built.shortUrl || info.technicalUrl,
      };
    }
    if (clientBase) {
      return built;
    }
    return {
      ...built,
      shortUrl: info.shortPath ?? built.shortPath,
      technicalUrl: info.technicalPath ?? built.technicalPath,
      shareUrl: info.shortPath ?? info.technicalPath ?? built.sharePath,
    };
  }, [info, clientBase]);

  const qrUrl = links?.shortUrl || links?.technicalUrl || links?.shareUrl;

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

  const copyLink = async (text: string | null | undefined, target: CopyTarget) => {
    if (!text) {
      setCopyError("Nenhum link disponível para copiar.");
      return;
    }
    setCopyError(null);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(target);
      window.setTimeout(() => setCopied(null), 2000);
      return;
    }
    setCopyError(
      "Não foi possível copiar automaticamente. Selecione e copie o link manualmente."
    );
  };

  const openUrl = (text: string | null | undefined) => {
    if (!text) return;
    window.open(text, "_blank", "noopener,noreferrer");
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

  const qrSrc = qrUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrUrl)}`
    : null;

  const hasShareableUrl = Boolean(links?.shortUrl || links?.technicalUrl);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-slate-600" />
        <h3 className="font-semibold text-slate-900">Reserva pública / QR Code</h3>
      </div>
      <p className="text-sm text-slate-600">
        Envie o <strong>link curto</strong> para colaboradores na rede interna ou VPN. Ao abrir, a
        primeira tela será o campo de CPF — sem necessidade de login no ERP.
      </p>
      <p className="text-xs text-slate-500">
        Configure <strong>publicReservationBaseUrl</strong> (ex.:{" "}
        <code className="text-slate-700">http://192.168.100.5:3000</code>) e{" "}
        <strong>publicReservationSlug</strong> (ex.: <code>reservar-carro</code>) nos parâmetros
        abaixo.
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
            {info?.baseUrl && <span className="text-xs text-slate-500">Base: {info.baseUrl}</span>}
            {info?.slug && (
              <span className="text-xs text-slate-500">Slug: /{info.slug}</span>
            )}
            {info?.needsBaseUrlConfig && (
              <span className="text-amber-700 text-xs">
                Defina publicReservationBaseUrl para gerar link compartilhável.
              </span>
            )}
            {!info?.token && <span className="text-amber-700">Token ainda não gerado.</span>}
          </div>

          {canManage && (
            <button
              type="button"
              disabled={toggling}
              onClick={() => void toggleEnabled()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {info?.enabled ? "Desativar solicitação pública" : "Ativar solicitação pública"}
            </button>
          )}

          {hasShareableUrl ? (
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {qrSrc && (
                <div className="space-y-2">
                  <img
                    src={qrSrc}
                    alt="QR Code do link público de reserva"
                    className="rounded-lg border border-slate-200 bg-white p-2"
                    width={220}
                    height={220}
                  />
                  <p className="text-xs text-slate-500 max-w-[220px]">
                    Este QR Code abre a tela de CPF sem login. Funciona somente na rede interna/VPN.
                  </p>
                </div>
              )}
              <div className="flex-1 space-y-4 min-w-0">
                {links?.shortUrl && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-800">Link curto para enviar:</p>
                    <div className="flex items-start gap-2">
                      <Link2 className="h-4 w-4 mt-1 shrink-0 text-emerald-600" />
                      <code className="text-xs break-all text-slate-800 bg-emerald-50 rounded px-2 py-1 block">
                        {links.shortUrl}
                      </code>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copyLink(links.shortUrl, "short")}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      >
                        <Copy className="h-4 w-4" />
                        {copied === "short" ? "Link copiado." : "Copiar link curto"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openUrl(links.shortUrl)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Abrir link curto
                      </button>
                    </div>
                  </div>
                )}

                {links?.technicalUrl && (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <p className="text-sm font-medium text-slate-700">Link técnico (avançado):</p>
                    <div className="flex items-start gap-2">
                      <Link2 className="h-4 w-4 mt-1 shrink-0 text-slate-500" />
                      <code className="text-xs break-all text-slate-700 bg-slate-50 rounded px-2 py-1 block">
                        {links.technicalUrl}
                      </code>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copyLink(links.technicalUrl, "technical")}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      >
                        <Copy className="h-4 w-4" />
                        {copied === "technical" ? "Link copiado." : "Copiar link técnico"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openUrl(links.technicalUrl)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Abrir link técnico
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
                  </div>
                )}

                {!links?.shortUrl && links?.technicalUrl && (
                  <p className="text-xs text-amber-700">
                    Configure <strong>publicReservationSlug</strong> nos parâmetros para habilitar o
                    link curto.
                  </p>
                )}
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
                {regenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Gerar token e link
              </button>
            )
          )}
        </>
      )}

      {copyError && <p className="text-sm text-amber-800">{copyError}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
