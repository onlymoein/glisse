// A lens grows and stretches by a scale, which would draw its round ends as ovals: longer
// the way it's pulled, flat across it. Its radii are set against the scale instead, so on
// screen it stays a capsule whatever shape it's taken.

export interface Round {
  /** The radii to give the unscaled box, as CSS `border-radius`. */
  css: string;
  /** The radius it's drawn with on screen. */
  drawn: number;
}

/** The corners that keep a box `width` × `height`, with corners `radius`, round once scaled by `sx` × `sy`. */
export function roundAtScale(width: number, height: number, radius: number, sx: number, sy: number): Round {
  const drawn = Math.max(0, Math.min(radius * Math.max(sx, sy), (width * sx) / 2, (height * sy) / 2));
  if (sx <= 0 || sy <= 0) return { css: "", drawn };
  return { css: `${(drawn / sx).toFixed(2)}px / ${(drawn / sy).toFixed(2)}px`, drawn };
}

/** A rounded box as an SVG path, `radius` at every corner. */
export function pillPath(left: number, top: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const [l, t, rt, b] = [left, top, left + width, top + height];
  const n = (value: number) => value.toFixed(2);
  return `M${n(l + r)} ${n(t)}H${n(rt - r)}A${n(r)} ${n(r)} 0 0 1 ${n(rt)} ${n(t + r)}V${n(b - r)}A${n(r)} ${n(r)} 0 0 1 ${n(rt - r)} ${n(b)}H${n(l + r)}A${n(r)} ${n(r)} 0 0 1 ${n(l)} ${n(b - r)}V${n(t + r)}A${n(r)} ${n(r)} 0 0 1 ${n(l + r)} ${n(t)}Z`;
}
