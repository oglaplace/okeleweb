<script setup lang="ts">
import { computed, ref, watch } from "vue";
import * as api from "../../lib/api";
import { useBusyStore } from "../../stores/busy";
import DialogShell from "../ui/DialogShell.vue";
import Alert from "../ui/Alert.vue";

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
  /** Whether anyone outside the office can see this week yet. */
  published: boolean;
  publishedAt: string | null;
  readonly?: boolean;
}>();
const emit = defineEmits<{
  /** The week after the change, so the page can hold it without refetching. */
  changed: [slots: api.TimetableSlot[]];
  /** Published or withdrawn — the page owns that flag. */
  published: [value: boolean];
}>();

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

// ── the week we are drawing ─────────────────────────────────────────────────
/**
 * A LOCAL copy of the week, seeded from the prop.
 *
 * Every write used to end in "reload the class", which blanked the grid and
 * fetched it again: the whole week disappeared and came back a few hundred
 * milliseconds later, for a change of one cell. The server now hands back the
 * rows it wrote, already joined to their subject and teacher, so a placement is
 * a splice into this array and nothing else on screen moves.
 */
const rows = ref<api.TimetableSlot[]>([]);
watch(() => props.slots, (v) => (rows.value = [...v]), { immediate: true });

/** Just written — briefly lit, so a change of one cell is visible as one cell. */
const flash = ref<Set<string>>(new Set());
let flashTimer: ReturnType<typeof setTimeout> | null = null;
function lit(ids: string[]) {
  flash.value = new Set(ids);
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flash.value = new Set()), 1400);
}

/** Publishes the week upwards and keeps it here. */
function commit(next: api.TimetableSlot[]) {
  rows.value = next;
  emit("changed", next);
}

// ── the grid ────────────────────────────────────────────────────────────────
const key = (day: number, min: number) => `${day}:${min}`;
const cellOf = (slot: api.TimetableSlot) =>
  key(slot.dayOfWeek, Math.floor(slot.startsAtMin / STEP) * STEP);

const byCell = computed(() => {
  const map = new Map<string, api.TimetableSlot>();
  for (const slot of rows.value) map.set(cellOf(slot), slot);
  return map;
});

/**
 * Every half-hour a lesson occupies, mapped to the cell that DRAWS it.
 *
 * One map instead of two: the renderer asks "is this half-hour swallowed by
 * something above" and the selection asks "which lesson does this half-hour
 * belong to", and both are the same question. Without it, dragging a rectangle
 * across a two-hour lesson selected three cells that are not there — three
 * phantom entries in a count the buttons could not act on.
 */
const owner = computed(() => {
  const map = new Map<string, string>();
  for (const slot of rows.value) {
    const from = Math.floor(slot.startsAtMin / STEP) * STEP;
    for (let m = from; m < slot.endsAtMin; m += STEP) map.set(key(slot.dayOfWeek, m), cellOf(slot));
  }
  return map;
});
/** The cell a half-hour is selected AS. */
const canon = (k: string) => owner.value.get(k) ?? k;
const covered = (k: string) => owner.value.has(k) && owner.value.get(k) !== k;

const span = (slot: api.TimetableSlot) =>
  Math.max(1, Math.ceil((slot.endsAtMin - slot.startsAtMin) / STEP));

// ── selection ───────────────────────────────────────────────────────────────
/**
 * Multi-select, three ways.
 *
 * Shift extends from the last cell — the rectangle a mouse expects — and takes
 * one away the same way: shift-clicking INSIDE the selection subtracts the
 * rectangle instead of adding it. That half was missing, which made a slip of
 * the wrist unrecoverable without starting the selection over. Cmd/Ctrl
 * toggles one. And a "Sélection multiple" toggle does the same with plain
 * clicks, because the modifier keys are invisible: an operator who has never
 * been told about them will never discover them, and this is a tool for a
 * secretary, not for a developer.
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
    .filter((k) => !byCell.value.has(k))
    .map((k) => {
      const [day, min] = k.split(":").map(Number);
      return { day: day!, min: min! };
    }),
);

function clearSelection() {
  selected.value = new Set();
  anchor.value = null;
}

/** Every cell of the rectangle between two corners, as the cells that draw them. */
function rectangle(from: { day: number; min: number }, to: { day: number; min: number }) {
  const out: string[] = [];
  const [d1, d2] = [Math.min(from.day, to.day), Math.max(from.day, to.day)];
  const [m1, m2] = [Math.min(from.min, to.min), Math.max(from.min, to.min)];
  for (let d = d1; d <= d2; d++) {
    for (let m = m1; m <= m2; m += STEP) out.push(canon(key(d, m)));
  }
  return out;
}

