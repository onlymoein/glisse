import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { expect, test } from "vitest";

import { Button, Toolbar, ToolbarGroup } from "../src";

const bar = (edge?: "uniform" | "soft" | "none") => (
  <Toolbar aria-label="Editor" edge={edge}>
    <ToolbarGroup aria-label="History">
      <Button>Undo</Button>
      <Button disabled>Redo</Button>
    </ToolbarGroup>
    <ToolbarGroup aria-label="Share">
      <Button>Share</Button>
    </ToolbarGroup>
  </Toolbar>
);

test("groups its actions on glass and forwards its ref", () => {
  const ref = createRef<HTMLDivElement>();
  render(<Toolbar ref={ref} aria-label="Editor" />);
  expect(ref.current).toBe(screen.getByRole("toolbar", { name: "Editor" }));
  expect(ref.current?.dataset.edge).toBe("uniform");

  render(bar());
  expect(screen.getByRole("group", { name: "History" }).className).toBe("lg-glass lg-toolbar-group");
});

test("moves between its actions with the arrow keys, skipping disabled ones", () => {
  render(bar());
  const undo = screen.getByRole("button", { name: "Undo" });
  const share = screen.getByRole("button", { name: "Share" });

  undo.focus();
  fireEvent.keyDown(undo, { key: "ArrowRight" });
  expect(document.activeElement).toBe(share);
  fireEvent.keyDown(share, { key: "ArrowRight" });
  expect(document.activeElement).toBe(undo);
  fireEvent.keyDown(undo, { key: "End" });
  expect(document.activeElement).toBe(share);
  fireEvent.keyDown(share, { key: "Home" });
  expect(document.activeElement).toBe(undo);
});

test("frosts its edge once content scrolls under it", () => {
  const { container } = render(<div style={{ overflowY: "auto" }}>{bar()}</div>);
  const box = container.firstElementChild as HTMLElement;
  const toolbar = screen.getByRole("toolbar");
  expect(toolbar.hasAttribute("data-scrolled")).toBe(false);

  box.scrollTop = 40;
  fireEvent.scroll(box);
  expect(toolbar.hasAttribute("data-scrolled")).toBe(true);

  box.scrollTop = 0;
  fireEvent.scroll(box);
  expect(toolbar.hasAttribute("data-scrolled")).toBe(false);
});

test("leaves its edge alone when asked to", () => {
  const { container } = render(<div style={{ overflowY: "auto" }}>{bar("none")}</div>);
  const box = container.firstElementChild as HTMLElement;
  box.scrollTop = 40;
  fireEvent.scroll(box);
  const toolbar = screen.getByRole("toolbar");
  expect(toolbar.hasAttribute("data-scrolled")).toBe(false);
  expect(toolbar.hasAttribute("data-edge")).toBe(false);
});
