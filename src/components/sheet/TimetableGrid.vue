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
 * neither: time down one axis, days across the other, and the cells are lessons
 * rather than facts about a person. Forcing it into the row grid would produce
 * a list of "mardi 08:00 — maths" entries, which is the data and not the
 * artefact; nobody reads a timetable as a list.
 *
 * BUILDING it is the actual feature, and there is no "create a timetable"
 * button: an empty grid IS the create screen. A prompt in front of an empty
 * week is a door in front of an open door — the operator came here to draw one,
 * so the paper is already out.
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
 * 07:00 to 22:00 in half-hours.
 *
 * Half-hours because a Congolese school runs 55-minute lessons and split
 * afternoons, and an hour grid forces every one of those into a lie. The late
 * end is not decoration: cours du soir and the surveillance of a boarding
 * section both live after 18:00, and a grid that stops there cannot describe
 * them.
 */
const START_MIN = 7 * 60;
const END_MIN = 22 * 60;
const STEP = 30;
const SLOTS_PER_DAY = (END_MIN - START_MIN) / STEP;
const ROWS = Array.from({ length: SLOTS_PER_DAY }, (_, i) => START_MIN + i * STEP);

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** Only the hour marks carry a label; the half-hours are ticks. */
const isHour = (min: number) => min % 60 === 0;

// ── the grid ────────────────────────────────────────────────────────────────
const key = (day: number, min: number) => `${day}:${min}`;

const byCell = computed(() => {
  const map = new Map<string, api.TimetableSlot>();
  for (const slot of props.slots) {
    map.set(key(slot.dayOfWeek, Math.floor(slot.startsAtMin / STEP) * STEP), slot);
  }
  return map;
});

/** Half-hours swallowed by a lesson that started earlier. */
const covered = computed(() => {
  const set = new Set<string>();
  for (const slot of props.slots) {
    const from = Math.floor(slot.startsAtMin / STEP) * STEP;
    for (let m = from + STEP; m < slot.endsAtMin; m += STEP) set.add(key(slot.dayOfWeek, m));
  }
  return set;
});

const span = (slot: api.TimetableSlot) =>
  Math.max(1, Math.ceil((slot.endsAtMin - slot.startsAtMin) / STEP));

// ── selection ───────────────────────────────────────────────────────────────
/**
 * Multi-select, three ways.
 *
 * Shift extends from the last cell — the rectangle a mouse expects. Cmd/Ctrl
 * adds one. And a "Sélection multiple" toggle does the same with plain clicks,
 * because the modifier keys are invisible: an operator who has never been told
 * about them will never discover them, and this is a tool for a secretary, not
 * for a developer.
 */
const selecting = ref(false);
const selected = ref<Set<string>>(new Set());
const anchor = ref<{ day: number; min: number } | null>(null);

const selectedSlots = computed(() => {
  const out: api.TimetableSlot[] = [];
  for (const k of selected.value) {
    const slot = byCell.value.get(k);
    if (slot && !out.includes(slot)) out.push(slot);
  }
  return out;
});
/** Free cells in the selection — what a mass assignment would fill. */
const selectedFree = computed(() =>
  [...selected.value]
    .filter((k) => !byCell.value.has(k) && !covered.value.has(k))
    .map((k) => {
      const [day, min] = k.split(":").map(Number);
      return { day: day!, min: min! };
    }),
);

function clearSelection() {
  selected.value = new Set();
  anchor.value = null;
}

function onCell(day: number, min: number, event: MouseEvent) {
  if (props.readonly) return;
  const k = key(day, min);
  const additive = selecting.value || event.metaKey || event.ctrlKey;

  if (event.shiftKey && anchor.value) {
    // A rectangle, which is what a shift-drag means on a grid.
    const next = new Set(selected.value);
    const [d1, d2] = [Math.min(anchor.value.day, day), Math.max(anchor.value.day, day)];
    const [m1, m2] = [Math.min(anchor.value.min, min), Math.max(anchor.value.min, min)];
    for (let d = d1; d <= d2; d++) {
      for (let m = m1; m <= m2; m += STEP) next.add(key(d, m));
    }
    selected.value = next;
    return;
  }

  if (additive) {
    const next = new Set(selected.value);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    selected.value = next;
    anchor.value = { day, min };
    return;
  }

  // A plain click on a free cell is still the fast path: place one lesson.
  clearSelection();
  anchor.value = { day, min };
  if (!byCell.value.has(k)) openDraft([{ day, min }]);
}

// ── placing lessons ─────────────────────────────────────────────────────────
const draft = ref<{
  cells: { day: number; min: number }[];
  courseOfferingId: string;
  employmentId: string;
  /** In half-hour steps, so a 90-minute lesson is expressible. */
  steps: number;
  room: string;
} | null>(null);

function openDraft(cells: { day: number; min: number }[]) {
  if (props.readonly || !cells.length) return;
  error.value = null;
  draft.value = {
    cells,
    courseOfferingId: props.offerings[0]?.id ?? "",
    employmentId: "",
    steps: 2,
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
      api.timetable.addSlots(
        props.classeId,
        props.academicYearId,
        d.cells.map((cell) => ({
          courseOfferingId: d.courseOfferingId,
          ...(d.employmentId ? { employmentId: d.employmentId } : {}),
          dayOfWeek: cell.day,
          startsAtMin: cell.min,
          endsAtMin: cell.min + d.steps * STEP,
          ...(d.room.trim() ? { room: d.room.trim() } : {}),
        })),
      ),
    );
    draft.value = null;
    clearSelection();
    emit("changed");
  } catch (e) {
    // The clash messages are the point of the API check; show them verbatim.
    error.value = e instanceof api.ApiError ? e.message : "Créneau impossible.";
  } finally {
    saving.value = false;
  }
}

