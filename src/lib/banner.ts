import { ref, watch, type Ref } from "vue";

/**
 * ONE BANNER AT A TIME.
 *
 * Every screen here keeps a `notice` and an `error` and renders them as
 * siblings above the page. Nothing ever cleared the other one, so a failed
 * save under a success left both on screen — two banners, contradicting each
 * other, and the form pushed a further eighty pixels down. Worse on the
 * counter's laptop, where that is most of what is visible.
 *
 * They are one slot: whatever arrives last is what the operator is being told
 * about, and it takes the place of what was there. Neither goes away on its
 * own — see Alert — so the × is the only way out, which is the point.
 */
export function exclusive<T extends Record<string, Ref<unknown>>>(slots: T): T {
  const all = Object.values(slots);
  for (const slot of all) {
    watch(slot, (v) => {
      if (v === null || v === undefined || v === false) return;
      for (const other of all) if (other !== slot) other.value = null;
    // Sync, so the slot holds whatever was assigned LAST. Batched to the next
    // tick, two assignments in one handler are cleared in registration order
    // instead and the later message is the one that disappears.
    }, { flush: "sync" });
  }
  return slots;
}

/** The pair almost every screen has. `exclusive` takes the rarer shapes. */
export function useBanner() {
  const notice = ref<string | null>(null);
  const error = ref<string | null>(null);
  return exclusive({ notice, error });
}
