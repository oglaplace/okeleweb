<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import Icon from "../../components/ui/Icon.vue";
import SearchField from "../../components/ui/SearchField.vue";
import { useBusyStore } from "../../stores/busy";
import { useBanner } from "../../lib/banner";

/**
 * RATTACHER UN ENSEIGNANT — qui enseigne quoi, à qui.
 *
 * Le fait manquait au modèle, et l'écran manquait au produit. `Assignment` dit
 * qu'une personne travaille dans une unité avec un rôle; `TimetableSlot` dit
 * qu'un cours a lieu mardi à huit heures. Ni l'un ni l'autre ne disait que
 * M. Makaya fait les maths de la 6e A — le fait dont dépendent la portée de ses
 * droits, ses bulletins, sa feuille d'appel et sa paie.
 *
 * DEUX GESTES, parce qu'il y a deux métiers.
 *
 *   PRIMAIRE      un titulaire tient TOUTE la classe. Lui faire cocher huit
 *                 matières pour décrire une évidence n'est pas une interface,
 *                 donc c'est un seul bouton.
 *   AU-DESSUS     un enseignant tient UNE matière dans PLUSIEURS classes,
 *                 parfois de plusieurs écoles. Donc une sélection multiple, et
 *                 on reste sur l'enseignant pour en enchaîner d'autres.
 *
 * Lequel s'applique n'est pas deviné: `singleTitulaire` est posé sur le NIVEAU
 * par les blueprints, et c'est l'école qui le décide — une primaire privée qui
 * prend un spécialiste d'anglais en CM2 le retire, et l'écran suit.
 */
const busy = useBusyStore();
const { notice, error } = useBanner();

const staff = ref<api.StaffMember[]>([]);
const tree = ref<api.TreeUnit[]>([]);
const yearId = ref<string | null>(null);
const loading = ref(true);

const query = ref("");
const selectedId = ref<string | null>(null);
const load = ref<api.TeachingLoad[]>([]);
const loadLoading = ref(false);

/* ── les enseignants ──────────────────────────────────────────────────────── */

const teachers = computed(() => {
  const q = query.value.trim().toLowerCase();
  return staff.value
    .filter((s) => s.active)
    .filter((s) =>
      !q ||
      `${s.lastName} ${s.firstName}`.toLowerCase().includes(q) ||
      s.assignments.some((a) => a.role.toLowerCase().includes(q)),
    );
});

const selected = computed(() =>
  staff.value.find((s) => s.id === selectedId.value) ?? null,
);

async function pick(s: api.StaffMember) {
  selectedId.value = s.id;
  target.value = "";
  chosen.value = new Set();
  await loadFor(s.id);
}

async function loadFor(employmentId: string) {
  loadLoading.value = true;
  try {
    load.value = (await api.teaching.forEmployment(employmentId)).assignments;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Charge illisible.";
    load.value = [];
  } finally {
    loadLoading.value = false;
  }
}

/**
 * La charge, groupée comme un emploi du temps se lit: par classe.
 *
 * Un enseignant de collège a huit lignes qui sont en réalité « maths en 6e A,
 * 6e B et 5e A » — trois classes, pas huit faits.
 */
const byClasse = computed(() => {
  const groups = new Map<string, { name: string; niveau: string; rows: api.TeachingLoad[] }>();
  for (const row of load.value) {
    const entry = groups.get(row.classeId)
      ?? { name: row.classeName, niveau: row.niveau, rows: [] };
    entry.rows.push(row);
    groups.set(row.classeId, entry);
  }
  return [...groups.entries()].map(([id, g]) => ({ id, ...g }));
});

/* ── choisir une classe ───────────────────────────────────────────────────── */

const target = ref("");
const offerings = ref<api.CourseOffering[]>([]);
const chosen = ref<Set<string>>(new Set());
const saving = ref(false);

const byId = computed(() => new Map(tree.value.map((u) => [u.id, u])));

