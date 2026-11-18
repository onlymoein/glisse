// What a held tab lens shows bends at its rim, as iOS 27's does: near the rim
// it draws what lies further in, so labels stretch out to the edge. The colours
// don't part, in light or dark: on iOS a held tab's label stays solid, and split
// rays left a dark fringe round it over anything but black.
//
// The filter goes on the lens's own copy of the labels rather than on the
// backdrop, so it works in every browser, Safari included. It's fixed to the
// lens and the labels move under it, so it's made once for each size.
//
// The maps are greys, one for each direction: Chrome converts a map's colours
// to a wide-gamut display's before displacing by them, which would bend a
// pull across sideways, but greys come through unchanged. WebKit draws an SVG
// filter on HTML in bounding-box units, so every filter here is in them, and
// each direction gets its own pass with its own scale.

import { painted, paintings, pool, type Pool } from "./painting";

const SVG = "http://www.w3.org/2000/svg";

/** How far in, in px, the rim reaches for what it shows at its very edge. */
export const BEND_REACH = 7;
/** How wide the band round the rim that bends is, in px. */
export const BEND_BAND = 15;
/** How far, in px, what the rim bends is softened, as iOS softens it. */
export const BEND_BLUR = 0.9;
/** The bend grows with the lift in this many steps. Each is a filter of its own. */
export const BEND_STEPS = 8;

const filters = new Map<string, string[]>();
// What each size's filters are made of, to take away once no tab bar is that size.
const made = new Map<string, { elements: SVGElement[]; maps: string }>();
let madeIds = 0;
let defs: SVGDefsElement | undefined;

function svg(name: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function container(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const root = svg("svg", { width: 0, height: 0, "aria-hidden": "true" });
  root.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
  defs = svg("defs", {}) as SVGDefsElement;
  root.append(defs);
  document.body.append(root);
  return defs;
}

/** The key a tab bar's lens of this size is held by in `bends`. */
export const bendKey = (width: number, height: number): string => `${Math.round(width * 2) / 2}x${Math.round(height * 2) / 2}`;

/** The bend filters in use: a tab bar holds its lens's size, and drops it when the lens changes size or goes. */
export const bends: Pool = pool(4, (key) => {
  const entry = made.get(key);
  made.delete(key);
  filters.delete(key);
  if (!entry) return;
  for (const element of entry.elements) element.remove();
  paintings.drop(entry.maps);
});

/** WebKit draws an SVG filter on HTML only in bounding-box units. */
const boxUnits = (): boolean => /AppleWebKit\//.test(navigator.userAgent) && !/Chrom(?:e|ium)\//.test(navigator.userAgent);

/**
 * Filters that bend the rim of a capsule `width` by `height`, from barely to
 * fully, one for each step of the lift. Index 0 is the first step, not none.
 */
export function bendFilters(width: number, height: number, ready?: (filters: string[]) => void): string[] {
  const w = Math.round(width * 2) / 2;
  const h = Math.round(height * 2) / 2;
  const key = bendKey(width, height);
  const cached = filters.get(key);
  if (cached) return cached;

  // The maps are drawn off the page, and the filters follow them. Until then the labels under
  // the lens don't bend.
  const density = Math.min(devicePixelRatio || 1, 2);
  const maps = `bend-${w}x${h}-${density}`;
  const drawn = painted(maps, { kind: "bend", args: [w, h, density] }, () => ready?.(bendFilters(width, height, ready)));
  if (!drawn) return [];
  const [across, down, band] = drawn.urls as [string, string, string];
  const result: string[] = [];
  const base = `liquidglass-bend-${madeIds++}`;
  const elements: SVGElement[] = [];
  const box = boxUnits();
  const unit = box ? "objectBoundingBox" : "userSpaceOnUse";
  const place = box ? { x: 0, y: 0, width: 1, height: 1 } : { x: 0, y: 0, width: w, height: h };
  for (let step = 1; step <= BEND_STEPS; step++) {
    const id = `${base}-${step}`;
    const filter = svg("filter", {
      id,
      ...place,
      filterUnits: unit,
      primitiveUnits: unit,
      "color-interpolation-filters": "sRGB",
    });
    filter.append(
      svg("feImage", { href: across, ...place, preserveAspectRatio: "none", result: "across-map" }),
      svg("feImage", { href: down, ...place, preserveAspectRatio: "none", result: "down-map" }),
      svg("feImage", { href: band, ...place, preserveAspectRatio: "none", result: "band" }),
    );
    // Each pull, with an alpha of one half, which is no pull, for the direction it doesn't
    // pull in. Set here rather than in the image, which would store its grey premultiplied.
    for (const pull of ["across", "down"]) {
      const half = svg("feComponentTransfer", { in: `${pull}-map`, result: pull });
      half.append(svg("feFuncA", { type: "linear", slope: 0, intercept: 0.5 }));
      filter.append(half);
    }
    const reach = (BEND_REACH * 2 * step) / BEND_STEPS;
    filter.append(
      svg("feDisplacementMap", {
        in: "SourceGraphic",
        in2: "across",
        scale: box ? reach / w : reach,
        xChannelSelector: "R",
        yChannelSelector: "A",
        result: "bent-x",
      }),
      svg("feDisplacementMap", {
        in: "bent-x",
        in2: "down",
        scale: box ? reach / h : reach,
        xChannelSelector: "A",
        yChannelSelector: "R",
        result: "bent",
      }),
    );
    // Softened where it bends, and as sharp as ever where it doesn't. The displacement
    // samples the nearest pixel, which leaves stair-steps the blur also smooths.
    const blur = BEND_BLUR * (step / BEND_STEPS);
    filter.append(
      svg("feGaussianBlur", { in: "bent", stdDeviation: box ? `${blur / w} ${blur / h}` : blur, result: "soft" }),
      svg("feComposite", { in: "soft", in2: "band", operator: "in", result: "soft-rim" }),
      svg("feComposite", { in: "bent", in2: "band", operator: "out", result: "sharp-middle" }),
      svg("feComposite", { in: "soft-rim", in2: "sharp-middle", operator: "arithmetic", k2: 1, k3: 1 }),
    );
    container().append(filter);
    elements.push(filter);
    result.push(`url("#${id}")`);
  }

  filters.set(key, result);
  made.set(key, { elements, maps });
  paintings.hold(maps);
  bends.made(key);
  return result;
}
