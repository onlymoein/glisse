import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefAttributes,
} from "react";

import { useControllable } from "./internal/controllable";
import { cx } from "./internal/cx";
import { createJelly, FLAT, glint } from "./internal/jelly";
import { useRefraction } from "./internal/refraction";
import { pillPath, roundAtScale } from "./internal/pill";
import { createSpring, DROP, LIFT, type Spring } from "./internal/spring";
import { useStyles } from "./internal/styles";
import thumbCss from "./styles/thumb.css?inline";
import segmentedControlCss from "./styles/segmented-control.css?inline";

export interface SegmentedItem {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  items: SegmentedItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

// The lens is larger than the thumb it lifts from, by what iOS 27 measures in parity/.
const LENS_EXTRA = 25;
const THUMB_INSET = 2;
const THUMB_HEIGHT = 28;
const LENS_HEIGHT = 44;
// How far a finger moves before it's a drag and not a tap.
const SLOP = 4;
// A thumb held for less than this still shows its lens.
const LINGER = 240;
// A tapped choice is reached by the lens, which settles flat when it arrives. Measured on iOS.
const FLIGHT = 300;
// How long a controlled owner has to take up a choice (a router navigating, say) before the
// thumb goes back to the one it still has.
const PATIENCE = 2500;
// Held, the lens enlarges the labels it's over, each about its own centre, as the tab bar's does.
const ZOOM = 0.16;

interface Face {
  face: HTMLElement;
  copy: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A row of mutually exclusive choices, with a thumb that slides to the chosen one and lifts into a lens under a finger. */
export const SegmentedControl: ForwardRefExoticComponent<SegmentedControlProps & RefAttributes<HTMLDivElement>> =
  /* @__PURE__ */ forwardRef<HTMLDivElement, SegmentedControlProps>(function SegmentedControl(
    { items, value: valueProp, defaultValue, onValueChange, className, style, ...props },
    ref,
  ) {
  useStyles(["thumb", thumbCss], ["segmented-control", segmentedControlCss]);
    const [value, setValue] = useControllable<string | undefined, string>(valueProp, defaultValue ?? items[0]?.value, onValueChange);
    const rootRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLSpanElement>(null);
    const lensRef = useRef<HTMLSpanElement>(null);
    const spring = useRef<Spring | null>(null);
    const dragged = useRef(false);
    const fly = useRef<() => void>(() => {});
    const choose = useRef<(i: number) => void>(() => {});
    const index = Math.max(0, items.findIndex((item) => item.value === value));
    const latest = useRef({ items, index, setValue });
    useImperativeHandle(ref, () => rootRef.current!);
    useRefraction(lensRef, true);

    useEffect(() => {
      latest.current = { items, index, setValue };
    });

    useEffect(() => {
      const root = rootRef.current!;
      const thumb = thumbRef.current!;
      const lens = lensRef.current!;
      let at = index;
      let amount = 0;
      let grow = { x: 1, y: 1 };
      let across = 0;
      let squashed = FLAT;
      let cut = false;
      const span = () => root.getBoundingClientRect().width / Math.max(latest.current.items.length, 1);

      // The lens carries its own copy of the labels, enlarged, over the real ones, which are cut
      // away under it so they don't show twice. Only the faces are cut: a segment under the
      // lens still takes a touch. Copied each time it lifts, so it's the labels as they are.
      const row = document.createElement("span");
      row.className = "lg-segmented-row";
      lens.append(row);
      let faces: Face[] = [];
      let box = { left: 0, top: 0, width: 0, height: 0 };
      const copy = () => {
        box = { left: lens.offsetLeft, top: lens.offsetTop, width: lens.offsetWidth, height: lens.offsetHeight };
        faces = [...root.querySelectorAll<HTMLElement>(".lg-segment-face")].map((face) => {
          const segment = face.parentElement!;
          const style = getComputedStyle(face);
          const copied = face.cloneNode(true) as HTMLElement;
          copied.className = "lg-segmented-copy";
          const left = segment.offsetLeft + face.offsetLeft;
          const top = segment.offsetTop + face.offsetTop;
          Object.assign(copied.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${face.offsetWidth}px`,
            height: `${face.offsetHeight}px`,
            display: style.display,
            alignItems: style.alignItems,
            justifyContent: style.justifyContent,
            gap: style.gap,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontStyle: style.fontStyle,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            textAlign: style.textAlign,
            letterSpacing: style.letterSpacing,
            whiteSpace: style.whiteSpace,
            color: `var(--lg-segmented-lens-color, ${style.color})`,
          });
          return { face, copy: copied, left, top, width: face.offsetWidth, height: face.offsetHeight };
        });
        row.replaceChildren(...faces.map((item) => item.copy));
      };

      // Both follow the same place: the flat thumb at rest, the lens under a finger.
      const draw = () => {
        const segment = span();
        across = segment;
        const face = segment - THUMB_INSET * 2;
        const width = face + LENS_EXTRA;
        const shown = Math.min(1, Math.max(0, amount));
        grow = {
          x: face / width + (1 - face / width) * amount,
          y: THUMB_HEIGHT / LENS_HEIGHT + (1 - THUMB_HEIGHT / LENS_HEIGHT) * amount,
        };
        if (shown > 0.001 && lens.style.visibility !== "visible") copy();
        thumb.style.transform = `translateX(${at * segment}px)`;
        thumb.style.opacity = String(1 - shown);
        lens.style.opacity = String(Math.min(1, shown * 4));
        lens.style.visibility = shown > 0.001 ? "visible" : "hidden";
        lens.style.setProperty("--lg-lift", String(shown));
        const zoom = String(1 + ZOOM * shown);
        for (const item of faces) item.copy.style.scale = zoom;
        // Out of sight there's nothing to trail, so the lens starts afresh each time it's lifted.
        jelly.follow(at * segment, shown < 0.01);
        place();
      };
      // The lens stretches along a drag, and thins across it, by how far it trails the finger.
      const place = () => {
        const x = at * across + squashed.shift;
        const sx = grow.x * squashed.x;
        const sy = grow.y * squashed.y;
        lens.style.transform = `translate(${x}px, -50%) scale(${sx}, ${sy})`;
        if (lens.style.visibility !== "visible") {
          // At rest its corners are the stylesheet's, which is what the glass measures.
          lens.style.borderRadius = "";
          if (cut) for (const item of faces) item.face.style.clipPath = "";
          cut = false;
          return;
        }
        const { width, height } = box;
        const round = roundAtScale(width, height, height / 2, sx, sy);
        lens.style.borderRadius = round.css;
        // Where the lens is on the control, and the copy put back where the labels are.
        const drawnWidth = width * sx;
        const drawnHeight = height * sy;
        const left = box.left + x + (width - drawnWidth) / 2;
        const top = box.top - height / 2 + (height - drawnHeight) / 2;
        const ox = box.left + x + width / 2;
        const oy = box.top;
        row.style.transform = `translate(${width / 2}px, ${height / 2}px) scale(${1 / sx}, ${1 / sy}) translate(${-ox}px, ${-oy}px)`;
        const hole = pillPath(left, top, drawnWidth, drawnHeight, round.drawn);
        row.style.clipPath = `path("${hole}")`;
        for (const item of faces) {
          const over = left < item.left + item.width && left + drawnWidth > item.left;
          item.face.style.clipPath = over
            ? `path(evenodd, "M-200 -200H${(item.width + 200).toFixed(2)}V${(item.height + 200).toFixed(2)}H-200Z${pillPath(left - item.left, top - item.top, drawnWidth, drawnHeight, round.drawn)}")`
            : "";
        }
        cut = true;
      };
      const jelly = createJelly(
        () => lens.offsetWidth,
        (shape) => {
          squashed = shape;
          lens.style.setProperty("--lg-glint", glint(shape.shift));
          place();
        },
        // Dragged straight to the finger, so the body trails it as the slider's does.
        0.35,
      );
      const motion = createSpring(index, 443, 34, (next) => {
        at = next;
        draw();
      });
      const lift = createSpring(0, ...LIFT, (next) => {
        amount = next;
        draw();
      });
      motion.paint();
      spring.current = motion;

      let linger = 0;
      let waiting = 0;
      let heldAt = 0;
      const hold = () => {
        clearTimeout(linger);
        heldAt = performance.now();
        lift.tune(...LIFT);
        lift.set(1);
      };
      const release = () => {
        clearTimeout(linger);
        linger = window.setTimeout(() => {
          lift.tune(...DROP);
          lift.set(0);
        }, Math.max(0, LINGER - (performance.now() - heldAt)));
      };

      fly.current = () => {
        clearTimeout(linger);
        lift.tune(...LIFT);
        lift.set(1);
        linger = window.setTimeout(() => {
          lift.tune(...DROP);
          lift.set(0);
        }, FLIGHT);
      };

      // A choice is shown at once and kept while the owner takes it up, which may be after a
      // navigation, not a render: going back to the old one in between and then forward again
      // read as the control fighting the finger. Only an owner that never takes it up sends it back.
      choose.current = (i: number) => {
        const { items: all, index: current, setValue: set } = latest.current;
        const item = all[i];
        clearTimeout(waiting);
        motion.set(i);
        if (!item || i === current) return;
        waiting = window.setTimeout(() => motion.set(latest.current.index), PATIENCE);
        set(item.value);
      };

      // The thumb is taken hold of, not the track, and moves by as much as the finger does.
      let drag: { id: number; x: number; from: number } | null = null;
      let pressing = false;
      const nearest = (place: number) => {
        const { items: all, index: current } = latest.current;
        let best = current;
        let distance = Infinity;
        all.forEach((item, i) => {
          if (!item.disabled && Math.abs(i - place) < distance) {
            best = i;
            distance = Math.abs(i - place);
          }
        });
        return best;
      };
      const down = (event: PointerEvent) => {
        if (!event.isPrimary || event.button) return;
        const pressed = (event.target as Element).closest<HTMLButtonElement>(".lg-segment");
        if (!pressed || pressed.disabled) return;
        dragged.current = false;
        // Elsewhere, nothing moves until it's let go, when the click chooses.
        if (Number(pressed.dataset.index) !== latest.current.index) return;
        pressing = true;
        hold();
        drag = { id: event.pointerId, x: event.clientX, from: latest.current.index };
        root.setPointerCapture?.(event.pointerId);
      };
      const moved = (event: PointerEvent) => {
        if (event.pointerId !== drag?.id) return;
        const by = event.clientX - drag.x;
        if (!dragged.current && Math.abs(by) < SLOP) return;
        dragged.current = true;
        const last = latest.current.items.length - 1;
        motion.set(Math.min(last, Math.max(0, drag.from + by / Math.max(span(), 1))), true);
      };
      const up = (event: PointerEvent) => {
        if (pressing) release();
        pressing = false;
        if (event.pointerId !== drag?.id) return;
        drag = null;
        if (dragged.current && event.type === "pointerup") {
          choose.current(nearest(at));
          return;
        }
        // Back to the chosen one, wherever it let go.
        motion.set(latest.current.index);
      };

      root.addEventListener("pointerdown", down);
      root.addEventListener("pointermove", moved);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return () => {
        clearTimeout(linger);
        clearTimeout(waiting);
        root.removeEventListener("pointerdown", down);
        root.removeEventListener("pointermove", moved);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        motion.stop();
        lift.stop();
        jelly.stop();
        row.remove();
        for (const item of faces) item.face.style.clipPath = "";
      };
      // The springs start where the control does, then follow `index` below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The owner took up a choice, or made one of its own.
    useEffect(() => {
      spring.current?.set(index);
    }, [index]);

    const move = (event: KeyboardEvent<HTMLDivElement>) => {
      const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const open = items.filter((item) => !item.disabled);
      const at = open.findIndex((item) => item.value === value);
      const next = open[(at + step + open.length) % open.length];
      if (!next) return;
      setValue(next.value);
      event.currentTarget.querySelector<HTMLElement>(`[data-index="${items.indexOf(next)}"]`)?.focus();
    };

    return (
      <div
        ref={rootRef}
        role="radiogroup"
        className={cx("lg-segmented", className)}
        style={{ ...style, "--lg-segments": items.length } as CSSProperties}
        onKeyDown={move}
        {...props}
      >
        <span ref={thumbRef} className="lg-segmented-thumb" aria-hidden />
        <span ref={lensRef} className="lg-glass lg-segmented-lens" aria-hidden />
        {items.map((item, i) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            className="lg-segment"
            aria-checked={i === index}
            tabIndex={i === index ? 0 : -1}
            disabled={item.disabled}
            data-index={i}
            onClick={() => {
              // The click that ends a drag has already chosen.
              if (!dragged.current && i !== index) {
                fly.current();
                choose.current(i);
              }
              dragged.current = false;
            }}
          >
            <span className="lg-segment-face">{item.label}</span>
          </button>
        ))}
      </div>
    );
  });