async function removeSlots(slots: api.TimetableSlot[]) {
  if (props.readonly || !slots.length) return;
  error.value = null;
  try {
    await busy.run(() => api.timetable.removeSlots(props.classeId, slots.map((s) => s.id)));
    clearSelection();
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
const hue = (code: string) => [...code].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/**
 * What the selection can actually be done TO.
 *
 * Not the raw cell count: a two-hour lesson occupies four half-hour cells but
 * is one thing to delete, so "12 cases — 2 cours, 6 libres" reads as arithmetic
 * that does not add up. The two numbers the buttons act on are the only two
 * worth showing.
 */
const label = computed(() => {
  if (!selected.value.size) return null;
  const parts: string[] = [];
  if (selectedSlots.value.length) parts.push(`${selectedSlots.value.length} cours`);
  if (selectedFree.value.length) parts.push(`${selectedFree.value.length} case(s) libre(s)`);
  return parts.join(" · ") || "Rien de sélectionnable";
});
</script>

<template>
  <div class="sheet timetable">
    <div class="sheet-bar">
      <span class="sheet-count">{{ slots.length }} créneau(x)</span>

      <template v-if="!readonly">
        <label class="toggle sheet-toggle">
          <input v-model="selecting" type="checkbox" />
          Sélection multiple
        </label>

        <template v-if="selected.size">
          <span class="sheet-count is-strong">{{ label }}</span>
          <button
            class="btn sm"
            type="button"
            :disabled="!selectedFree.length"
            @click="openDraft(selectedFree)"
          >
            Affecter
          </button>
          <button
            class="btn sm danger"
            type="button"
            :disabled="!selectedSlots.length"
            @click="removeSlots(selectedSlots)"
          >
            Supprimer
          </button>
          <button class="btn sm ghost" type="button" @click="clearSelection">Désélectionner</button>
        </template>
      </template>

      <div class="sheet-bar-fill" />
      <button
        v-if="!readonly && siblings.length"
        class="btn sm ghost"
        type="button"
        @click="copying = true"
      >
        Copier une semaine
      </button>
      <span v-if="!readonly && !selected.size" class="hint">
        Clic pour placer · Maj ou ⌘ pour sélectionner plusieurs
      </span>
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
          <tr v-for="min in ROWS" :key="min" :class="{ 'is-hour': isHour(min) }">
            <th class="tt-hour">{{ isHour(min) ? hhmm(min) : "" }}</th>
            <template v-for="(day, i) in DAYS" :key="i">
              <template v-if="covered.has(key(i + 1, min))" />

              <td
                v-else-if="byCell.get(key(i + 1, min))"
                class="tt-cell is-taken"
                :class="{ 'is-selected': selected.has(key(i + 1, min)) }"
                :rowspan="span(byCell.get(key(i + 1, min))!)"
                :style="{ '--tt-hue': hue(byCell.get(key(i + 1, min))!.subject.code) }"
                @click="onCell(i + 1, min, $event)"
              >
                <div class="tt-slot">
                  <span class="tt-subject">{{ byCell.get(key(i + 1, min))!.subject.code }}</span>
                  <span class="tt-time">
                    {{ hhmm(byCell.get(key(i + 1, min))!.startsAtMin) }}–{{
                      hhmm(byCell.get(key(i + 1, min))!.endsAtMin)
                    }}
                  </span>
                  <span v-if="byCell.get(key(i + 1, min))!.teacher" class="tt-teacher">
                    {{ byCell.get(key(i + 1, min))!.teacher }}
                  </span>
                  <span v-else class="tt-teacher is-missing">Enseignant à affecter</span>
                  <span v-if="byCell.get(key(i + 1, min))!.room" class="tt-room">
                    {{ byCell.get(key(i + 1, min))!.room }}
                  </span>
                  <button
                    v-if="!readonly"
                    class="tt-remove"
                    type="button"
                    :aria-label="`Retirer ${byCell.get(key(i + 1, min))!.subject.name}`"
                    @click.stop="removeSlots([byCell.get(key(i + 1, min))!])"
                  >×</button>
                </div>
              </td>

              <!-- An empty cell IS the button. -->
              <td
                v-else
                class="tt-cell is-free"
                :class="{
                  'is-locked': readonly,
                  'is-selected': selected.has(key(i + 1, min)),
                }"
                @click="onCell(i + 1, min, $event)"
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
      :title="draft.cells.length > 1 ? `Affecter ${draft.cells.length} créneaux` : 'Ajouter un cours'"
      :subtitle="
        draft.cells.length === 1
          ? `${DAYS[draft.cells[0]!.day - 1]} · ${hhmm(draft.cells[0]!.min)}`
          : `${draft.cells.length} cases sélectionnées`
      "
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
            <select id="tt-dur" v-model.number="draft.steps">
              <option :value="1">30 minutes</option>
              <option :value="2">1 heure</option>
              <option :value="3">1 h 30</option>
              <option :value="4">2 heures</option>
              <option :value="6">3 heures</option>
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
          {{ draft.cells.length > 1 ? `Placer ${draft.cells.length} cours` : "Ajouter" }}
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
