<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as api from "../../lib/api";
import Alert from "../../components/ui/Alert.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import { useOrgStore } from "../../stores/org";

/**
 * LE CALENDRIER — voir, créer, activer, verrouiller, au même endroit.
 *
 * There were two blind forms. « Créer une période » asked for a year, a kind, a
 * label, a rank and two dates with nothing on screen to say what the school
 * already had — so schools ended up with two "Trimestre 2" a fortnight apart.
 * « Verrouiller une période » offered a dropdown of names with no dates, no
 * order and no indication of which one the school was actually in.
 *
 * Both decisions need the same picture: every période of this établissement,
 * in order, with its dates and its state. So they are the same screen.
 *
 * And the third act, which did not exist: ACTIVATE. Every screen that needs a
 * période used to infer it from today's date, separately, and could disagree
 * with the screen next to it. The school declares it here, once, and marks,
 * bulletins, conseils, attendance and réinscription all open on it.
 */
const org = useOrgStore();
const schools = computed(() =>
  org.ofKind(["SCHOOL", "COMPLEX", "CYCLE", "FACULTY"]).filter((u) => !u.validTo),
);
const orgUnitId = ref<string | null>(null);
const yearId = ref<string | null>(null);
const calendar = ref<api.Calendar | null>(null);
const loading = ref(true);
const working = ref<string | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });

onMounted(async () => {
  try {
    await org.load();
    orgUnitId.value = schools.value[0]?.id ?? null;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
  } finally {
    loading.value = false;
  }
});

async function load() {
  if (!orgUnitId.value) { calendar.value = null; return; }
  loading.value = true;
  error.value = null;
  try {
    calendar.value = await api.academics.calendar(orgUnitId.value, yearId.value ?? undefined);
    yearId.value = calendar.value.year?.id ?? null;
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Chargement impossible.";
    calendar.value = null;
  } finally {
    loading.value = false;
  }
}
watch(orgUnitId, () => { yearId.value = null; void load(); });
watch(yearId, (v, old) => { if (old !== null && v !== old) void load(); });

/** One période, made THE current one for its calendar. */
async function activate(p: { id: string; label: string }) {
  if (working.value) return;
  working.value = p.id;
  error.value = null;
  try {
    await api.academics.activatePeriod(p.id);
    notice.value = `${p.label} est la période en cours — les écrans qui en ont besoin s'ouvrent dessus.`;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Activation impossible.";
  } finally {
    working.value = null;
  }
}

/**
 * Locking is what the conseil does when the marks are final; unlocking is the
 * correction path. Both here, because both are facts about the calendar.
 */
const locking = ref<{ id: string; label: string; locked: boolean } | null>(null);

async function setLock() {
  const target = locking.value;
  if (!target || working.value) return;
  working.value = target.id;
  error.value = null;
  try {
    if (target.locked) await api.academics.unlockPeriod(target.id);
    else await api.academics.lockPeriod(target.id);
    notice.value = target.locked
      ? `${target.label} déverrouillée — les notes redeviennent modifiables.`
      : `${target.label} verrouillée — ses notes sont définitives.`;
    locking.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Opération impossible.";
  } finally {
    working.value = null;
  }
}

/**
 * Creating one, in front of the list of what exists.
 *
 * The rank and the dates are proposed from the last période of the same
 * calendar — a school declaring its 2e trimestre is declaring the one after
 * the 1er, and typing "2" and two dates from nothing is how "Trimestre 2"
 * ends up twice.
 */
const creating = ref<{
  orgUnitId: string; kind: string; label: string; sequence: number;
  startsOn: string; endsOn: string;
} | null>(null);

function openCreate(unitId: string) {
  const existing = calendar.value?.groups.find((g) => g.orgUnit.id === unitId)?.periods ?? [];
  const last = existing[existing.length - 1] ?? null;
  const kind = last?.kind ?? "TRIMESTRE";
  const next = (last?.sequence ?? 0) + 1;
  // The day after the last one ends, running as long as it did.
  const from = last ? new Date(new Date(last.endsOn).getTime() + 86_400_000) : new Date();
  const span = last
    ? new Date(last.endsOn).getTime() - new Date(last.startsOn).getTime()
    : 90 * 86_400_000;
  const to = new Date(from.getTime() + span);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  creating.value = {
    orgUnitId: unitId, kind,
    label: kind === "SEMESTRE" ? `Semestre ${next}` : `Trimestre ${next}`,
    sequence: next, startsOn: iso(from), endsOn: iso(to),
  };
}

