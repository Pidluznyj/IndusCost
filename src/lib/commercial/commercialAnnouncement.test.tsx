import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommercialAnnouncementArt } from "@/src/components/commercial/announcements/CommercialAnnouncementArt";
import { canAccessModule, MODULE_LABELS, resolveModuleIdFromPath } from "@/src/lib/modulePermissions";
import { getModulePath, NAVIGATION_GROUP_DEFINITIONS } from "@/src/lib/navigationGroups";
import { canViewSidebarModuleFromDto } from "@/src/lib/sidebarEffectiveAccess";
import {
  ANNOUNCEMENT_FORMATS,
  announcementFileName,
  announcementParagraphs,
  announcementPreviewScale,
  buildAnnouncementView,
  createDefaultAnnouncement,
  restoreAnnouncement,
  type AnnouncementData,
} from "./commercialAnnouncement";
import {
  canUseCommercialAnnouncementGenerator,
  COMMERCIAL_ANNOUNCEMENTS_ROUTE_PATH,
} from "./commercialAnnouncementAccess";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const NOW = new Date(2026, 9, 13);
const base = (patch: Partial<AnnouncementData> = {}): AnnouncementData => ({ ...createDefaultAnnouncement(NOW), ...patch });
const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

function checker(role: string, accessProfileName: string | null) {
  return {
    hasPermission: () => true,
    hasAnyPermission: () => true,
    authUser: { role: role as never, effectivePermissions: [], accessProfileName },
  };
}

function dto(role: string, profileName: string | null, isSuperAdmin = false) {
  return {
    permissionsVersion: 1,
    role,
    isSuperAdmin,
    allowedResources: ["commercial.sales_orders", "commercial.proposals", "commercial.crm.seller", "commercial.customers"],
    actionsByResource: {},
    navigationReveal: [],
    capabilities: {},
    appliedProfile: profileName ? { id: "p1", name: profileName } : null,
    compatibility: {},
  } as never;
}

