// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useDrag } from "./useDrag";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function Plain({ onEnd }: { onEnd: (p: { left: number; top: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const down = useDrag(ref, { onEnd }); // no ignore selector
  return (
    <div ref={ref} data-testid="panel" onMouseDown={down}>
      drag me
    </div>
  );
}

function Detached({ onEnd }: { onEnd: (p: { left: number; top: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null); // never attached
  const down = useDrag(ref, { onEnd });
  return (
    <button data-testid="loose" onMouseDown={down}>
      no panel
    </button>
  );
}

function WithMoved({ onMoved }: { onMoved: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const down = useDrag(ref, { onMoved, onEnd: () => {} });
  return <div ref={ref} data-testid="panel" onMouseDown={down} />;
}

function WithIgnore({ onEnd }: { onEnd: (p: { left: number; top: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const down = useDrag(ref, { ignore: "button", onEnd });
  return (
    <div ref={ref} data-testid="panel" onMouseDown={down}>
      <button data-testid="ignored">x</button>
    </div>
  );
}

describe("useDrag", () => {
  it("moves by style writes and reports the final position once", () => {
    const onEnd = vi.fn();
    const { getByTestId } = render(<Plain onEnd={onEnd} />);
    const panel = getByTestId("panel");
    fireEvent.mouseDown(panel, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 30, clientY: 40 });
    expect(panel.style.right).toBe("auto");
    fireEvent.mouseUp(document);
    expect(onEnd).toHaveBeenCalledWith({ left: 0, top: 0 }); // jsdom rects are zero
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the ref has no element", () => {
    const onEnd = vi.fn();
    const { getByTestId } = render(<Detached onEnd={onEnd} />);
    fireEvent.mouseDown(getByTestId("loose"));
    fireEvent.mouseUp(document);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("fires onMoved during the drag", () => {
    const onMoved = vi.fn();
    const { getByTestId } = render(<WithMoved onMoved={onMoved} />);
    fireEvent.mouseDown(getByTestId("panel"), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(document);
    expect(onMoved).toHaveBeenCalled();
  });

  it("ignores a mousedown on an ignored child but drags from elsewhere in the panel", () => {
    const onEnd = vi.fn();
    const { getByTestId } = render(<WithIgnore onEnd={onEnd} />);
    fireEvent.mouseDown(getByTestId("ignored"), { clientX: 5, clientY: 5 });
    fireEvent.mouseUp(document);
    expect(onEnd).not.toHaveBeenCalled();

    fireEvent.mouseDown(getByTestId("panel"), { clientX: 5, clientY: 5 }); // not the ignored child
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
    fireEvent.mouseUp(document);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