function onCell(day: number, min: number, event: MouseEvent) {
  if (props.readonly) return;
  const k = canon(key(day, min));
  const additive = selecting.value || event.metaKey || event.ctrlKey;

  if (event.shiftKey && anchor.value) {
    // Add the rectangle, or take it away when the corner clicked was already
    // in the selection. Same gesture, both directions.
    const next = new Set(selected.value);
    const subtract = next.has(k);
    for (const c of rectangle(anchor.value, { day, min })) {
      if (subtract) next.delete(c);
      else next.add(c);
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

  /*
   * A plain click INSIDE a selection acts on the whole selection.
   *
   * Having gone to the trouble of picking twelve cells, the operator's next
   * click is on one of them — and treating that as "forget all that, place one
   * lesson here" throws the selection away at precisely the moment it was
   * about to be used. What was clicked chooses the verb; the selection decides
   * how far it reaches.
   */
  if (selected.value.size > 1 && selected.value.has(k)) {
    if (byCell.value.has(k)) openEdit(selectedSlots.value);
    else openDraft(selectedFree.value);
    return;
  }

  clearSelection();
  anchor.value = { day, min };
  const slot = byCell.value.get(k);
  if (slot) openEdit([slot]);
  else openDraft([{ day, min }]);
}

// ── what a selection means in hours ─────────────────────────────────────────
interface Run {
  day: number;
  start: number;
  end: number;
}

/**
 * Contiguous cells, per day, collapsed into lessons.
 *
 * This is where "no time input" comes from: three half-hours stacked under each
 * other on Tuesday are not three lessons, they are one lesson of an hour and a
 * half, and the same band drawn across Tuesday and Friday is that lesson twice.
 * The selection already SAYS when — asking again for a duration would be asking
 * the operator to retype what they have just drawn.
 */
function runsOf(cells: { day: number; min: number }[]): Run[] {
  const byDay = new Map<number, number[]>();
  for (const c of cells) {
    const list = byDay.get(c.day) ?? [];
    list.push(c.min);
    byDay.set(c.day, list);
  }

  const out: Run[] = [];
  for (const [day, mins] of byDay) {
    mins.sort((a, b) => a - b);
    let start = mins[0]!;
    let prev = mins[0]!;
    for (const m of mins.slice(1)) {
      if (m === prev + STEP) {
        prev = m;
        continue;
      }
      out.push({ day, start, end: prev + STEP });
      start = m;
      prev = m;
    }
    out.push({ day, start, end: prev + STEP });
  }
  return out.sort((a, b) => a.day - b.day || a.start - b.start);
}

const DURATIONS = [
  { steps: 1, label: "30 minutes" },
  { steps: 2, label: "1 heure" },
  { steps: 3, label: "1 h 30" },
  { steps: 4, label: "2 heures" },
  { steps: 6, label: "3 heures" },
];

// ── placing lessons ─────────────────────────────────────────────────────────
const draft = ref<{
  runs: Run[];
  /**
   * The selection spans more than one half-hour somewhere, so the hours are
   * read off it. When every run is a single cell the selection says WHERE but
   * not HOW LONG, and the duration is the one question left to ask.
   */
  inferred: boolean;
  courseOfferingId: string;
  employmentId: string;
  /** In half-hour steps, used only when nothing could be inferred. */
  steps: number;
  /** Editable start, offered only for a single cell. */
  start: number;
  room: string;
} | null>(null);

function openDraft(cells: { day: number; min: number }[]) {
  if (props.readonly || !cells.length) return;
  error.value = null;
  const runs = runsOf(cells);
  draft.value = {
    runs,
    inferred: runs.some((r) => r.end - r.start > STEP),
    courseOfferingId: props.offerings[0]?.id ?? "",
    employmentId: "",
    steps: 2,
    start: runs[0]!.start,
    room: "",
  };
}

/** One cell selected: the start may be moved, so only the durations that fit. */
const durations = computed(() => {
  const from = draft.value?.start ?? START_MIN;
  return DURATIONS.filter((d) => from + d.steps * STEP <= END_MIN);
});

/** The lessons this draft would create — shown, so nothing is a surprise. */
const draftSlots = computed<Run[]>(() => {
  const d = draft.value;
  if (!d) return [];
  if (d.inferred) return d.runs;
  const single = d.runs.length === 1;
  return d.runs.map((r) => {
    const start = single ? d.start : r.start;
    return { day: r.day, start, end: Math.min(END_MIN, start + d.steps * STEP) };
  });
});
const describe = (r: Run) => `${DAYS[r.day - 1]} ${hhmm(r.start)}–${hhmm(r.end)}`;

const saving = ref(false);
async function save() {
  const d = draft.value;
  if (!d || !d.courseOfferingId) return;
  saving.value = true;
  error.value = null;
  try {
    const report = await busy.run(() =>
      api.timetable.addSlots(
        props.classeId,
        props.academicYearId,
        draftSlots.value.map((r) => ({
          courseOfferingId: d.courseOfferingId,
          ...(d.employmentId ? { employmentId: d.employmentId } : {}),
          dayOfWeek: r.day,
          startsAtMin: r.start,
          endsAtMin: r.end,
          ...(d.room.trim() ? { room: d.room.trim() } : {}),
        })),
      ),
    );
    // Spliced in, not refetched: the rest of the week never repaints.
    commit([...rows.value, ...report.slots]);
    lit(report.slots.map((s) => s.id));
    draft.value = null;
    clearSelection();
  } catch (e) {
    // The clash messages are the point of the API check; show them verbatim.
    // Nothing was written — the batch is one transaction — so the grid on
    // screen is still the truth, and this is the only thing that changed.
    error.value = e instanceof api.ApiError ? e.message : "Créneau impossible.";
  } finally {
    saving.value = false;
  }
}

// ── editing what is already there ───────────────────────────────────────────
/** Sentinel for a select over slots that do not agree — "leave it alone". */
const KEEP = "__keep__";

const edit = ref<{
  slots: api.TimetableSlot[];
  courseOfferingId: string;
  employmentId: string;
  room: string;
  roomTouched: boolean;
  roomMixed: boolean;
  steps: number;
  start: number;
  day: number;
} | null>(null);

/** The value they all share, or the sentinel when they differ. */
function common(list: string[]): string {
  const first = list[0] ?? "";
  return list.every((v) => v === first) ? first : KEEP;
}

/**
 * A lesson already on the grid is a thing to CORRECT, not only to delete.
 *
 * The salle and the enseignant are decided in a second pass — often by someone
 * else, always after the week has been drawn — and until this existed the only
 * way to record that pass was to remove the créneau and place it again, losing
 * everything else about it on the way.
 */
function openEdit(slots: api.TimetableSlot[]) {
  if (props.readonly || !slots.length) return;
  error.value = null;
  const room = common(slots.map((s) => s.room ?? ""));
  const first = slots[0]!;
  edit.value = {
    slots,
    courseOfferingId: common(slots.map((s) => s.courseOfferingId)),
    employmentId: common(slots.map((s) => s.employmentId ?? "")),
    room: room === KEEP ? "" : room,
    roomTouched: false,
    roomMixed: room === KEEP,
    steps: Math.max(1, Math.round((first.endsAtMin - first.startsAtMin) / STEP)),
    start: first.startsAtMin,
    day: first.dayOfWeek,
  };
}

const editDurations = computed(() => {
  const from = edit.value?.start ?? START_MIN;
  return DURATIONS.filter((d) => from + d.steps * STEP <= END_MIN);
});

async function applyEdit() {
  const e = edit.value;
  if (!e) return;
  const one = e.slots.length === 1;
  saving.value = true;
  error.value = null;
  try {
    const report = await busy.run(() =>
      api.timetable.updateSlots(
        props.classeId,
        e.slots.map((s) => s.id),
        {
          ...(e.courseOfferingId !== KEEP ? { courseOfferingId: e.courseOfferingId } : {}),
          // "" is a real answer here — "à affecter" — and null is how it is said.
          ...(e.employmentId !== KEEP ? { employmentId: e.employmentId || null } : {}),
          // Untouched over slots that disagree means "leave every one alone".
          ...(e.roomMixed && !e.roomTouched ? {} : { room: e.room.trim() || null }),
          // Hours move for ONE lesson. A block shares a teacher and a room,
          // never a start time.
          ...(one
            ? { dayOfWeek: e.day, startsAtMin: e.start, endsAtMin: e.start + e.steps * STEP }
            : {}),
        },
      ),
    );
    const updated = new Map(report.slots.map((s) => [s.id, s]));
    commit(rows.value.map((s) => updated.get(s.id) ?? s));
    lit([...updated.keys()]);
    edit.value = null;
    clearSelection();
  } catch (err) {
    error.value = err instanceof api.ApiError ? err.message : "Modification impossible.";
  } finally {
    saving.value = false;
  }
}

async function removeSlots(slots: api.TimetableSlot[]) {
  if (props.readonly || !slots.length) return;
  error.value = null;
  const ids = new Set(slots.map((s) => s.id));
  const before = rows.value;
  // Gone from the grid the moment it is asked for, restored if the server
  // refuses: a delete that waits for a round trip before showing anything
  // feels like a click that did not land.
  commit(rows.value.filter((s) => !ids.has(s.id)));
  edit.value = null;
  clearSelection();
  try {
    await busy.run(() => api.timetable.removeSlots(props.classeId, [...ids]));
  } catch (e) {
    commit(before);
    error.value = e instanceof api.ApiError ? e.message : "Suppression impossible.";
  }
}

// ── publishing ──────────────────────────────────────────────────────────────
/**
 * A week is invisible until someone says it is ready.
 *
 * The button is here rather than on a settings screen because publishing is
 * the last step of DRAWING: the person who has just finished moving Thursday
 * around is the person who knows it is finished. Withdrawing is the same
 * control, and deliberately not hidden — a school that discovers a clash on
 * Monday morning needs to take the grid down in one click, not file a request.
 */
const publishing = ref(false);
async function togglePublished() {
  if (props.readonly) return;
  publishing.value = true;
  error.value = null;
  try {
    if (props.published) {
      await busy.run(() => api.timetable.unpublish(props.classeId, props.academicYearId));
      emit("published", false);
    } else {
      await busy.run(() => api.timetable.publish(props.classeId, props.academicYearId));
      emit("published", true);
    }
  } catch (e) {
    error.value = e instanceof api.ApiError ? e.message : "Publication impossible.";
  } finally {
    publishing.value = false;
  }
}

const publishedOn = computed(() =>
  props.publishedAt
    ? new Date(props.publishedAt).toLocaleDateString("fr-FR", {
        day: "2-digit", month: "long", year: "numeric",
      })
    : null,
);

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
    // The one path that still refetches: a copy writes a whole week at once,
    // and there was nothing on screen for it to disturb.
    const grid = await api.timetable.forClasse(props.classeId, props.academicYearId);
    commit(grid.slots);
    lit(grid.slots.map((s) => s.id));
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
 * worth showing — and the free cells are counted as the LESSONS they would
 * become, since that is what the Affecter button is about to create.
 */
const label = computed(() => {
  if (!selected.value.size) return null;
  const parts: string[] = [];
  if (selectedSlots.value.length) parts.push(`${selectedSlots.value.length} cours`);
  const runs = runsOf(selectedFree.value);
  if (runs.length) {
    parts.push(runs.length === 1 ? "1 créneau libre" : `${runs.length} créneaux libres`);
  }
  return parts.join(" · ") || "Rien de sélectionnable";
});
</script>

<template>
  <div class="sheet timetable">
    <div class="sheet-bar">
      <span class="sheet-count">{{ rows.length }} créneau(x)</span>

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
            class="btn sm"
            type="button"
            :disabled="!selectedSlots.length"
            @click="openEdit(selectedSlots)"
          >
            Modifier
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

      <!--
        What everyone else sees. Said in the toolbar rather than as a banner
        above the grid: it is a property of the week, it never changes height,
        and a school checking "is this live?" looks where the controls are.
      -->
      <span
        class="tt-state"
        :class="published ? 'is-live' : 'is-draft'"
        :title="
          published
            ? `Visible par les enseignants et les familles${publishedOn ? ` depuis le ${publishedOn}` : ''}`
            : 'Visible uniquement par vous. Les enseignants et les familles ne voient rien.'
        "
      >{{ published ? "Publié" : "Brouillon" }}</span>

      <button
        v-if="!readonly"
        class="btn sm"
        :class="published ? 'ghost' : 'primary'"
        type="button"
        :disabled="publishing || (!published && !rows.length)"
        :title="
          !published && !rows.length
            ? 'Un emploi du temps vide ne peut pas être publié'
            : undefined
        "
        @click="togglePublished"
      >
        <span v-if="publishing" class="btn-spin" aria-hidden="true" />
        {{ published ? "Dépublier" : "Publier" }}
      </button>

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

    <Alert v-if="error" kind="error" style="margin: var(--s2) var(--s3) 0" @close="error = null">{{ error }}</Alert>

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
              <template v-if="covered(key(i + 1, min))" />

              <td
                v-else-if="byCell.get(key(i + 1, min))"
                class="tt-cell is-taken"
                :class="{
                  'is-selected': selected.has(key(i + 1, min)),
                  'is-flash': flash.has(byCell.get(key(i + 1, min))!.id),
                }"
                :rowspan="span(byCell.get(key(i + 1, min))!)"
                :style="{ '--tt-hue': hue(byCell.get(key(i + 1, min))!.subject.code) }"
                :title="`${byCell.get(key(i + 1, min))!.subject.name} — cliquer pour modifier`"
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
      :title="draftSlots.length > 1 ? `Affecter ${draftSlots.length} créneaux` : 'Ajouter un cours'"
      :subtitle="
        draftSlots.length === 1
          ? describe(draftSlots[0]!)
          : `${draftSlots.length} créneaux · ${draft.inferred ? 'horaires repris de la sélection' : 'même horaire partout'}`
      "
      detail="La matière vient du programme du niveau. Un conflit d'enseignant est refusé."
      icon="calendar"
      @close="draft = null"
    >
      <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

      <div v-if="!offerings.length" class="empty">
        <div class="empty-title">Aucune matière programmée</div>
        <div>
          Un créneau porte une matière du niveau. Programmez-en une d'abord — sur
          le niveau, pas sur la classe.
        </div>
      </div>

      <template v-else>
        <div class="field-row">
          <div class="field is-wide">
            <label for="tt-sub">Matière</label>
            <select id="tt-sub" v-model="draft.courseOfferingId">
              <option v-for="o in offerings" :key="o.id" :value="o.id">
                {{ o.subject.code }} — {{ o.subject.name }}
              </option>
            </select>
          </div>
        </div>

        <!--
          The hours, ONLY when the selection did not already say them. A block
          drawn down the grid has a start and a length; asking for them again is
          asking the operator to retype what they have just drawn.
        -->
        <div v-if="!draft.inferred" class="field-row">
          <div v-if="draft.runs.length === 1" class="field">
            <label for="tt-start">Début</label>
            <select id="tt-start" v-model.number="draft.start">
              <option v-for="m in ROWS" :key="m" :value="m">{{ hhmm(m) }}</option>
            </select>
          </div>
          <div class="field">
            <label for="tt-dur">Durée</label>
            <select id="tt-dur" v-model.number="draft.steps">
              <option v-for="d in durations" :key="d.steps" :value="d.steps">{{ d.label }}</option>
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

        <!-- What will be written, in words: nothing about a block placement
             should have to be inferred back out of the grid afterwards. -->
        <div class="tt-plan">
          <span v-for="(r, i) in draftSlots" :key="i" class="tt-plan-item">{{ describe(r) }}</span>
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
          {{ draftSlots.length > 1 ? `Placer ${draftSlots.length} cours` : "Ajouter" }}
        </button>
      </div>
    </DialogShell>

    <!-- Correcting what is already drawn: the salle and the enseignant, over
         one lesson or over every maths hour of the week at once. -->
    <DialogShell
      v-if="edit"
      :title="edit.slots.length > 1 ? `Modifier ${edit.slots.length} créneaux` : 'Modifier le cours'"
      :subtitle="
        edit.slots.length === 1
          ? `${DAYS[edit.slots[0]!.dayOfWeek - 1]} ${hhmm(edit.slots[0]!.startsAtMin)}–${hhmm(edit.slots[0]!.endsAtMin)}`
          : `${edit.slots.length} créneaux sélectionnés`
      "
      :detail="
        edit.slots.length > 1
          ? 'Un champ laissé sur « inchangé » n\'est pas réécrit.'
          : 'Un conflit de classe ou d\'enseignant est refusé.'
      "
      icon="calendar"
      @close="edit = null"
    >
      <Alert v-if="error" kind="error" @close="error = null">{{ error }}</Alert>

      <div class="field-row">
        <div class="field is-wide">
          <label for="tt-esub">Matière</label>
          <select id="tt-esub" v-model="edit.courseOfferingId">
            <option v-if="edit.courseOfferingId === KEEP" :value="KEEP">— inchangé</option>
            <option v-for="o in offerings" :key="o.id" :value="o.id">
              {{ o.subject.code }} — {{ o.subject.name }}
            </option>
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="tt-eemp">Enseignant</label>
          <select id="tt-eemp" v-model="edit.employmentId">
            <option v-if="edit.employmentId === KEEP" :value="KEEP">— inchangé</option>
            <option value="">— à affecter</option>
            <option v-for="s in staff" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="field">
          <label for="tt-eroom">Salle</label>
          <input
            id="tt-eroom"
            v-model="edit.room"
            autocomplete="off"
            :placeholder="edit.roomMixed ? 'Plusieurs salles — inchangé' : 'Salle 3'"
            @input="edit.roomTouched = true"
          />
        </div>
      </div>

      <div v-if="edit.slots.length === 1" class="field-row">
        <div class="field">
          <label for="tt-eday">Jour</label>
          <select id="tt-eday" v-model.number="edit.day">
            <option v-for="(d, i) in DAYS" :key="i" :value="i + 1">{{ d }}</option>
          </select>
        </div>
        <div class="field">
          <label for="tt-estart">Début</label>
          <select id="tt-estart" v-model.number="edit.start">
            <option v-for="m in ROWS" :key="m" :value="m">{{ hhmm(m) }}</option>
          </select>
        </div>
        <div class="field">
          <label for="tt-edur">Durée</label>
          <select id="tt-edur" v-model.number="edit.steps">
            <option v-for="d in editDurations" :key="d.steps" :value="d.steps">{{ d.label }}</option>
          </select>
        </div>
      </div>

      <div class="form-actions dialog-actions">
        <button class="btn sm danger ghost" type="button" @click="removeSlots(edit.slots)">
          Supprimer
        </button>
        <div class="sheet-bar-fill" />
        <button class="btn ghost" type="button" @click="edit = null">Annuler</button>
        <button class="btn primary" type="button" :disabled="saving" @click="applyEdit">
          <span v-if="saving" class="btn-spin" aria-hidden="true" />
          Enregistrer
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
