<script setup lang="ts">
import { computed, ref } from "vue";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import DialogShell from "../ui/DialogShell.vue";
import Icon from "../ui/Icon.vue";

/**
 * The weekly grid — a different animal from the other sheets.
 *
 * Every other tab is rows of people under a choice of columns. A timetable is
 * neither: it is time down one axis and days across the other, and the cells
 * are lessons rather than facts about a person. Forcing it into the row grid
 * would have produced a list of "Tuesday 08:00 — Maths" entries, which is the
 * data and not the artefact; nobody reads a timetable as a list.
 *
 * BUILDING it is the actual feature. A director does not want a form with seven
 * fields — they want to click Tuesday at 8 and say "maths". So an empty cell IS
 * the button, and the dialog it opens already knows the day and the hour.
 */
const props = defineProps<{
  classeId: string;
  academicYearId: string;
  slots: api.TimetableSlot[];
  offerings: { id: string; subject: { id: string; code: string; name: string } }[];
  staff: { id: string; label: string }[];
  /** Other classes of the same niveau — the copy source. */
  siblings: { id: string; name: string }[];
  readonly?: boolean;
}>();
const emit = defineEmits<{ changed: [] }>();

const busy = useBusyStore();
const error = ref<string | null>(null);

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

/**
 * The hours a Congolese school actually runs: 07:00 to 18:00 in one-hour
 * bands. A configurable grid is a preference nobody has expressed; a fixed one
 * that matches the day everybody works is a screen that needs no setting up.
 */
const HOURS = Array.from({ length: 11 }, (_, i) => 7 + i);
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** day → hour → the slot starting in that hour, if any. */
const byCell = computed(() => {
  const map = new Map<string, api.TimetableSlot>();
  for (const slot of props.slots) {
    map.set(`${slot.dayOfWeek}:${Math.floor(slot.startsAtMin / 60)}`, slot);
  }
  return map;
});

/** Hours covered by a slot that started earlier — drawn as part of it. */
const covered = computed(() => {
  const set = new Set<string>();
  for (const slot of props.slots) {
    const from = Math.floor(slot.startsAtMin / 60);
    const to = Math.ceil(slot.endsAtMin / 60);
    for (let h = from + 1; h < to; h++) set.add(`${slot.dayOfWeek}:${h}`);
  }
  return set;
});

const span = (slot: api.TimetableSlot) =>
  Math.max(1, Math.ceil(slot.endsAtMin / 60) - Math.floor(slot.startsAtMin / 60));

// ── the builder ─────────────────────────────────────────────────────────────
const draft = ref<{
  dayOfWeek: number;
  hour: number;
  courseOfferingId: string;
  employmentId: string;
  duration: number;
  room: string;
} | null>(null);

function openCell(dayOfWeek: number, hour: number) {
  if (props.readonly) return;
  error.value = null;
  draft.value = {
    dayOfWeek,
    hour,
    courseOfferingId: props.offerings[0]?.id ?? "",
    employmentId: "",
    duration: 1,
    room: "",
  };
}

const saving = ref(false);
async function save() {
  const d = draft.value;
  if (!d || !d.courseOfferingId) return;
  saving.value = true;
  error.value = null;
  try {
    await busy.run(() =>
      api.timetable.addSlot({
        classeId: props.classeId,
        academicYearId: props.academicYearId,
        courseOfferingId: d.courseOfferingId,
        ...(d.employmentId ? { employmentId: d.employmentId } : {}),
        dayOfWeek: d.dayOfWeek,
        startsAtMin: d.hour * 60,
        endsAtMin: (d.hour + d.duration) * 60,
        ...(d.room.trim() ? { room: d.room.trim() } : {}),
      }),
    );
    draft.value = null;
    emit("changed");
  } catch (e) {
    // The clash messages are the point of the API check; show them verbatim.
    error.value = e instanceof api.ApiError ? e.message : "Créneau impossible.";
  } finally {
    saving.value = false;
  }
}

async function remove(slot: api.TimetableSlot) {
  if (props.readonly) return;
  try {
    await busy.run(() => api.timetable.removeSlot(slot.id));
    emit("changed");
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Suppression impossible.";
  }
}

// ── copying a week ──────────────────────────────────────────────────────────
const copying = ref(false);
const copyFrom = ref("");
async function copy() {
  if (!copyFrom.value) return;
  try {
    const report = await busy.run(() =>
      api.timetable.copyWeek(copyFrom.value, props.classeId, props.academicYearId),
    );
    copying.value = false;
    error.value =
      report.skipped > 0
        ? `${report.copied} créneau(x) copiés, ${report.skipped} ignoré(s) pour cause de conflit.`
        : null;
    emit("changed");
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Copie impossible.";
  }
}

/** A stable colour per subject, so a week reads as blocks at a glance. */
const hue = (code: string) =>
  [...code].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
</script>

