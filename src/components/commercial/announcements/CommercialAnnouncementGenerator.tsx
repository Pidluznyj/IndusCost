import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toJpeg } from "html-to-image";
import { Download, ImagePlus, RotateCcw } from "lucide-react";
import { AccessDenied } from "@/src/components/AccessDenied";
import { CommercialAnnouncementArt } from "@/src/components/commercial/announcements/CommercialAnnouncementArt";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  ANNOUNCEMENT_FITS,
  ANNOUNCEMENT_FORMATS,
  ANNOUNCEMENT_LAYOUTS,
  ANNOUNCEMENT_THEME_LABELS,
  ANNOUNCEMENT_TITLE_SIZES,
  announcementFileName,
  announcementPreviewScale,
  buildAnnouncementView,
  createDefaultAnnouncement,
  restoreAnnouncement,
  type AnnouncementData,
} from "@/src/lib/commercial/commercialAnnouncement";
import { canUseCommercialAnnouncementGenerator } from "@/src/lib/commercial/commercialAnnouncementAccess";
import { cn } from "@/src/lib/utils";
import logoDarkUrl from "@/src/components/commercial/announcements/assets/lazarios-logo-dark.png";
import logoLightUrl from "@/src/components/commercial/announcements/assets/lazarios-logo-light.png";
import "@/src/components/commercial/announcements/commercial-announcement.css";

/** Rascunho por navegador. Nada do comunicado é enviado ao servidor. */
const STORAGE_KEY = "induscost-comunicado-v1";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function loadDraft(): AnnouncementData {
  const defaults = createDefaultAnnouncement();
  try {
    return restoreAnnouncement(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"), defaults);
  } catch {
    return defaults;
  }
}

/** Imagens grandes podem estourar a cota do navegador: nesse caso salva só o texto. */
function saveDraft(data: AnnouncementData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...data, image: "", customLogoDark: "", customLogoLight: "" })
      );
    } catch {
      // Sem armazenamento disponível: o rascunho vale só enquanto a tela está aberta.
    }
  }
}

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

const inputClass =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300/60";