describe("gerador de comunicados — acesso", () => {
  it("só Super administrador e o perfil de supervisor de vendas", () => {
    assert.equal(canUseCommercialAnnouncementGenerator({ role: "SUPER_ADMIN", accessProfileName: null }), true);
    for (const name of ["Supervisor de Vendas", "supervisor de vendas", "  SUPERVISOR   DE VENDAS ", "Supervisor Comercial"]) {
      assert.equal(canUseCommercialAnnouncementGenerator({ role: "SELLER", accessProfileName: name }), true, name);
    }
    const denied: Array<[string, string | null]> = [
      ["ADMIN", null],
      ["ADMIN", "Administrador"],
      ["COMMERCIAL_MANAGER", null],
      ["COMMERCIAL_MANAGER", "Gestor comercial"],
      ["SELLER", "Vendedor"],
      ["SELLER", "Supervisor de vendas júnior"],
      ["SELLER", "Supervisor"],
      ["VIEWER", ""],
    ];
    for (const [role, accessProfileName] of denied) {
      assert.equal(canUseCommercialAnnouncementGenerator({ role, accessProfileName }), false, `${role}/${accessProfileName}`);
    }
    assert.equal(canUseCommercialAnnouncementGenerator(null), false);
  });

  it("menu e rota seguem a mesma regra, mesmo para quem tem todas as permissões", () => {
    assert.equal(canAccessModule("commercial-announcements", checker("SUPER_ADMIN", null)), true);
    assert.equal(canAccessModule("commercial-announcements", checker("SELLER", "Supervisor de vendas")), true);
    assert.equal(canAccessModule("commercial-announcements", checker("ADMIN", "Administrador")), false);
    assert.equal(canAccessModule("commercial-announcements", checker("COMMERCIAL_MANAGER", "Gestor comercial")), false);
    assert.equal(canAccessModule("commercial-announcements", checker("SELLER", "Vendedor")), false);

    assert.equal(canViewSidebarModuleFromDto(dto("SUPER_ADMIN", null, true), "commercial-announcements"), true);
    assert.equal(canViewSidebarModuleFromDto(dto("SELLER", "Supervisor de vendas"), "commercial-announcements"), true);
    assert.equal(canViewSidebarModuleFromDto(dto("ADMIN", "Administrador"), "commercial-announcements"), false);
    assert.equal(canViewSidebarModuleFromDto(dto("COMMERCIAL_MANAGER", "Gestor comercial"), "commercial-announcements"), false);
    assert.equal(canViewSidebarModuleFromDto(dto("SELLER", null), "commercial-announcements"), false);
  });

  it("fica no grupo Comercial, com rota e rótulo próprios", () => {
    const comercial = NAVIGATION_GROUP_DEFINITIONS.find((group) => group.id === "comercial")!;
    assert.ok(comercial.itemIds.includes("commercial-announcements"));
    assert.equal(getModulePath("commercial-announcements"), COMMERCIAL_ANNOUNCEMENTS_ROUTE_PATH);
    assert.equal(resolveModuleIdFromPath("/commercial/announcements"), "commercial-announcements");
    assert.equal(MODULE_LABELS["commercial-announcements"], "Gerador de Comunicados");
    const app = read("src/App.tsx");
    assert.match(app, /path="commercial\/announcements"/);
    const page = read("src/components/commercial/announcements/CommercialAnnouncementGenerator.tsx");
    assert.match(page, /canUseCommercialAnnouncementGenerator\(auth\.authUser\)/);
    assert.match(page, /<AccessDenied/);
    // Ferramenta local: sem chamada à API e sem endereço externo.
    assert.equal(/fetch\(|fetchJsonOk|https?:\/\//.test(page), false);
  });
});

describe("gerador de comunicados — modelo", () => {
  it("exemplo inicial usa a data e o ano do dia", () => {
    const data = createDefaultAnnouncement(NOW);
    assert.equal(data.date, "13.10.2026");
    assert.equal(data.number, "Nº 001/2026");
    assert.equal(data.format, "retrato");
    assert.equal(data.layout, "impacto");
  });

  it("formatos têm as medidas de exportação", () => {
    assert.deepEqual(
      Object.values(ANNOUNCEMENT_FORMATS).map((f) => [f.width, f.height]),
      [[1080, 1080], [1080, 1350], [1080, 1920]]
    );
    for (const format of ["quadrado", "retrato", "stories"] as const) {
      const view = buildAnnouncementView(base({ format }));
      assert.equal(view.width, ANNOUNCEMENT_FORMATS[format].width);
      assert.equal(view.height, ANNOUNCEMENT_FORMATS[format].height);
    }
  });

  it("medidas do layout impacto variam por formato e tamanho do título", () => {
    assert.equal(buildAnnouncementView(base({ format: "quadrado", titleSize: "M" })).heroTitlePx, 68);
    assert.equal(buildAnnouncementView(base({ format: "retrato", titleSize: "M" })).heroTitlePx, 76);
    assert.equal(buildAnnouncementView(base({ format: "stories", titleSize: "G" })).heroTitlePx, 115);
    assert.equal(buildAnnouncementView(base({ format: "stories" })).bodyPx, 30);
    assert.equal(buildAnnouncementView(base({ layout: "classico", titleSize: "P" })).titlePx, 64);
  });

  it("logo claro no impacto e no tema azul; escuro só no clássico de fundo branco", () => {
    const custom = { customLogoDark: `${PIXEL}DARK`, customLogoLight: `${PIXEL}LIGHT` };
    assert.equal(buildAnnouncementView(base({ layout: "impacto", theme: "claro", ...custom })).customLogo, custom.customLogoLight);
    assert.equal(buildAnnouncementView(base({ layout: "classico", theme: "azul", ...custom })).customLogo, custom.customLogoLight);
    const classic = buildAnnouncementView(base({ layout: "classico", theme: "claro", ...custom }));
    assert.equal(classic.usesLightLogo, false);
    assert.equal(classic.customLogo, custom.customLogoDark);
  });

  it("sem imagem enviada, a área de imagem existe na pré-visualização e some na exportação", () => {
    const preview = buildAnnouncementView(base({ showHighlight: false }));
    assert.equal(preview.showImage, true);
    assert.equal(preview.hasImage, false);
    assert.equal(preview.showCard, true);
    const exported = buildAnnouncementView(base({ showHighlight: false }), { exporting: true });
    assert.equal(exported.showImage, false);
    assert.equal(exported.showCard, false);
    const withImage = buildAnnouncementView(base({ image: PIXEL }), { exporting: true });
    assert.equal(withImage.showImage, true);
    assert.equal(withImage.cardImageWidth, "360px");
    assert.equal(buildAnnouncementView(base({ image: PIXEL, showHighlight: false })).cardImageWidth, "100%");
    assert.equal(buildAnnouncementView(base({ image: PIXEL, showImage: false })).showImage, false);
  });

  it("parágrafos, nome do arquivo e escala da pré-visualização", () => {
    assert.deepEqual(announcementParagraphs("Um.\n\n  Dois.\n \n\nTrês\ncontinua.  "), ["Um.", "Dois.", "Três\ncontinua."]);
    assert.deepEqual(announcementParagraphs(""), []);
    assert.equal(
      announcementFileName({ eyebrow: "Comunicado importante", number: "Nº 012/2026" }),
      "lazarios-comunicado-importante-n-012-2026.jpg"
    );
    assert.equal(announcementFileName({ eyebrow: "Atenção!", number: "" }), "lazarios-atencao.jpg");
    assert.equal(announcementFileName({ eyebrow: "", number: "" }), "lazarios-comunicado.jpg");
    assert.equal(announcementPreviewScale(540, 1080), 0.5);
    assert.equal(announcementPreviewScale(5000, 1080), 1);
    assert.equal(announcementPreviewScale(10, 1080), 240 / 1080);
  });

  it("rascunho salvo é validado: opção inválida volta ao padrão e imagem só como data URL", () => {
    const defaults = createDefaultAnnouncement(NOW);
    const restored = restoreAnnouncement(
      {
        format: "stories",
        layout: "outro",
        theme: "azul",
        titleSize: "XXL",
        fit: "cover",
        title: "Meu título",
        showSign: false,
        showImage: "sim",
        image: "https://exemplo.invalid/imagem.png",
        customLogoLight: PIXEL,
        customLogoDark: "javascript:alert(1)",
        campoDesconhecido: 1,
      },
      defaults
    );
    assert.equal(restored.format, "stories");
    assert.equal(restored.layout, defaults.layout);
    assert.equal(restored.theme, "azul");
    assert.equal(restored.titleSize, defaults.titleSize);
    assert.equal(restored.fit, "cover");
    assert.equal(restored.title, "Meu título");
    assert.equal(restored.showSign, false);
    assert.equal(restored.showImage, defaults.showImage);
    assert.equal(restored.image, "");
    assert.equal(restored.customLogoLight, PIXEL);
    assert.equal(restored.customLogoDark, "");
    assert.equal("campoDesconhecido" in restored, false);
    for (const broken of [null, "x", 3, []]) assert.deepEqual(restoreAnnouncement(broken, defaults), defaults);
  });
});

describe("gerador de comunicados — arte", () => {
  const render = (data: AnnouncementData, exporting = false, logoSrc = "") =>
    renderToStaticMarkup(<CommercialAnnouncementArt data={data} view={buildAnnouncementView(data, { exporting })} logoSrc={logoSrc} />);

  it("layout impacto mostra todos os blocos do comunicado no tamanho real", () => {
    const data = base({ image: PIXEL });
    const html = render(data, false, "logo.png");
    assert.match(html, /width:1080px;height:1350px/);
    for (const text of [
      "Comunicado importante",
      "Nº 001/2026",
      "13.10.2026",
      "Recesso de fim de ano:",
      "programe seus pedidos.",
      "Último dia para pedidos",
      "12 de dezembro",
      "Equipe Comercial",
      "(41) 98524-5568",
      "contato@lazarios.com.br",
      "Desde 1993 · Curitiba, PR · ISO 9001:2015",
    ]) {
      assert.ok(html.includes(text), text);
    }
    assert.equal((html.match(/<p /g) ?? []).length, 2);
    assert.match(html, /<img src="logo\.png" alt="Lazarios"/);
    assert.ok(html.includes(`src="${PIXEL}"`));
    assert.match(html, /object-fit:contain/);
  });

  it("sem logo usa o nome por extenso; sem imagem mostra o convite só fora da exportação", () => {
    const data = base();
    const preview = render(data);
    assert.match(preview, /LAZARIOS/);
    assert.match(preview, /KOPPETEL/);
    assert.match(preview, /clique para enviar imagem/);
    const exported = render(data, true);
    assert.equal(exported.includes("clique para enviar imagem"), false);
    assert.equal(exported.includes("announcement-image-placeholder"), false);
  });

  it("layout clássico, tema azul e blocos opcionais desligados", () => {
    const data = base({
      layout: "classico",
      theme: "azul",
      format: "quadrado",
      showHighlight: false,
      showSign: false,
      showImage: false,
      subtitle: "",
    });
    const html = render(data);
    assert.match(html, /width:1080px;height:1080px;background:#1254E0/);
    assert.equal(html.includes("Último dia para pedidos"), false);
    assert.equal(html.includes("Equipe Comercial"), false);
    assert.equal(html.includes("clique para enviar imagem"), false);
    assert.equal(html.includes("Garanta o abastecimento"), false);
    assert.match(html, /Comunicado importante/);
  });

  it("texto digitado é tratado como texto, nunca como HTML", () => {
    const html = render(base({ title: '<img src=x onerror="alert(1)">', body: "<script>alert(1)</script>" }));
    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes('<img src=x'), false);
    assert.ok(html.includes("&lt;script&gt;"));
  });
});
