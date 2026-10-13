import React from "react";
import type { AnnouncementData, AnnouncementView } from "@/src/lib/commercial/commercialAnnouncement";

const LATO = '"Comunicado Lato", Lato, Helvetica, Arial, sans-serif';
const UBUNTU = '"Comunicado Ubuntu", Ubuntu, Helvetica, Arial, sans-serif';

type Props = {
  data: AnnouncementData;
  view: AnnouncementView;
  /** Logo da variante em uso (enviado ou padrão). Vazio mostra o nome por extenso. */
  logoSrc: string;
  /** Clique na área da imagem abre o seletor de arquivo. */
  onPickImage?: () => void;
  testId?: string;
};

function Wordmark({ color, subColor }: { color: string; subColor: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: ".02em", lineHeight: 1, color }}>LAZARIOS</div>
      <div style={{ font: `500 15px ${LATO}`, letterSpacing: ".18em", color: subColor }}>KOPPETEL</div>
    </div>
  );
}

function Signature({ data, muted }: { data: AnnouncementData; muted: string }) {
  if (!data.showSign) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{data.signName}</div>
      <div style={{ fontSize: 24, color: muted }}>{data.signRole}</div>
    </div>
  );
}

function ImageArea({
  data,
  view,
  placeholder,
  placeholderStyle,
  onPickImage,
}: {
  data: AnnouncementData;
  view: AnnouncementView;
  placeholder: string;
  placeholderStyle: React.CSSProperties;
  onPickImage?: () => void;
}) {
  if (view.hasImage) {
    return (
      <img
        src={data.image}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: data.fit, display: "block" }}
      />
    );
  }
  return (
    <div
      onClick={onPickImage}
      data-testid="announcement-image-placeholder"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 20,
        ...placeholderStyle,
      }}
    >
      {placeholder}
    </div>
  );
}

/**
 * A arte do comunicado em tamanho real (1080 px de largura). É este nó que vira JPEG;
 * a pré-visualização só aplica escala por fora. Medidas em pixels, como no protótipo.
 */
