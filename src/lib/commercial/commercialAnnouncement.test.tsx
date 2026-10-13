import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommercialAnnouncementArt } from "@/src/components/commercial/announcements/CommercialAnnouncementArt";
import { canAccessModule, MODULE_LABELS, resolveModuleIdFromPath } from "@/src/lib/modulePermissions";
import { getModulePath, NAVIGATION_GROUP_DEFINITIONS } from "@/src/lib/navigationGroups";
import { PERMISSION_CATALOG } from "@/src/lib/permissionCatalog";
import { FRONTEND_PERMISSION_RESOURCES } from "@/src/lib/permissionsClient";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/resources";
import { getDualWriteAliasIndex } from "@/src/lib/security/permissionDualWrite/aliasIndex";
import {
  canViewSidebarModuleFromDto,
  projectSidebarContractKeysFromLegacyBag,
  resolveSidebarEffectiveAccessDto,
} from "@/src/lib/sidebarEffectiveAccess";
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
  COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY,
  COMMERCIAL_ANNOUNCEMENTS_ROUTE_PATH,
  COMMERCIAL_ANNOUNCEMENTS_VIEW_PERMISSION,
} from "./commercialAnnouncementAccess";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const NOW = new Date(2026, 9, 13);
const base = (patch: Partial<AnnouncementData> = {}): AnnouncementData => ({ ...createDefaultAnnouncement(NOW), ...patch });
const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

const VIEW = "commercial.announcements.view";

function checker(role: string, permissions: string[]) {
  const held = new Set(permissions);
  return {
    hasPermission: (key: string) => held.has(key),
    hasAnyPermission: (keys: string[]) => keys.some((key) => held.has(key)),
    authUser: { role: role as never, effectivePermissions: permissions },
  };
}

function dto(role: string, allowedResources: string[], isSuperAdmin = false) {
  return {
    permissionsVersion: 1,
    role,
    isSuperAdmin,
    allowedResources,
    actionsByResource: Object.fromEntries(allowedResources.map((key) => [key, ["view"]])),
    navigationReveal: [],
    capabilities: {},
    appliedProfile: null,
    compatibility: {},
  } as never;
}

describe("gerador de comunicados — acesso", () => {
  it("Super administrador entra sempre; os demais só com a permissão marcada", () => {
    assert.equal(canUseCommercialAnnouncementGenerator(checker("SUPER_ADMIN", [])), true);
    assert.equal(canUseCommercialAnnouncementGenerator(checker("SELLER", [VIEW])), true);
    assert.equal(canUseCommercialAnnouncementGenerator(checker("COMMERCIAL_MANAGER", [VIEW])), true);
    // Outras permissões comerciais, por mais amplas, não abrem o gerador.
    const otherCommercial = ["customers.view", "proposals.view", "sales_orders.view", "crm.view", "pricing.view", "price_table.view"];
    for (const role of ["ADMIN", "COMMERCIAL_MANAGER", "SELLER", "VIEWER"]) {
      assert.equal(canUseCommercialAnnouncementGenerator(checker(role, otherCommercial)), false, role);
      assert.equal(canUseCommercialAnnouncementGenerator(checker(role, [])), false, role);
    }
  });

  it("menu e rota seguem a mesma permissão (bag legado e DTO)", () => {
    assert.equal(canAccessModule("commercial-announcements", checker("SUPER_ADMIN", [])), true);
    assert.equal(canAccessModule("commercial-announcements", checker("SELLER", [VIEW])), true);
    assert.equal(canAccessModule("commercial-announcements", checker("ADMIN", ["customers.view", "sales_orders.view"])), false);

    assert.equal(canViewSidebarModuleFromDto(dto("SUPER_ADMIN", [], true), "commercial-announcements"), true);
    assert.equal(canViewSidebarModuleFromDto(dto("SELLER", ["commercial.announcements"]), "commercial-announcements"), true);
    assert.equal(
      canViewSidebarModuleFromDto(
        dto("COMMERCIAL_MANAGER", ["commercial.customers", "commercial.sales_orders", "commercial.proposals", "commercial.crm.seller"]),
        "commercial-announcements"
      ),
      false
    );
    assert.equal(canViewSidebarModuleFromDto(dto("SELLER", []), "commercial-announcements"), false);
  });

  it("a permissão existe no catálogo, na matriz de perfis e no contrato, e aparece sob Comercial", () => {
    const catalog = PERMISSION_CATALOG.find((row) => row.key === VIEW);
    assert.ok(catalog, "chave no catálogo");
    assert.equal(catalog!.label, "Gerador de Comunicados");
    assert.equal(catalog!.type, "menu");

    const resource = FRONTEND_PERMISSION_RESOURCES.find((row) => row.key === COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY);
    assert.ok(resource, "recurso na matriz de perfis");
    assert.equal(resource!.label, "Gerador de Comunicados");
    // Mesmo pai do recurso "Satisfação": o nó Comercial da matriz de perfis.
    const sibling = FRONTEND_PERMISSION_RESOURCES.find((row) => row.key === "commercial.satisfaction");
    assert.equal(resource!.parentKey, sibling!.parentKey);
    assert.deepEqual(resource!.legacyAliasKeys, [VIEW]);

    const contract = PERMISSION_CONTRACT_RESOURCES.find((row) => row.resourceKey === COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY);
    assert.ok(contract, "recurso no contrato");
    assert.equal(contract!.appearsInSidebar, true);
    assert.equal(contract!.moduleId, "commercial-announcements");
    assert.equal(contract!.parentKey, "commercial");
    assert.deepEqual(contract!.actions.map((a) => [a.action, a.legacyPermissionKeys]), [["view", [VIEW]]]);
    assert.equal(COMMERCIAL_ANNOUNCEMENTS_VIEW_PERMISSION, VIEW);
  });

  it("marcar 'ver' na matriz do perfil grava a chave, e a chave gravada abre o menu", () => {
    // Matriz → chave gravada: o recurso tem exatamente uma chave, no eixo ver.
    const index = getDualWriteAliasIndex();
    assert.deepEqual(index.oneToOneByResource.get(COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY), [
      { resourceKey: COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY, legacyKey: VIEW, axis: "view" },
    ]);
    assert.equal(index.canonicalByLegacy.get(VIEW)?.resourceKey, COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY);
    assert.equal(index.parentByResource.get(COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY), "commercial");

    // Chave gravada → menu: usuário comum só com essa chave vê o item; sem ela, não.
    assert.ok([...projectSidebarContractKeysFromLegacyBag([VIEW])].includes(COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY));
    const user = (effectivePermissions: string[]) =>
      ({ id: "u1", role: "SELLER", isActive: true, permissions: effectivePermissions, effectivePermissions }) as never;
    const withKey = resolveSidebarEffectiveAccessDto({ user: user([VIEW]) });
    const withoutKey = resolveSidebarEffectiveAccessDto({ user: user(["customers.view", "sales_orders.view"]) });
    assert.equal(canViewSidebarModuleFromDto(withKey, "commercial-announcements"), true);
    assert.equal(canViewSidebarModuleFromDto(withoutKey, "commercial-announcements"), false);
    // A chave do gerador não abre nenhum outro item do Comercial.
    for (const other of ["customers", "proposals", "sales-orders", "pricing", "crm-commercial", "commissions"] as const) {
      assert.equal(canViewSidebarModuleFromDto(withKey, other), false, other);
    }
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
    assert.match(page, /canViewModule\("commercial-announcements"\)/);
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
