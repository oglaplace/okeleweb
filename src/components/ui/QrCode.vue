<script setup lang="ts">
import { computed } from "vue";
import qrcode from "qrcode-generator";

/**
 * A QR code, drawn as one SVG path.
 *
 * WHY A LIBRARY. Reed–Solomon error correction and mask selection are exactly
 * the kind of arithmetic that is wrong in ways nobody notices until a phone in
 * a school office fails to read a printed sheet. `qrcode-generator` is 10KB,
 * has no dependencies, and does this one thing.
 *
 * ONE PATH rather than a module per square: a level-M code for a verification
 * URL is roughly a thousand modules, and a thousand <rect> elements is a print
 * job that stalls a modest printer. Error correction is M — the sheet is
 * carried and folded, and the code has to survive that.
 */
const props = withDefaults(
  defineProps<{ value: string; size?: number; label?: string }>(),
  { size: 96 },
);

const path = computed(() => {
  const qr = qrcode(0, "M");
  qr.addData(props.value);
  qr.make();
  const count = qr.getModuleCount();
  const d: string[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) d.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  return { d: d.join(""), count };
});
</script>

<template>
  <svg
    class="qr"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${path.count} ${path.count}`"
    shape-rendering="crispEdges"
    role="img"
    :aria-label="label ?? 'Code de vérification'"
  >
    <!-- The quiet zone is the white square around it; without a solid ground
         a scanner reads the paper texture between the modules. -->
    <rect :width="path.count" :height="path.count" fill="#fff" />
    <path :d="path.d" fill="#000" />
  </svg>
</template>