/** Chaque classe, avec l'école et le niveau qui la nomment. */
const classes = computed(() =>
  tree.value
    .filter((u) => u.kind === "CLASSE")
    .map((c) => {
      const niveau = c.parentId ? byId.value.get(c.parentId) ?? null : null;
      let cursor = niveau?.parentId ?? null;
      let school: api.TreeUnit | null = null;
      for (let i = 0; cursor && i < 8; i++) {
        const up: api.TreeUnit | undefined = byId.value.get(cursor);
        if (!up) break;
        if (up.kind === "SCHOOL" || up.kind === "FACULTY") { school = up; break; }
        cursor = up.parentId;
      }
      return {
        id: c.id,
        label: `${school?.name ?? "—"} · ${niveau?.name ?? "—"} · ${c.name}`,
        niveauId: niveau?.id ?? null,
        // The flag that decides which gesture this classe takes.
        wholeClass: niveau?.singleTitulaire ?? false,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label)),
);

const targetClasse = computed(() =>
  classes.value.find((c) => c.id === target.value) ?? null,
);

/**
 * TOUTE LA CLASSE EST DÉJÀ À LUI.
 *
 * Le bouton « Rattacher toute la classe » restait cliquable après l'avoir
 * cliqué. L'API ne recrée rien, donc rien ne cassait — mais un bouton qui
 * répond « c'est fait » à quelque chose de déjà fait ne dit pas la différence
 * entre « ça a marché » et « ça n'a rien changé », et on reclique pour voir.
 *
 * Fait = chaque matière du niveau lui est rattachée dans cette classe. Tant que
 * les matières ne sont pas chargées, on ne sait pas : on ne prétend donc rien.
 */
const wholeClassDone = computed(() => {
  const c = targetClasse.value;
  if (!c || !offerings.value.length) return false;
  return offerings.value.every((o) => alreadyHere.value.has(o.id));
});

/** Les matières déjà rattachées ici, pour ne pas les proposer deux fois. */
const alreadyHere = computed(() => {
  const c = targetClasse.value;
  if (!c) return new Set<string>();
  return new Set(
    load.value.filter((r) => r.classeId === c.id).map((r) => r.courseOfferingId),
  );
});

watch(target, async (id) => {
  chosen.value = new Set();
  offerings.value = [];
  const classe = classes.value.find((c) => c.id === id);
  if (!classe?.niveauId || !yearId.value) return;
  try {
    offerings.value = await api.academics.offerings(classe.niveauId, yearId.value);
  } catch {
    offerings.value = [];
  }
});

function toggle(offeringId: string) {
  const next = new Set(chosen.value);
  if (next.has(offeringId)) next.delete(offeringId);
  else next.add(offeringId);
  chosen.value = next;
}

/* ── rattacher ────────────────────────────────────────────────────────────── */

async function linkSubjects() {
  const teacher = selected.value;
  const classe = targetClasse.value;
  if (!teacher || !classe || !chosen.value.size) return;
  saving.value = true;
  error.value = null;
  try {
    await busy.run(
      async () => {
        for (const courseOfferingId of chosen.value) {
          await api.teaching.assign({
            employmentId: teacher.id, courseOfferingId, classeId: classe.id,
          });
        }
      },
      { title: "Rattachement", detail: `${teacher.lastName} — ${classe.label}` },
    );
    notice.value =
      `${chosen.value.size} matière(s) rattachée(s) à ${teacher.firstName} ${teacher.lastName}.`;
    chosen.value = new Set();
    await loadFor(teacher.id);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Rattachement impossible.";
  } finally {
    saving.value = false;
  }
}

async function linkWholeClasse() {
  const teacher = selected.value;
  const classe = targetClasse.value;
  if (!teacher || !classe) return;
  saving.value = true;
  error.value = null;
  try {
    const res = await busy.run(
      () => api.teaching.assignWholeClasse({
        employmentId: teacher.id, classeId: classe.id,
      }),
      { title: "Rattachement", detail: `${teacher.lastName} — ${classe.label}` },
    );
    notice.value =
      `${teacher.firstName} ${teacher.lastName} tient ${classe.label} — `
      + `${res.subjects} matière(s).`;
    await loadFor(teacher.id);
  } catch (e) {
    // The API refuses this above the primaire, and says why.
    error.value = e instanceof api.ApiError ? e.message : "Rattachement impossible.";
  } finally {
    saving.value = false;
  }
}

async function unlink(row: api.TeachingLoad) {
  const teacher = selected.value;
  if (!teacher) return;
  error.value = null;
  try {
    await busy.run(() => api.teaching.end(row.id),
      { title: "Retrait", detail: row.subject });
    notice.value = `${row.subject} retiré.`;
    await loadFor(teacher.id);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Retrait impossible.";
  }
}

onMounted(async () => {
  try {
    const [people, units, years] = await Promise.all([
      /*
       * Seulement ceux qui pourraient enseigner.
       *
       * La liste proposait TOUT le personnel — le comptable, l'économe, le
       * gardien — pour tenir les maths de la 6e A. Ce qui distingue un
       * enseignant n'est pas son contrat mais son AFFECTATION: on l'a posté
       * dans une école, un cycle, un niveau ou une classe, pas dans une
       * direction ni un département. L'API tranche, pas l'écran.
       */
      api.people.staff({ teaching: true }),
      api.orgUnits.tree(),
      api.academics.years().catch(() => []),
    ]);
    staff.value = people;
    tree.value = units;
    yearId.value = years.find((y) => y.isCurrent)?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
});

const TYPE_FR: Record<api.StaffMember["type"], string> = {
  PERMANENT: "Permanent", VACATAIRE: "Vacataire", STAGIAIRE: "Stagiaire",
};
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><Icon name="users" :size="19" /> Enseignements</h1>
        <div class="page-sub">
          Qui enseigne quoi, et à quelle classe. Au primaire, un titulaire tient
          toute la classe ; au collège et au-dessus, matière par matière.
        </div>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 45%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <div v-else-if="!yearId" class="empty">
      <div class="empty-title">Aucune année scolaire en cours</div>
      <div>Un rattachement vaut pour une année : ouvrez-en une d'abord.</div>
    </div>

    <div v-else class="teach-split">
      <!-- ── qui ─────────────────────────────────────────────────────────── -->
      <div class="card">
        <div class="card-head">
          Enseignants
          <span class="unit-meta">{{ teachers.length }}</span>
        </div>
        <!-- La liste commençait collée sous la boîte de recherche : les deux
             se lisaient comme un seul bloc, et la première ligne ressemblait à
             une suggestion de saisie. -->
        <div class="card-body" style="padding-bottom: var(--s3)">
          <SearchField v-model="query" placeholder="Nom ou fonction…" label="Chercher" />
        </div>

        <div v-if="!teachers.length" class="empty">
          <div class="empty-title">Personne</div>
          <div>
            Seul le personnel affecté à une école, un niveau ou une classe
            apparaît ici. Affectez-le depuis <strong>Personnel</strong>.
          </div>
        </div>

        <ul v-else class="teach-list">
          <li v-for="t in teachers" :key="t.id">
            <button
              type="button"
              class="teach-row"
              :class="{ 'is-on': t.id === selectedId }"
              @click="pick(t)"
            >
              <span class="teach-name">
                <span class="cell-strong">{{ t.lastName.toUpperCase() }} {{ t.firstName }}</span>
                <span class="cell-sub">
                  {{ TYPE_FR[t.type] }}<template v-if="t.assignments.length">
                    · {{ t.assignments[0]!.role }}</template>
                </span>
              </span>
              <Icon name="chevronRight" :size="14" />
            </button>
          </li>
        </ul>
      </div>

      <!-- ── quoi ────────────────────────────────────────────────────────── -->
      <div v-if="!selected" class="card">
        <div class="empty">
          <div class="empty-title">Choisissez un enseignant</div>
          <div>Sa charge apparaîtra ici, et vous pourrez la compléter.</div>
        </div>
      </div>

      <div v-else class="stack">
        <div class="card">
          <div class="card-head">
            Charge de {{ selected.firstName }} {{ selected.lastName }}
            <span class="unit-meta">{{ load.length }} rattachement(s)</span>
          </div>

          <div v-if="loadLoading" class="card-body stack">
            <div class="skeleton" style="width: 50%" />
          </div>

          <div v-else-if="!load.length" class="empty">
            <div class="empty-title">Aucun enseignement</div>
            <div>
              Tant que rien n'est rattaché, cette personne ne peut saisir
              aucune note ni faire aucun appel.
            </div>
          </div>

          <div v-else class="card-body">
            <div v-for="g in byClasse" :key="g.id" class="teach-group">
              <div class="teach-group-head">{{ g.niveau }} · {{ g.name }}</div>
              <div class="teach-chips">
                <span v-for="row in g.rows" :key="row.id" class="teach-chip">
                  {{ row.subject }}
                  <button
                    type="button"
                    class="teach-chip-x"
                    :title="`Retirer ${row.subject}`"
                    @click="unlink(row)"
                  >
                    <Icon name="x" :size="11" />
                  </button>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── rattacher ─────────────────────────────────────────────────── -->
        <div class="card">
          <div class="card-head">Rattacher</div>
          <div class="card-body">
            <div class="field" style="max-width: 460px">
              <label for="tl-classe">Classe</label>
              <select id="tl-classe" v-model="target">
                <option value="">Choisissez une classe…</option>
                <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.label }}</option>
              </select>
              <span class="hint">
                Un enseignant peut tenir plusieurs classes, dans plusieurs écoles
                du complexe.
              </span>
            </div>

            <!-- LE PRIMAIRE : un geste, pas huit cases. -->
            <template v-if="targetClasse?.wholeClass">
              <p class="hint" style="margin: var(--s3) 0">
                <strong>{{ targetClasse.label }}</strong> a un titulaire unique :
                l'enseignant y tient toutes les matières.
              </p>
              <button
                class="btn primary"
                type="button"
                :disabled="saving || wholeClassDone"
                :title="wholeClassDone
                  ? 'Cette classe lui est déjà rattachée en entier.'
                  : undefined"
                @click="linkWholeClasse"
              >
                {{ wholeClassDone ? "Déjà rattachée" : "Rattacher toute la classe" }}
              </button>
              <p v-if="wholeClassDone" class="hint" style="margin-top: var(--s2)">
                {{ selected?.firstName }} tient déjà toutes les matières de cette
                classe. Retirez-en une ci-dessus pour la rendre à quelqu'un d'autre.
              </p>
            </template>

            <!-- AU-DESSUS : une matière est un choix, plusieurs en sont un aussi. -->
            <template v-else-if="targetClasse">
              <div v-if="!offerings.length" class="empty" style="margin-top: var(--s3)">
                <div class="empty-title">Aucune matière programmée</div>
                <div>Programmez les matières de ce niveau avant de rattacher.</div>
              </div>

              <template v-else>
                <div class="perm-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
                  <label
                    v-for="o in offerings"
                    :key="o.id"
                    class="perm-row"
                    :class="{ 'is-done': alreadyHere.has(o.id) }"
                  >
                    <input
                      type="checkbox"
                      :checked="chosen.has(o.id) || alreadyHere.has(o.id)"
                      :disabled="alreadyHere.has(o.id)"
                      @change="toggle(o.id)"
                    />
                    <span>
                      <strong>{{ o.subject.name }}</strong>
                      <span class="perm-desc">
                        {{ alreadyHere.has(o.id) ? "déjà rattachée" : `${o.weeklyHours} h / semaine` }}
                      </span>
                    </span>
                  </label>
                </div>

                <button
                  class="btn primary"
                  type="button"
                  :disabled="!chosen.size || saving"
                  @click="linkSubjects"
                >
                  Rattacher {{ chosen.size || "" }} matière(s)
                </button>
              </template>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.teach-split {
  display: grid;
  grid-template-columns: minmax(260px, 340px) 1fr;
  gap: var(--s4);
  align-items: start;
}
@media (max-width: 860px) {
  .teach-split {
    grid-template-columns: 1fr;
  }
}

.teach-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 60vh;
  overflow-y: auto;
}
.teach-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  width: 100%;
  padding: var(--s2) var(--s4);
  border: none;
  border-top: 1px solid var(--line-soft);
  background: none;
  text-align: left;
  cursor: pointer;
}
.teach-row:hover {
  background: var(--surface-2);
}
.teach-row.is-on {
  background: var(--primary-soft);
}
.teach-row.is-on .cell-strong {
  color: var(--primary-soft-ink);
}
.teach-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.teach-group + .teach-group {
  margin-top: var(--s3);
  padding-top: var(--s3);
  border-top: 1px solid var(--line-soft);
}
.teach-group-head {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: var(--s2);
}
.teach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s2);
}
.teach-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--surface);
  font-size: var(--t-small);
}
.teach-chip-x {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--ink-3);
  cursor: pointer;
}
.teach-chip-x:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

/* Déjà rattachée : cochée, inerte, et elle le dit. */
.perm-row.is-done {
  opacity: 0.55;
  cursor: default;
}
</style>