async function create() {
  const draft = creating.value;
  if (!draft || !yearId.value || working.value) return;
  working.value = "new";
  error.value = null;
  try {
    await api.academics.createPeriod({
      orgUnitId: draft.orgUnitId,
      academicYearId: yearId.value,
      kind: draft.kind as "TRIMESTRE",
      label: draft.label,
      sequence: draft.sequence,
      startsOn: draft.startsOn,
      endsOn: draft.endsOn,
    });
    notice.value = `${draft.label} créé.`;
    creating.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Création impossible.";
  } finally {
    working.value = null;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Calendrier</h1>
        <div class="page-sub">
          Les périodes de l'établissement : celles qui existent, celle en cours,
          celles dont les notes sont figées.
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center">
        <select v-if="schools.length" v-model="orgUnitId" class="btn" aria-label="Établissement">
          <option v-for="u in schools" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
        <select v-if="calendar?.years.length" v-model="yearId" class="btn" aria-label="Année">
          <option v-for="y in calendar.years" :key="y.id" :value="y.id">
            {{ y.label }}{{ y.isCurrent ? " — en cours" : "" }}
          </option>
        </select>
      </div>
    </div>

    <Alert v-if="notice" kind="ok" @close="notice = null">{{ notice }}</Alert>
    <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

    <!--
      THE ONE FACT THE REST OF THE APP DEPENDS ON.

      Said here first, because this is the screen that fixes it: without a
      current période every other screen is guessing from the wall calendar.
    -->
    <div v-if="calendar && !calendar.hasCurrent && calendar.groups.length" class="alert is-warn">
      <div class="alert-body">
        <strong>Aucune période en cours.</strong>
        Activez celle dans laquelle l'établissement travaille : les notes, les
        bulletins, le conseil de classe, les présences et les réinscriptions
        s'ouvriront dessus au lieu de la deviner.
      </div>
    </div>

    <div v-if="loading" class="card"><div class="empty">Chargement…</div></div>

    <div v-else-if="!calendar?.groups.length" class="card">
      <div class="empty">
        <div class="empty-title">Aucune période pour cette année</div>
        <div>
          Un bulletin est un document de période : sans trimestre ni semestre
          déclaré, il n'y a rien à noter et rien à figer.
        </div>
        <div class="empty-actions">
          <button
            v-if="orgUnitId"
            class="btn primary"
            type="button"
            @click="openCreate(orgUnitId)"
          >Créer une période</button>
        </div>
      </div>
    </div>

    <!-- One card per calendar: a complex with three écoles has three. -->
    <div v-for="g in calendar?.groups ?? []" :key="g.orgUnit.id" class="card is-grid">
      <div class="card-head">
        <span>{{ g.orgUnit.name }}</span>
        <button class="btn sm" type="button" @click="openCreate(g.orgUnit.id)">
          Créer une période
        </button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="c-name">Période</th>
              <th class="c-text">Du</th>
              <th class="c-text">Au</th>
              <th class="c-text">État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in g.periods" :key="p.id" :class="{ 'is-current': p.current }">
              <td class="c-name">
                <span class="cell-strong">{{ p.label }}</span>
                <!-- The rank, not the kind repeated: most labels already say
                     "Trimestre 2", and printing it twice reads as a bug. -->
                <span class="cell-sub">Rang {{ p.sequence }}</span>
              </td>
              <td class="c-text">{{ day(p.startsOn) }}</td>
              <td class="c-text">{{ day(p.endsOn) }}</td>
              <td class="c-text">
                <span v-if="p.current" class="pill ok">En cours</span>
                <span v-if="p.locked" class="pill danger">Verrouillée</span>
                <span v-if="!p.current && !p.locked" class="cell-sub">—</span>
              </td>
              <td>
                <span style="display: flex; gap: var(--s2); justify-content: flex-end">
                  <button
                    v-if="!p.current && !p.locked"
                    class="btn sm primary"
                    type="button"
                    :disabled="working === p.id"
                    @click="activate(p)"
                  >
                    <span v-if="working === p.id" class="btn-spin" aria-hidden="true" />
                    Activer
                  </button>
                  <button
                    class="btn sm ghost"
                    type="button"
                    :disabled="working === p.id"
                    @click="locking = { id: p.id, label: p.label, locked: p.locked }"
                  >{{ p.locked ? "Déverrouiller" : "Verrouiller" }}</button>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Creating one, with the list of what exists still on screen behind it. -->
    <ConfirmDialog
      v-if="creating"
      title="Créer une période"
      :subtitle="calendar?.year?.label"
      confirm-label="Créer"
      :busy="working === 'new'"
      :confirm-disabled="!creating.label.trim() || !creating.startsOn || !creating.endsOn"
      @close="creating = null"
      @confirm="create"
    >
      <p>
        Le rang et les dates sont proposés à la suite de la dernière période de
        ce calendrier. Corrigez-les si l'établissement fait autrement.
      </p>
      <div class="field-row">
        <div class="field">
          <label for="cal-kind">Type</label>
          <select id="cal-kind" v-model="creating.kind">
            <option value="TRIMESTRE">Trimestre</option>
            <option value="SEMESTRE">Semestre</option>
          </select>
        </div>
        <div class="field field-grow">
          <label for="cal-label">Libellé</label>
          <input id="cal-label" v-model="creating.label" maxlength="40" />
        </div>
        <div class="field">
          <label for="cal-seq">Rang</label>
          <input id="cal-seq" v-model.number="creating.sequence" type="number" min="1" max="6" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="cal-from">Début</label>
          <input id="cal-from" v-model="creating.startsOn" type="date" />
        </div>
        <div class="field">
          <label for="cal-to">Fin</label>
          <input id="cal-to" v-model="creating.endsOn" type="date" />
        </div>
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      v-if="locking"
      :title="locking.locked ? `Déverrouiller ${locking.label}` : `Verrouiller ${locking.label}`"
      :subtitle="calendar?.year?.label"
      :confirm-label="locking.locked ? 'Déverrouiller' : 'Verrouiller'"
      :danger="!locking.locked"
      :busy="!!working"
      @close="locking = null"
      @confirm="setLock"
    >
      <p v-if="locking.locked">
        Les notes de cette période redeviennent modifiables. C'est la voie de
        correction après un conseil : ce qui est corrigé est inscrit au
        procès-verbal.
      </p>
      <p v-else>
        Les notes de cette période cessent d'être modifiables. C'est ce que fait
        le conseil de classe quand les résultats sont définitifs — une période
        verrouillée ne peut pas non plus être la période en cours.
      </p>
    </ConfirmDialog>
  </div>
</template>
