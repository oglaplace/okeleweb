<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import { useBanner } from "../../lib/banner";
import SearchField from "../../components/ui/SearchField.vue";

/**
 * MATIÈRES — the catalogue and its programming, in one screen.
 *
 * They were two actions in a menu: "Nouvelle matière" (a form with a code and a
 * name) and "Programmer une matière" (a different form, on a niveau, asking for
 * a subject). Between them sat the thing an operator actually holds in their
 * head — "we teach maths in these six niveaux and physics in four of them" —
 * and neither screen showed it. Creating a subject told you nothing about where
 * it was taught, and programming one had to be repeated niveau by niveau with
 * no way to see what you had already done.
 *
 * So: the catalogue on the left, and for whichever subject is selected, every
 * niveau of the complex on the right with a tick where it is taught. A subject
 * is complex-wide and its SCOPE is exactly that set of ticks — which is why the
 * right-hand side is grouped by école and cycle rather than being a flat list:
 * the scope a school reasons about is "the collège, not the primaire".
 */
const years = ref<api.AcademicYear[]>([]);
const yearId = ref<string | null>(null);
const subjects = ref<{ id: string; code: string; name: string }[]>([]);
const selectedId = ref<string | null>(null);
const placement = ref<api.SubjectPlacement | null>(null);
/** A reload in flight over content that stays put. */
const refreshing = ref(false);

const loading = ref(true);
const busy = ref<string | null>(null);
const { notice, error } = useBanner();
const query = ref("");

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q
    ? subjects.value.filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(q))
    : subjects.value;
});

/** Grouped the way a school reasons about scope: école, then cycle. */
const grouped = computed(() => {
  const out = new Map<string, { label: string; rows: api.SubjectPlacement["niveaux"] }>();
  for (const n of placement.value?.niveaux ?? []) {
    const key = `${n.school ?? "—"} · ${n.cycle ?? "—"}`;
    const bucket = out.get(key) ?? { label: key, rows: [] };
    bucket.rows.push(n);
    out.set(key, bucket);
  }
  return [...out.values()];
});

const taught = computed(
  () => (placement.value?.niveaux ?? []).filter((n) => n.offeringId).length,
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [yearList, subjectList] = await Promise.all([
      api.academics.years(),
      api.academics.subjects(),
    ]);
    years.value = yearList;
    yearId.value = (yearList.find((y) => y.isCurrent) ?? yearList[0])?.id ?? null;
    subjects.value = subjectList;
    selectedId.value = subjectList[0]?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
}

/**
 * Reload where the subject is taught.
 *
 * `keep` holds the panel on screen while it refreshes. Blanking it after a tick
 * was the glitch: the checkbox you had just clicked, the group it sat in and
 * the count above it all vanished for the length of a request and came back a
 * moment later, which reads as a fault rather than as a save.
 */
async function loadPlacement(keep = false) {
  if (!keep) placement.value = null;
  if (!selectedId.value || !yearId.value) return;
  refreshing.value = true;
  try {
    placement.value = await api.academics.subjectPlacement(selectedId.value, yearId.value);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    refreshing.value = false;
  }
}
onMounted(load);
// A new subject swaps the panel; a new année refreshes the same one.
watch(selectedId, () => loadPlacement());
watch(yearId, () => loadPlacement(true));

/** Programme it here, or take it off. One tick, one niveau. */
async function toggle(row: api.SubjectPlacement["niveaux"][number]) {
  if (!selectedId.value || !yearId.value || busy.value) return;
  busy.value = row.niveauId;
  error.value = null;
  try {
    if (row.offeringId) {
      await api.academics.deleteOffering(row.offeringId);
      notice.value = `${placement.value?.subject.name} retiré de ${row.niveau}.`;
    } else {
      await api.academics.createOffering({
        niveauId: row.niveauId,
        academicYearId: yearId.value,
        subjectId: selectedId.value,
      });
      notice.value = `${placement.value?.subject.name} programmé en ${row.niveau}.`;
    }
    await loadPlacement(true);
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Opération impossible.";
  } finally {
    busy.value = null;
  }
}

// ── the catalogue itself ────────────────────────────────────────────────────
const creating = ref(false);
const draft = ref({ code: "", name: "" });
const renaming = ref<{ id: string; name: string } | null>(null);

async function createSubject() {
  const code = draft.value.code.trim().toUpperCase();
  const name = draft.value.name.trim();
  if (!code || !name || busy.value) return;
  busy.value = "new";
  error.value = null;
  try {
    await api.academics.createSubject({ code, name });
    notice.value = `« ${name} » ajouté au catalogue.`;
    draft.value = { code: "", name: "" };
    creating.value = false;
    subjects.value = await api.academics.subjects();
    selectedId.value = subjects.value.find((s) => s.code === code)?.id ?? selectedId.value;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Ajout impossible.";
  } finally {
    busy.value = null;
  }
}