function Section({
  step,
  title,
  toggle,
  children,
}: {
  step: string;
  title: string;
  toggle?: { checked: boolean; onChange: (checked: boolean) => void };
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {step} · {title}
        </h3>
        {toggle ? (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={toggle.checked} onChange={(e) => toggle.onChange(e.target.checked)} />
            Exibir
          </label>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-slate-700">
      <span>
        {label}
        {hint ? <span className="font-normal text-slate-500"> {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  columns,
  testId,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; detail?: string }>;
  onChange: (value: T) => void;
  columns: 2 | 3;
  testId: string;
}) {
  return (
    <div className={cn("grid gap-1.5", columns === 3 ? "grid-cols-3" : "grid-cols-2")} data-testid={testId}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors",
              active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            )}
            data-testid={`${testId}-${option.value}`}
          >
            <span>{option.label}</span>
            {option.detail ? <span className="text-[10px] font-normal opacity-75">{option.detail}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

const entries = <K extends string, V>(record: Record<K, V>) => Object.entries(record) as Array<[K, V]>;

/**
 * Gerador de Comunicados (Comercial). Restrito ao Super administrador e ao supervisor de vendas.
 * Edição e exportação acontecem no navegador; o rascunho fica no próprio navegador.
 */
export function CommercialAnnouncementGenerator() {
  const auth = useAuth();
  const allowed = canUseCommercialAnnouncementGenerator(auth.authUser);

  const [data, setData] = useState<AnnouncementData>(loadDraft);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [stageWidth, setStageWidth] = useState(900);
  /** O conteúdo passou do espaço do formato: a arte corta o excedente, então a tela avisa. */
  const [overflowing, setOverflowing] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** Cópia fora da tela, já no estado de exportação: é ela que vira JPEG e que mede o transbordo. */
  const exportRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const update = useCallback((patch: Partial<AnnouncementData>) => {
    setData((current) => {
      const next = { ...current, ...patch };
      saveDraft(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // Desconta o respiro lateral da área de pré-visualização (p-4).
    const measure = () => setStageWidth(stage.clientWidth - 32);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [allowed]);

  const view = useMemo(() => buildAnnouncementView(data), [data]);
  const exportView = useMemo(() => buildAnnouncementView(data, { exporting: true }), [data]);
  const scale = announcementPreviewScale(stageWidth, view.width);

  useEffect(() => {
    const body = exportRef.current?.querySelector<HTMLElement>("[data-announcement-body]");
    if (!body) return;
    const check = () => setOverflowing(body.scrollHeight > body.clientHeight + 1);
    check();
    // As fontes da arte chegam depois do primeiro desenho e mudam a altura do texto.
    void document.fonts?.ready.then(check);
  }, [data, exportView, allowed]);
  const logoSrc = view.customLogo || (view.usesLightLogo ? logoLightUrl : logoDarkUrl);
  const logoVariant = view.usesLightLogo ? "versão para fundo azul" : "versão para fundo claro";

  const onImageFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
    apply: (dataUrl: string) => Partial<AnnouncementData>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Envie um arquivo de imagem (PNG, JPG ou WebP).");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMessage("Imagem acima de 8 MB. Reduza o arquivo e envie de novo.");
      return;
    }
    try {
      update(apply(await readImageFile(file)));
      setMessage(null);
    } catch {
      setMessage("Não foi possível ler a imagem.");
    }
  };

  const exportJpeg = async () => {
    if (!exportRef.current || exporting) return;
    setMessage(null);
    setExporting(true);
    try {
      await document.fonts?.ready;
      const url = await toJpeg(exportRef.current, {
        quality: 0.95,
        width: view.width,
        height: view.height,
        pixelRatio: 1,
        // A biblioteca aplica esta cor sobre o fundo do nó exportado: tem de ser a do tema, não branco.
        backgroundColor: exportView.artBackground,
      });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = announcementFileName(data);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setMessage("Não foi possível exportar o JPEG. Tente novamente; se usar logo ou imagem própria, reenvie o arquivo.");
    } finally {
      setExporting(false);
    }
  };

  const resetAll = () => {
    if (!window.confirm("Restaurar o conteúdo de exemplo? O rascunho atual será substituído.")) return;
    const defaults = createDefaultAnnouncement();
    saveDraft(defaults);
    setData(defaults);
    setMessage(null);
  };

  if (!allowed) return <AccessDenied />;

  const text = (key: keyof AnnouncementData) => ({
    value: String(data[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update({ [key]: e.target.value }),
  });

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]" data-testid="commercial-announcement-generator">
      <aside className="flex flex-col rounded-xl border border-slate-200 bg-white lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <Section step="01" title="Formato">
            <Choice
              testId="announcement-format"
              columns={3}
              value={data.format}
              onChange={(format) => update({ format })}
              options={entries(ANNOUNCEMENT_FORMATS).map(([value, f]) => ({ value, label: f.label, detail: f.size }))}
            />
            <Choice
              testId="announcement-layout"
              columns={2}
              value={data.layout}
              onChange={(layout) => update({ layout })}
              options={entries(ANNOUNCEMENT_LAYOUTS).map(([value, label]) => ({ value, label }))}
            />
            <Choice
              testId="announcement-theme"
              columns={2}
              value={data.theme}
              onChange={(theme) => update({ theme })}
              options={entries(ANNOUNCEMENT_THEME_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Section>

          <Section step="02" title="Cabeçalho">
            <Field label="Tipo de comunicado">
              <input className={inputClass} {...text("eyebrow")} data-testid="announcement-eyebrow" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Número">
                <input className={inputClass} {...text("number")} data-testid="announcement-number" />
              </Field>
              <Field label="Data">
                <input className={inputClass} {...text("date")} />
              </Field>
            </div>
          </Section>

          <Section step="03" title="Conteúdo">
            <Field label="Título">
              <textarea className={cn(inputClass, "resize-y")} rows={2} {...text("title")} data-testid="announcement-title" />
            </Field>
            <Field label="Título — destaque em azul">
              <input className={inputClass} {...text("titleAccent")} />
            </Field>
            <div className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              Tamanho do título
              <Choice
                testId="announcement-title-size"
                columns={3}
                value={data.titleSize}
                onChange={(titleSize) => update({ titleSize })}
                options={entries(ANNOUNCEMENT_TITLE_SIZES).map(([value]) => ({ value, label: value }))}
              />
            </div>
            <Field label="Subtítulo">
              <textarea className={cn(inputClass, "resize-y")} rows={2} {...text("subtitle")} />
            </Field>
            <Field label="Texto" hint="(linha em branco = novo parágrafo)">
              <textarea className={cn(inputClass, "resize-y leading-snug")} rows={7} {...text("body")} data-testid="announcement-body" />
            </Field>
          </Section>

          <Section step="04" title="Imagem" toggle={{ checked: data.showImage, onChange: (showImage) => update({ showImage }) }}>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-400 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <ImagePlus className="h-4 w-4" />
                Enviar imagem
              </button>
              <button
                type="button"
                onClick={() => update({ image: "" })}
                disabled={!data.image}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Remover
              </button>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="announcement-image-input"
              onChange={(e) => void onImageFile(e, (image) => ({ image, showImage: true }))}
            />
            <div className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              Enquadramento
              <Choice
                testId="announcement-fit"
                columns={2}
                value={data.fit}
                onChange={(fit) => update({ fit })}
                options={entries(ANNOUNCEMENT_FITS).map(([value, label]) => ({ value, label }))}
              />
            </div>
            {!data.image ? (
              <p className="text-[11px] leading-snug text-slate-500">
                Sem imagem enviada, a área de imagem aparece só na pré-visualização e não sai no JPEG.
              </p>
            ) : null}
          </Section>

          <Section
            step="05"
            title="Destaque"
            toggle={{ checked: data.showHighlight, onChange: (showHighlight) => update({ showHighlight }) }}
          >
            <Field label="Rótulo">
              <input className={inputClass} {...text("hlLabel")} />
            </Field>
            <Field label="Texto em destaque">
              <input className={inputClass} {...text("hlText")} />
            </Field>
          </Section>

          <Section step="06" title="Assinatura" toggle={{ checked: data.showSign, onChange: (showSign) => update({ showSign }) }}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nome / área">
                <input className={inputClass} {...text("signName")} />
              </Field>
              <Field label="Cargo / empresa">
                <input className={inputClass} {...text("signRole")} />
              </Field>
            </div>
          </Section>

          <Section step="07" title="Rodapé e logo">
            <Field label="Telefone / WhatsApp">
              <input className={inputClass} {...text("phone")} />
            </Field>
            <Field label="E-mail">
              <input className={inputClass} {...text("email")} />
            </Field>
            <Field label="Site">
              <input className={inputClass} {...text("site")} />
            </Field>
            <Field label="Linha institucional">
              <input className={inputClass} {...text("tagline")} />
            </Field>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="flex-1 rounded-lg border border-dashed border-slate-400 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                Trocar logo
              </button>
              <button
                type="button"
                onClick={() => update(view.usesLightLogo ? { customLogoLight: "" } : { customLogoDark: "" })}
                disabled={!view.customLogo}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Padrão
              </button>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) =>
                void onImageFile(e, (logo) => (view.usesLightLogo ? { customLogoLight: logo } : { customLogoDark: logo }))
              }
            />
            <p className="text-[11px] leading-snug text-slate-500" data-testid="announcement-logo-status">
              {view.customLogo ? `Usando logo enviado (${logoVariant}).` : `Usando o logo oficial (${logoVariant}).`}
            </p>
          </Section>

          <button
            type="button"
            onClick={resetAll}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar exemplo
          </button>
        </div>

        <div className="space-y-2 border-t border-slate-200 p-4">
          {message ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {message}
            </p>
          ) : null}
          {overflowing ? (
            <p
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              data-testid="announcement-overflow-warning"
            >
              O conteúdo não cabe neste formato e parte dele fica cortada. Reduza o texto ou o tamanho do título,
              desligue um bloco ou escolha um formato mais alto.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void exportJpeg()}
            disabled={exporting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            data-testid="announcement-export"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Gerando JPEG…" : "Exportar JPEG"}
          </button>
          <p className="text-center text-[11px] text-slate-500">
            {view.width}×{view.height} px · ideal para e-mail e WhatsApp
          </p>
        </div>
      </aside>

      <div ref={stageRef} className="flex min-w-0 justify-center overflow-hidden rounded-xl bg-slate-100 p-4" data-testid="announcement-stage">
        <div
          style={{ width: Math.round(view.width * scale), height: Math.round(view.height * scale) }}
          className="relative shrink-0 shadow-xl"
        >
          <div style={{ position: "absolute", top: 0, left: 0, transformOrigin: "0 0", transform: `scale(${scale})` }}>
            <CommercialAnnouncementArt
              data={data}
              view={view}
              logoSrc={logoSrc}
              onPickImage={() => imageInputRef.current?.click()}
            />
          </div>
        </div>
      </div>

      {/* Fora da tela, sem display:none: precisa ter layout para ser medida e exportada. */}
      <div aria-hidden style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }}>
        <CommercialAnnouncementArt
          ref={exportRef}
          data={data}
          view={exportView}
          logoSrc={logoSrc}
          testId="announcement-art-export"
        />
      </div>
    </div>
  );
}
