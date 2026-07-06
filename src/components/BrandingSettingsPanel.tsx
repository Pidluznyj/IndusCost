import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ImagePlus, Trash2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { DEFAULT_BRANDING } from "@/src/types/branding";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/svg+xml";

type ImageFieldKey =
  | "systemCompactLogoDataUrl"
  | "systemExpandedLogoDataUrl"
  | "proposalLogoDataUrl"
  | "darkLogoDataUrl"
  | "faviconDataUrl"
  | "proposalCoverDataUrl"
  | "proposalSideImageDataUrl"
  | "watermarkDataUrl";

function readFileAsDataUrl(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".ai")) {
    return Promise.reject(new Error("AI"));
  }
  if (file.size > MAX_FILE_BYTES) {
    return Promise.reject(new Error("SIZE"));
  }
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      if (typeof fr.result === "string") resolve(fr.result);
      else reject(new Error("READ"));
    };
    fr.onerror = () => reject(new Error("READ"));
    fr.readAsDataURL(file);
  });
}

type ImageSlotProps = {
  label: string;
  help: string;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
};

function ImageSlot({ label, help, value, onChange, disabled }: ImageSlotProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handlePick = () => {
    inputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onChange(dataUrl);
    } catch (err) {
      if (err instanceof Error && err.message === "AI") {
        alert("Arquivos .AI devem ser exportados para PNG ou SVG antes do envio.");
        return;
      }
      if (err instanceof Error && err.message === "SIZE") {
        alert("Imagem muito grande. Use um arquivo de até 5 MB.");
        return;
      }
      alert("Não foi possível ler a imagem. Tente outro arquivo.");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div>
        <p className="text-sm font-bold text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{help}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "flex h-24 w-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 overflow-hidden",
            value ? "border-solid" : ""
          )}
        >
          {value ? (
            <img src={value} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground px-2 text-center">Sem imagem</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            disabled={disabled}
            onChange={handleFile}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={handlePick}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50"
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            Selecionar imagem
          </button>
          <button
            type="button"
            disabled={disabled || !value}
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Remover
          </button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        PNG, JPG, JPEG, WebP ou SVG · até 5 MB. Não envie arquivos .AI.
      </p>
    </div>
  );
}

export function BrandingSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings");
      setForm({
        ...DEFAULT_BRANDING,
        ...data,
        companyName: typeof data.companyName === "string" && data.companyName.trim() ? data.companyName.trim() : DEFAULT_BRANDING.companyName,
        slogan: typeof data.slogan === "string" ? data.slogan : DEFAULT_BRANDING.slogan,
        primaryColor: typeof data.primaryColor === "string" && data.primaryColor ? data.primaryColor : DEFAULT_BRANDING.primaryColor,
        secondaryColor: typeof data.secondaryColor === "string" && data.secondaryColor ? data.secondaryColor : DEFAULT_BRANDING.secondaryColor,
      });
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Não foi possível carregar a identidade visual.");
      setForm(DEFAULT_BRANDING);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setImage = (key: ImageFieldKey, v: string | null) => {
    setForm((prev) => ({ ...prev, [key]: v }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      window.dispatchEvent(new Event("induscost:branding-updated"));
      alert("Identidade visual salva com sucesso.");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Falha ao salvar identidade visual.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Carregando identidade visual…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-bold">Identidade Visual</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure logos e cores. A logo da proposta/PDF aparece automaticamente na pré-visualização enviada ao cliente.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase text-muted-foreground">Nome da empresa</label>
            <input
              type="text"
              maxLength={120}
              className="w-full p-3 rounded-xl border border-border bg-background text-sm outline-none"
              value={form.companyName}
              onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase text-muted-foreground">Slogan</label>
            <input
              type="text"
              maxLength={180}
              className="w-full p-3 rounded-xl border border-border bg-background text-sm outline-none"
              value={form.slogan}
              onChange={(e) => setForm((p) => ({ ...p, slogan: e.target.value }))}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase text-muted-foreground">Cor primária</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                className="h-10 w-14 cursor-pointer rounded border border-border bg-background p-0.5"
                value={form.primaryColor}
                onChange={(e) => setForm((p) => ({ ...p, primaryColor: e.target.value }))}
                disabled={saving}
              />
              <input
                type="text"
                className="flex-1 p-3 rounded-xl border border-border bg-background text-sm font-mono outline-none"
                value={form.primaryColor}
                onChange={(e) => setForm((p) => ({ ...p, primaryColor: e.target.value }))}
                disabled={saving}
                placeholder="#0EA5E9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase text-muted-foreground">Cor secundária</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                className="h-10 w-14 cursor-pointer rounded border border-border bg-background p-0.5"
                value={form.secondaryColor}
                onChange={(e) => setForm((p) => ({ ...p, secondaryColor: e.target.value }))}
                disabled={saving}
              />
              <input
                type="text"
                className="flex-1 p-3 rounded-xl border border-border bg-background text-sm font-mono outline-none"
                value={form.secondaryColor}
                onChange={(e) => setForm((p) => ({ ...p, secondaryColor: e.target.value }))}
                disabled={saving}
                placeholder="#1D4ED8"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ImageSlot
          label="Logo do sistema — compacta"
          help="Usada em ícones, menu compacto e identificação rápida."
          value={form.systemCompactLogoDataUrl}
          onChange={(v) => setImage("systemCompactLogoDataUrl", v)}
          disabled={saving}
        />
        <ImageSlot
          label="Logo do sistema — expandida"
          help="Usada em telas amplas, login e cabeçalhos internos."
          value={form.systemExpandedLogoDataUrl}
          onChange={(v) => setImage("systemExpandedLogoDataUrl", v)}
          disabled={saving}
        />
        <ImageSlot
          label="Logo da proposta/PDF"
          help="Usada no cabeçalho da proposta enviada ao cliente."
          value={form.proposalLogoDataUrl}
          onChange={(v) => setImage("proposalLogoDataUrl", v)}
          disabled={saving}
        />
        <ImageSlot
          label="Logo para fundo escuro"
          help="Usada em capas ou fundos escuros."
          value={form.darkLogoDataUrl}
          onChange={(v) => setImage("darkLogoDataUrl", v)}
          disabled={saving}
        />
        <ImageSlot
          label="Favicon / ícone"
          help="Usado como ícone do sistema."
          value={form.faviconDataUrl}
          onChange={(v) => setImage("faviconDataUrl", v)}
          disabled={saving}
        />
        <ImageSlot
          label="Capa institucional da proposta"
          help="Imagem opcional para capa ou página inicial de proposta."
          value={form.proposalCoverDataUrl}
          onChange={(v) => setImage("proposalCoverDataUrl", v)}
          disabled={saving}
        />
        <ImageSlot
          label="Imagem lateral da proposta"
          help="Imagem vertical/decorativa exibida na lateral da proposta comercial para cliente."
          value={form.proposalSideImageDataUrl}
          onChange={(v) => setImage("proposalSideImageDataUrl", v)}
          disabled={saving}
        />
        <ImageSlot
          label="Marca d'água"
          help="Imagem opcional para fundo discreto de documentos."
          value={form.watermarkDataUrl}
          onChange={(v) => setImage("watermarkDataUrl", v)}
          disabled={saving}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar identidade visual
        </button>
      </div>
    </div>
  );
}