async function saveName() {
  const target = renaming.value;
  if (!target || !target.name.trim() || busy.value) return;
  busy.value = target.id;
  error.value = null;
  try {
    await api.academics.updateSubject(target.id, target.name.trim());
    notice.value = "Matière renommée.";
    renaming.value = null;
    subjects.value = await api.academics.subjects();
    await loadPlacement();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Modification impossible.";
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Matières</h1>
        <div class="page-sub">
          Le catalogue est commun à tout l'établissement ; ce qui est propre à
          chaque niveau, c'est de l'enseigner. Choisissez une matière, cochez où
          elle est enseignée.
        </div>
      </div>
      <div class="page-actions">
        <label class="sheet-pick">
          <span>Année</span>
          <select v-model="yearId" aria-label="Année scolaire">
            <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
          </select>
        </label>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <div v-if="loading" class="card"><div class="card-body stack">
      <div class="skeleton" style="width: 40%" /><div class="skeleton" style="width: 70%" />
    </div></div>

    <div v-else class="subjects">
      <!-- ── the catalogue ── -->
      <div class="card subjects-list">
        <div class="card-head">
          <span>Catalogue · {{ subjects.length }}</span>
          <button class="btn sm ghost" type="button" @click="creating = !creating">
            {{ creating ? "Annuler" : "Ajouter" }}
          </button>
        </div>

        <div v-if="creating" class="card-body stack">
          <div class="field-row">
            <div class="field">
              <label for="s-code">Code</label>
              <input id="s-code" v-model="draft.code" maxlength="16" placeholder="MATH" />
            </div>
            <div class="field field-grow">
              <label for="s-name">Nom</label>
              <input id="s-name" v-model="draft.name" maxlength="120" placeholder="Mathématiques" />
            </div>
          </div>
          <button
            class="btn primary sm"
            type="button"
            :disabled="!draft.code.trim() || !draft.name.trim() || busy === 'new'"
            @click="createSubject"
          >
            <span v-if="busy === 'new'" class="btn-spin" aria-hidden="true" />
            Ajouter au catalogue
          </button>
        </div>

        <div class="card-body" style="padding-bottom: 0">
          <SearchField v-model="query" placeholder="Filtrer les matières…" label="Filtrer" />
        </div>

        <ul class="subjects-items">
          <li
            v-for="s in shown"
            :key="s.id"
            class="subjects-item"
            :class="{ 'is-on': s.id === selectedId }"
          >
            <button class="subjects-pick" type="button" @click="selectedId = s.id">
              <span class="subjects-code">{{ s.code }}</span>
              <span class="subjects-name">{{ s.name }}</span>
            </button>
            <button
              class="catalogue-rm"
              type="button"
              :title="`Renommer ${s.name}`"
              @click="renaming = { id: s.id, name: s.name }"
            >Renommer</button>
          </li>
        </ul>
      </div>

      <!-- ── where it is taught ── -->
      <div class="card subjects-scope">
        <template v-if="placement">
          <div class="card-head">
            <span>
              {{ placement.subject.name }}
              <span class="cell-sub">{{ placement.subject.code }}</span>
            </span>
            <span class="hint">
              <span v-if="refreshing || busy" class="btn-spin" aria-hidden="true" />
              {{ refreshing || busy ? "Mise à jour…" : `Enseignée dans ${taught} niveau(x) sur ${placement.niveaux.length}` }}
            </span>
          </div>

          <div v-if="renaming && renaming.id === placement.subject.id" class="catalogue-edit">
            <div class="field field-grow">
              <label for="s-rename">Nom de la matière</label>
              <input id="s-rename" v-model="renaming.name" maxlength="120" />
              <span class="hint">
                Le code {{ placement.subject.code }} ne change pas : les notes et les
                bulletins le citent.
              </span>
            </div>
            <div class="field field-actions">
              <button class="btn sm ghost" type="button" @click="renaming = null">Annuler</button>
              <button class="btn sm primary" type="button" @click="saveName">Enregistrer</button>
            </div>
          </div>

          <div v-if="!placement.niveaux.length" class="empty">
            <div class="empty-title">Aucun niveau</div>
            <div>Une matière s'enseigne dans un niveau. Créez-en un d'abord.</div>
          </div>

          <div
            v-for="g in grouped"
            :key="g.label"
            class="subjects-group"
            :class="{ 'is-busy': !!busy }"
          >
            <div class="subjects-group-head">{{ g.label }}</div>
            <label
              v-for="n in g.rows"
              :key="n.niveauId"
              class="subjects-niveau"
              :class="{ 'is-on': !!n.offeringId }"
            >
              <input
                type="checkbox"
                :checked="!!n.offeringId"
                :disabled="!!busy"
                @change="toggle(n)"
              />
              <span>{{ n.niveau }}</span>
              <span v-if="n.weeklyHours" class="cell-sub">{{ n.weeklyHours }} h/sem.</span>
            </label>
          </div>
        </template>

        <div v-else class="empty">
          <div class="empty-title">Choisissez une matière</div>
          <div>Le panneau de droite montre où elle est enseignée.</div>
        </div>
      </div>
    </div>
  </div>
</template>