export const CommercialAnnouncementArt = React.forwardRef<HTMLDivElement, Props>(function CommercialAnnouncementArt(
  { data, view, logoSrc, onPickImage, testId = "announcement-art" },
  ref
) {
  const c = view.colors;
  const clickable: React.CSSProperties = onPickImage ? { cursor: "pointer" } : {};

  return (
    <div
      ref={ref}
      data-testid={testId}
      style={{
        width: view.width,
        height: view.height,
        background: view.artBackground,
        color: c.ink,
        display: "flex",
        flexDirection: "column",
        fontFamily: UBUNTU,
        overflow: "hidden",
        position: "relative",
        textAlign: "left",
      }}
    >
      {view.isImpact ? (
        <>
          <div
            style={{
              background: c.heroBg,
              color: "#fff",
              padding: view.heroPadding,
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              gap: 36,
            }}
          >
            <div
              style={{
                position: "absolute",
                width: 760,
                height: 760,
                borderRadius: "50%",
                border: "3px solid rgba(0,189,255,.55)",
                right: -300,
                top: -260,
              }}
            />
            <div
              style={{
                position: "absolute",
                width: 520,
                height: 520,
                borderRadius: "50%",
                background: "rgba(10,135,240,.45)",
                right: -180,
                top: -140,
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 40, position: "relative" }}>
              {logoSrc ? (
                <img src={logoSrc} alt="Lazarios" style={{ height: 64, width: "auto", display: "block" }} />
              ) : (
                <Wordmark color="#fff" subColor="#EDF2F5" />
              )}
              <div
                style={{
                  font: `500 20px ${LATO}`,
                  letterSpacing: ".06em",
                  color: "#EDF2F5",
                  textAlign: "right",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <span>{data.number}</span>
                <span>{data.date}</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 22, position: "relative" }}>
              <div style={{ display: "flex" }}>
                <span
                  style={{
                    background: "#fff",
                    color: "#1254E0",
                    font: `600 20px ${LATO}`,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    padding: "12px 20px",
                    borderRadius: 6,
                  }}
                >
                  {data.eyebrow}
                </span>
              </div>
              <div
                style={{
                  fontSize: view.heroTitlePx,
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: "-.03em",
                  textWrap: "balance",
                  whiteSpace: "pre-line",
                }}
              >
                {data.title} <span style={{ color: "#9EE3FF" }}>{data.titleAccent}</span>
              </div>
              {data.subtitle ? (
                <div
                  style={{
                    fontSize: 28,
                    lineHeight: 1.35,
                    color: "#EDF2F5",
                    textWrap: "pretty",
                    whiteSpace: "pre-line",
                    maxWidth: 860,
                  }}
                >
                  {data.subtitle}
                </div>
              ) : null}
            </div>
          </div>

          {view.showCard ? (
            <div
              style={{
                margin: "-80px 80px 0",
                position: "relative",
                background: c.cardBg,
                color: c.cardInk,
                borderRadius: 22,
                boxShadow: "0 24px 60px rgba(11,27,63,.22)",
                display: "flex",
                overflow: "hidden",
                minHeight: view.cardMinHeight,
                flexShrink: 0,
              }}
            >
              {data.showHighlight ? (
                <div
                  style={{
                    flex: 1,
                    padding: "36px 44px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 12,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      font: `600 19px ${LATO}`,
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      color: "#1254E0",
                    }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#00BDFF", flexShrink: 0 }} />
                    {data.hlLabel}
                  </div>
                  <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: "-.025em", lineHeight: 1.02, textWrap: "balance" }}>
                    {data.hlText}
                  </div>
                </div>
              ) : null}
              {view.showImage ? (
                <div
                  onClick={onPickImage}
                  style={{ width: view.cardImageWidth, flexShrink: 0, background: "#F1F4F9", position: "relative", ...clickable }}
                >
                  <ImageArea
                    data={data}
                    view={view}
                    placeholder="clique para enviar imagem"
                    placeholderStyle={{
                      background: "repeating-linear-gradient(135deg,#DCE3EF 0 2px,transparent 2px 18px)",
                      font: `500 18px ${LATO}`,
                      color: "#5B6B8C",
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            data-announcement-body=""
            style={{ flex: 1, padding: "40px 80px 44px", display: "flex", flexDirection: "column", gap: 18, minHeight: 0 }}
          >
            {view.paragraphs.map((text, index) => (
              <p
                key={index}
                style={{ margin: 0, fontFamily: LATO, fontSize: view.bodyPx, lineHeight: 1.5, color: c.body, textWrap: "pretty" }}
              >
                {text}
              </p>
            ))}
            <div style={{ flex: 1 }} />
            <Signature data={data} muted={c.muted} />
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: "72px 80px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 40 }}>
            {logoSrc ? (
              <img src={logoSrc} alt="Lazarios" style={{ height: 64, width: "auto", display: "block" }} />
            ) : (
              <Wordmark color={c.logo} subColor={c.muted} />
            )}
            <div
              style={{
                font: `500 20px ${LATO}`,
                letterSpacing: ".06em",
                color: c.muted,
                textAlign: "right",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span>{data.number}</span>
              <span>{data.date}</span>
            </div>
          </div>
          <div style={{ margin: "44px 80px 0", height: 2, background: c.rule, flexShrink: 0 }} />
          <div
            data-announcement-body=""
            style={{ flex: 1, padding: "52px 80px 56px", display: "flex", flexDirection: "column", gap: 36, minHeight: 0 }}
          >
            <div style={{ display: "flex" }}>
              <span
                style={{
                  background: c.chipBg,
                  color: c.chipFg,
                  font: `600 20px ${LATO}`,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  padding: "12px 20px",
                  borderRadius: 6,
                }}
              >
                {data.eyebrow}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div
                style={{
                  fontSize: view.titlePx,
                  fontWeight: 800,
                  lineHeight: 1.02,
                  letterSpacing: "-.025em",
                  textWrap: "balance",
                  whiteSpace: "pre-line",
                }}
              >
                {data.title} <span style={{ color: c.accent }}>{data.titleAccent}</span>
              </div>
              {data.subtitle ? (
                <div style={{ fontSize: 32, lineHeight: 1.35, color: c.muted, textWrap: "pretty", whiteSpace: "pre-line" }}>
                  {data.subtitle}
                </div>
              ) : null}
            </div>
            {view.showImage ? (
              <div
                onClick={onPickImage}
                style={{
                  flex: "1 1 0",
                  minHeight: 240,
                  borderRadius: 18,
                  overflow: "hidden",
                  background: c.imgBg,
                  position: "relative",
                  ...clickable,
                }}
              >
                <ImageArea
                  data={data}
                  view={view}
                  placeholder="clique para enviar imagem / foto do produto"
                  placeholderStyle={{
                    background: `repeating-linear-gradient(135deg,${c.stripe} 0 2px,transparent 2px 18px)`,
                    font: `500 22px ${LATO}`,
                    color: c.muted,
                    letterSpacing: ".06em",
                  }}
                />
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {view.paragraphs.map((text, index) => (
                <p key={index} style={{ margin: 0, fontFamily: LATO, fontSize: 29, lineHeight: 1.5, color: c.body, textWrap: "pretty" }}>
                  {text}
                </p>
              ))}
            </div>
            {data.showHighlight ? (
              <div
                style={{
                  background: c.hlBg,
                  color: c.hlFg,
                  borderRadius: 16,
                  padding: "32px 40px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ font: `600 19px ${LATO}`, letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.85 }}>
                  {data.hlLabel}
                </div>
                <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-.015em", lineHeight: 1.15 }}>{data.hlText}</div>
              </div>
            ) : null}
            {view.classicSpacer ? <div style={{ flex: 1 }} /> : null}
            <Signature data={data} muted={c.muted} />
          </div>
        </>
      )}

      <div style={{ display: "flex", height: 10, flexShrink: 0 }}>
        <div style={{ flex: 1, background: "#1254E0" }} />
        <div style={{ flex: 1, background: "#0A87F0" }} />
        <div style={{ flex: 1, background: "#00BDFF" }} />
      </div>
      <div
        style={{
          background: c.footBg,
          color: "#fff",
          padding: "40px 80px 44px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 48px", fontSize: 26, fontWeight: 600 }}>
          <span>{data.phone}</span>
          <span>{data.email}</span>
          <span>{data.site}</span>
        </div>
        <div style={{ font: `500 18px ${LATO}`, letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.8 }}>{data.tagline}</div>
      </div>
    </div>
  );
});