<template>
  <div class="sheet timetable">
    <div class="sheet-bar">
      <span class="sheet-count">{{ slots.length }} créneau(x)</span>
      <div class="sheet-bar-fill" />
      <button
        v-if="!readonly && siblings.length"
        class="btn sm ghost"
        type="button"
        @click="copying = true"
      >
        Copier une semaine
      </button>
      <span v-if="!readonly" class="hint">Cliquez une case libre pour ajouter un cours.</span>
    </div>

    <div v-if="error" class="form-error" style="margin: var(--s2) var(--s3) 0">{{ error }}</div>

    <div class="sheet-scroll">
      <table class="tt-table">
        <thead>
          <tr>
            <th class="tt-hour" />
            <th v-for="(day, i) in DAYS" :key="i">{{ day }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="hour in HOURS" :key="hour">
            <th class="tt-hour">{{ String(hour).padStart(2, "0") }}:00</th>
            <template v-for="(day, i) in DAYS" :key="i">
              <!-- Swallowed by the lesson above it. -->
              <template v-if="covered.has(`${i + 1}:${hour}`)" />

              <td
                v-else-if="byCell.get(`${i + 1}:${hour}`)"
                class="tt-cell is-taken"
                :rowspan="span(byCell.get(`${i + 1}:${hour}`)!)"
                :style="{ '--tt-hue': hue(byCell.get(`${i + 1}:${hour}`)!.subject.code) }"
              >
                <div class="tt-slot">
                  <span class="tt-subject">{{ byCell.get(`${i + 1}:${hour}`)!.subject.code }}</span>
                  <span class="tt-time">
                    {{ hhmm(byCell.get(`${i + 1}:${hour}`)!.startsAtMin) }}–{{
                      hhmm(byCell.get(`${i + 1}:${hour}`)!.endsAtMin)
                    }}
                  </span>
                  <span v-if="byCell.get(`${i + 1}:${hour}`)!.teacher" class="tt-teacher">
                    {{ byCell.get(`${i + 1}:${hour}`)!.teacher }}
                  </span>
                  <span v-else class="tt-teacher is-missing">Enseignant à affecter</span>
                  <span v-if="byCell.get(`${i + 1}:${hour}`)!.room" class="tt-room">
                    {{ byCell.get(`${i + 1}:${hour}`)!.room }}
                  </span>
                  <button
                    v-if="!readonly"
                    class="tt-remove"
                    type="button"
                    :aria-label="`Retirer ${byCell.get(`${i + 1}:${hour}`)!.subject.name}`"
                    @click="remove(byCell.get(`${i + 1}:${hour}`)!)"
                  >×</button>
                </div>
              </td>

              <!-- An empty cell IS the button. -->
              <td
                v-else
                class="tt-cell is-free"
                :class="{ 'is-locked': readonly }"
                @click="openCell(i + 1, hour)"
              >
                <span v-if="!readonly" class="tt-add" aria-hidden="true">+</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <DialogShell
      v-if="draft"
      title="Ajouter un cours"
      :subtitle="`${DAYS[draft.dayOfWeek - 1]} · ${String(draft.hour).padStart(2, '0')}:00`"
      detail="La matière vient du programme du niveau. Un conflit d'enseignant est refusé."
      icon="calendar"
      @close="draft = null"
    >
      <div v-if="error" class="form-error">{{ error }}</div>

      <div v-if="!offerings.length" class="empty">
        <div class="empty-title">Aucune matière programmée</div>
        <div>
          Un créneau porte une matière du niveau. Programmez-en une d'abord — sur
          le niveau, pas sur la classe.
        </div>
      </div>

      <template v-else>
        <div class="field-row">
          <div class="field">
            <label for="tt-sub">Matière</label>
            <select id="tt-sub" v-model="draft.courseOfferingId">
              <option v-for="o in offerings" :key="o.id" :value="o.id">
                {{ o.subject.code }} — {{ o.subject.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="tt-dur">Durée</label>
            <select id="tt-dur" v-model.number="draft.duration">
              <option :value="1">1 heure</option>
              <option :value="2">2 heures</option>
              <option :value="3">3 heures</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="tt-emp">Enseignant</label>
            <select id="tt-emp" v-model="draft.employmentId">
              <option value="">— à affecter</option>
              <option v-for="s in staff" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="tt-room">Salle</label>
            <input id="tt-room" v-model="draft.room" autocomplete="off" placeholder="Salle 3" />
          </div>
        </div>
      </template>

      <div class="form-actions dialog-actions">
        <button class="btn ghost" type="button" @click="draft = null">Annuler</button>
        <button
          class="btn primary"
          type="button"
          :disabled="!draft.courseOfferingId || saving"
          @click="save"
        >
          <span v-if="saving" class="btn-spin" aria-hidden="true" />
          Ajouter
        </button>
      </div>
    </DialogShell>

    <DialogShell
      v-if="copying"
      title="Copier une semaine"
      detail="Les créneaux sont copiés sans leur enseignant : une personne ne peut pas tenir deux classes à la même heure."
      icon="calendar"
      @close="copying = false"
    >
      <div class="field">
        <label for="tt-copy">Classe source</label>
        <select id="tt-copy" v-model="copyFrom">
          <option value="">—</option>
          <option v-for="s in siblings" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="form-actions dialog-actions">
        <button class="btn ghost" type="button" @click="copying = false">Annuler</button>
        <button class="btn primary" type="button" :disabled="!copyFrom" @click="copy">Copier</button>
      </div>
    </DialogShell>
  </div>
</template>
