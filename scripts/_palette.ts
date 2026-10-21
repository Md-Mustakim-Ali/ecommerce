import { toHex } from "../lib/design/color.ts";

const show = (label: string, v: string) =>
  console.log(`${label.padEnd(22)} ${v.padEnd(30)} ${toHex(v)}`);
show("light surface-1", "oklch(0.995 0.002 255)");
show("dark surface-1", "oklch(0.232 0.016 258)");
show("light accent", "oklch(0.782 0.163 70)");
show("dark accent", "oklch(0.802 0.156 72)");
show("light positive", "oklch(0.518 0.132 152)");
show("dark positive", "oklch(0.735 0.142 155)");
show("light critical", "oklch(0.556 0.196 25)");
show("dark critical", "oklch(0.712 0.176 24)");
