import { ref, type Ref } from "vue";
import * as api from "./api";
import type { SheetColumn } from "../components/sheet/columns";

/**
 * TYPING MARKS INTO THE GRID.
 *
 * Extracted from NodePage because the conseil de classe needs exactly the same
 * behaviour: when the council reopens a subject to correct it, the correction
 * happens in the sheet it is looking at — not on another screen, one click
 * away, that shows the same grid with different rules.
 *
 * Three things happen on every keystroke and they have to happen together, or
 * the grid lies for the length of a request:
 *
 *   1. the cell shows what was typed, immediately (`overrides`)
 *   2. the subject average beside it is recomputed from the typed values
 *   3. the write is queued and flushed shortly after the typing stops
 *
 * Nobody presses save. The receipt is `state`, which the caller shows.
 */
export function useMarkEntry(opts: {
  sheet: Ref<api.StudentSheet | null>;
  periodId: Ref<string | null>;
  /** Re-read the sheet after a successful flush, so averages catch up. */
  reload: () => Promise<void>;
}) {
  /** `${columnKey}|${studentId}` → what was typed, until the reload lands. */
  const overrides = ref<Map<string, number | "abs" | null>>(new Map());
  /** assessmentId → studentId → entry, waiting to go out. */
  const pending = new Map<string, Map<string, api.MarkEntry>>();
  const state = ref<"idle" | "dirty" | "saving" | "saved">("idle");
  const savedAt = ref<string | null>(null);
  const error = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * What a teacher types, in the vocabulary they already use.
   *
   * "abs" is a state, not a zero — see the engine, which excludes it rather
   * than averaging it in. An empty cell clears the mark.
   */
  function parse(raw: string):
    { entry: Omit<api.MarkEntry, "studentId">; shown: number | "abs" | null } | null {
    const text = raw.trim().toLowerCase().replace(",", ".");
    if (text === "") return { entry: { score: null, isAbsent: false }, shown: null };
    if (["a", "ab", "abs", "absent"].includes(text)) {
      return { entry: { score: null, isAbsent: true }, shown: "abs" };
    }
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) return null;
    return { entry: { score: value, isAbsent: false }, shown: value };
  }

  function onEdit(payload: { rowKey: string; column: SheetColumn; raw: string }) {
    const { rowKey, column, raw } = payload;
    if (!column.edit) return;
    const parsed = parse(raw);
    if (!parsed) return;

    // The barème is refused server-side too; catching it here means the typist
    // is told at the cell rather than after the column has been sent.
    if (typeof parsed.shown === "number" && parsed.shown > column.edit.max) {
      error.value = `${parsed.shown} dépasse le barème de ${column.edit.max}.`;
      return;
    }
    error.value = null;

    overrides.value = new Map(overrides.value).set(`${column.key}|${rowKey}`, parsed.shown);

    const byStudent = pending.get(column.edit.assessmentId) ?? new Map<string, api.MarkEntry>();
    byStudent.set(rowKey, { studentId: rowKey, ...parsed.entry });
    pending.set(column.edit.assessmentId, byStudent);

    state.value = "dirty";
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 700);
  }

  /** Sends everything typed since the last flush, one call per evaluation. */
  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending.size) return;

    const batch = [...pending.entries()].map(([assessmentId, rows]) => ({
      assessmentId, entries: [...rows.values()],
    }));
    pending.clear();
    state.value = "saving";
    try {
      for (const { assessmentId, entries } of batch) {
        await api.grading.saveMarks(assessmentId, entries);
      }
      state.value = "saved";
      savedAt.value = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      await opts.reload();
      overrides.value = new Map();
    } catch (e) {
      state.value = "dirty";
      error.value = e instanceof api.ApiError ? e.message : "Enregistrement impossible.";
    }
  }

  /**
   * Overlays what was typed onto the loaded rows, and recomputes the subject
   * averages from it — a cell that has moved beside an average that has not is
   * a grid arguing with itself.
   */
  function apply(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    if (!overrides.value.size) return rows;
    return rows.map((row) => {
      const out = { ...row };
      for (const [key, value] of overrides.value) {
        const [column, studentId] = key.split("|");
        if (studentId === row.studentId && column) out[column] = value;
      }
      return liveAverages(out);
    });
  }

  /**
   * The subject average, recomputed from what is on screen.
   *
   * A mark typed into the sheet has to move the Moy. beside it, or the column
   * is a number that lags a save behind and quietly contradicts the cells it
   * is the average of. The server sends the same figure and wins the moment
   * the reload lands — this only fills the seconds in between.
   *
   * The rule is the API's, deliberately duplicated rather than approximated:
   * each mark scaled to /20 by its OWN barème, absences and blanks skipped
   * entirely, two decimals. If the two ever disagree the cell will visibly
   * jump when the save returns, which is the failure mode worth having — a
   * silent divergence would be the other one.
   */
  function liveAverages(row: Record<string, unknown>): Record<string, unknown> {
    const period = opts.sheet.value?.periods.find((p) => p.id === opts.periodId.value);
    if (!period) return row;

    const out = { ...row };
    for (const subject of opts.sheet.value?.subjects ?? []) {
      const evaluations = period.assessments.filter((a) => a.subjectId === subject.id);
      if (!evaluations.length) continue;

      let sum = 0;
      let n = 0;
      for (const a of evaluations) {
        const value = out[`e:${a.id}`];
        // 'abs' and null alike: neither is a score, and averaging either in
        // would invent a grade the pupil never got.
        if (typeof value !== "number") continue;
        sum += (value / (a.max || 20)) * 20;
        n += 1;
      }
      out[`g:${period.id}:${subject.id}`] = n ? Math.round((sum / n) * 100) / 100 : null;
    }
    return out;
  }

  return { state, savedAt, error, overrides, onEdit, flush, apply };
}
