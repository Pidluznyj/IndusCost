import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/components/CrmModule.tsx");
let s = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");

const start = s.indexOf("              <ApproachGuideCard guide={approachGuide}");
const end = s.indexOf("\n            </>\n          )}\n        </main>", start);
if (start < 0 || end < 0) {
  console.error("markers", start, end);
  process.exit(1);
}

const replacement = `              <CockpitTabs active={activeCockpitTab} onChange={setActiveCockpitTab} />

              {activeCockpitTab === "timeline" ? (
                <section className="space-y-5">
                  <motion.div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Linha do tempo comercial</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Esteira cronológica de contatos e follow-ups.
                      </p>
                    </motion.div>
                    <button
                      type="button"
                      onClick={openModal}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                      Novo contato
                    </button>
                  </motion.div>

                  {(openFollowUpSummary.open > 0 || openFollowUpSummary.overdue > 0) && (
                    <motion.div className="flex flex-wrap gap-2">
                      {openFollowUpSummary.open > 0 ? (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900">
                          {openFollowUpSummary.open} follow-up(s) em aberto
                        </span>
                      ) : null}
                      {openFollowUpSummary.overdue > 0 ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">
                          {openFollowUpSummary.overdue} atrasado(s)
                        </span>
                      ) : null}
                    </motion.div>
                  )}

                  {activitiesLoading ? (
                    <motion.div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center rounded-2xl border border-dashed border-border bg-muted/20">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      Carregando contatos…
                    </motion.div>
                  ) : activitiesError ? (
                    <motion.div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                      {activitiesError}
                    </motion.div>
                  ) : activities.length === 0 ? (
                    <motion.div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
                      <MessageSquare className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                      <p className="text-sm font-semibold text-foreground">Nenhum contato registrado</p>
                      <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                        Nenhum contato registrado. Comece registrando o primeiro contato comercial deste cliente.
                      </p>
                      <button
                        type="button"
                        onClick={openModal}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                      >
                        <Plus className="h-4 w-4" />
                        Registrar primeiro contato
                      </button>
                    </motion.div>
                  ) : (
                    <ul className="relative space-y-0 pl-1">
                      {activities.map((a, index) => (
                        <CommercialTimelineItem
                          key={a.id}
                          activity={a}
                          isLast={index === activities.length - 1}
                          onMarkDone={handleMarkDone}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              ) : (
                <section className="space-y-5">
                  <ApproachGuideCard
                    guide={approachGuide}
                    hasProfile={Boolean(selectedCustomerProfile)}
                  />

                  <motion.div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5">
                    <motion.div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <motion.div className="flex items-center gap-2 min-w-0">
                        <UserCircle className="h-5 w-5 text-primary shrink-0" />
                        <h3 className="text-lg font-bold">Perfil de relacionamento</h3>
                      </motion.div>
                      <button
                        type="button"
                        onClick={openProfileModal}
                        disabled={profileLoading}
                        className="inline-flex items-center justify-center gap-2 shrink-0 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-60"
                      >
                        <Pencil className="h-4 w-4" />
                        {selectedCustomerProfile ? "Editar perfil" : "Criar perfil"}
                      </button>
                    </motion.div>
                    <p className="text-xs text-muted-foreground rounded-xl border border-border/60 bg-muted/30 px-4 py-3 leading-relaxed">
                      Registre apenas informações úteis para melhorar o atendimento comercial. Evite dados
                      sensíveis, íntimos ou desnecessários.
                    </p>
                    {profileLoading ? (
                      <motion.div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        Carregando perfil…
                      </motion.div>
                    ) : profileError ? (
                      <motion.div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        {profileError}
                      </motion.div>
                    ) : !selectedCustomerProfile ? (
                      <motion.div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
                        <p className="text-sm text-muted-foreground">
                          Nenhum perfil de relacionamento registrado. Cadastre preferências e informações
                          comerciais para orientar melhor o atendimento.
                        </p>
                        <button
                          type="button"
                          onClick={openProfileModal}
                          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
                        >
                          <Pencil className="h-4 w-4" />
                          Criar perfil
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div className="space-y-4">
                        <ProfileBlockSection title="Canais & Comunicação" icon={Radio}>
                          <ProfileDetailRow label="Canal preferido" value={selectedCustomerProfile.preferredChannel} />
                          <ProfileDetailRow label="Melhor horário" value={selectedCustomerProfile.bestContactTime} />
                          <ProfileDetailRow label="Frequência de contato" value={selectedCustomerProfile.contactFrequency} />
                          <ProfileDetailRow label="Estilo de comunicação" value={selectedCustomerProfile.communicationStyle} />
                        </ProfileBlockSection>
                        <ProfileBlockSection title="Posicionamento Comercial" icon={Target}>
                          <ProfileDetailRow label="Perfil comercial" value={selectedCustomerProfile.commercialProfile} />
                          <ProfileDetailRow label="Motivação de compra" value={selectedCustomerProfile.buyingMotivation} />
                          <ProfileDetailRow label="Objeções comuns" value={selectedCustomerProfile.commonObjections} />
                          <ProfileDetailRow label="Nível de relacionamento" value={selectedCustomerProfile.relationshipLevel} />
                          <ProfileDetailRow label="Temperatura comercial" value={selectedCustomerProfile.commercialTemperature} />
                        </ProfileBlockSection>
                        <ProfileBlockSection title="Preferências e Afinidades" icon={Sparkles}>
                          <ProfileDetailRow label="Interesses" value={selectedCustomerProfile.interests} />
                          <ProfileDetailRow label="Time / hobby" value={selectedCustomerProfile.favoriteTeam} />
                          <ProfileDetailRow label="Datas importantes" value={selectedCustomerProfile.importantDates} />
                          <ProfileDetailRow label="Preferências pessoais" value={selectedCustomerProfile.personalPreferences} />
                          <ProfileDetailRow label="Assuntos a evitar" value={selectedCustomerProfile.avoidTopics} />
                        </ProfileBlockSection>
                        <ProfileBlockSection title="Governança dos Dados" icon={Shield}>
                          <ProfileDetailRow label="Fonte da informação" value={selectedCustomerProfile.informationSource} />
                          <ProfileDetailRow label="Sensibilidade" value={sensitivityLabel(selectedCustomerProfile.sensitivityLevel)} />
                          <ProfileDetailRow label="Última confirmação" value={formatDateShortPt(selectedCustomerProfile.lastConfirmedAt)} />
                          <ProfileDetailRow label="Atualizado por" value={selectedCustomerProfile.updatedByName} />
                          <ProfileDetailRow label="Notas de relacionamento" value={selectedCustomerProfile.relationshipNotes} />
                        </ProfileBlockSection>
                      </motion.div>
                    )}
                  </motion.div>
                </section>
              )}
`;

const clean = replacement.replaceAll("<motion.div", "<div").replaceAll("</motion.div>", "</div>");
s = s.slice(0, start) + clean + s.slice(end);
fs.writeFileSync(filePath, s.replace(/\n/g, "\r\n"));
console.log("tabs patched");
