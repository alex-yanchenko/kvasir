// The walkthrough card. Step state + page commands live in tour.ts; this renders
// the current step, navigates, drags/resizes (persisted), and keeps the
// bottom-edge anchor behavior: when the pointer is over the footer buttons,
// a step change keeps the buttons under the cursor by growing the card upward.
import type { JSX } from "react";
import type { WalkthroughStep } from "@prw/runes/spec";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { sanitizeSpecHtml } from "../../sanitize";
import { useDrag } from "../hooks/useDrag";
import { useResizePersist } from "../hooks/useResizePersist";
import { getSnapshot, subscribe } from "../store";
import { tourStore } from "../tour";

export function TourCard(): JSX.Element | null {
  useSyncExternalStore(subscribe, getSnapshot);
  const step = tourStore.step();
  if (!step) return null;
  return <Card step={step} />;
}

function Card({ step }: { step: WalkthroughStep }): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(!!tourStore.pos()); // a restored position counts as moved
  const overFooterRef = useRef(false);
  const anchorRef = useRef<{ prevBottom: number } | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const stepIdx = tourStore.stepIdx();
  const count = tourStore.stepCount();

  // collapse the details when the step changes
  useEffect(() => setShowDetail(false), [stepIdx]);

  // keyboard: arrows (or ⌘/Ctrl+Home/End) navigate, Escape closes
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const next = e.key === "ArrowRight" || (meta && e.key === "End");
      const prev = e.key === "ArrowLeft" || (meta && e.key === "Home");
      if (next && tourStore.stepIdx() < tourStore.stepCount() - 1) {
        e.preventDefault();
        tourStore.goto(tourStore.stepIdx() + 1);
      } else if (prev && tourStore.stepIdx() > 0) {
        e.preventDefault();
        tourStore.goto(tourStore.stepIdx() - 1);
      } else if (e.key === "Escape") tourStore.close();
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  // bottom-edge anchoring across a step change (see header comment)
  useLayoutEffect(() => {
    const el = cardRef.current;
    const a = anchorRef.current;
    anchorRef.current = null;
    if (el && a) {
      el.style.top = `${a.prevBottom - el.offsetHeight}px`;
      el.style.bottom = "auto";
    }
  }, [stepIdx]);
  const snapshotAnchor = () => {
    const el = cardRef.current;
    anchorRef.current =
      el && movedRef.current && overFooterRef.current
        ? { prevBottom: el.getBoundingClientRect().bottom }
        : null;
  };

  const onHeadDown = useDrag(cardRef, {
    ignore: ".prw-x",
    onMoved: () => {
      movedRef.current = true;
    },
    onEnd: (pos) => tourStore.setPos(pos),
  });
  useResizePersist(cardRef, (size) => tourStore.setSize(size));

  const pos = tourStore.pos();
  const size = tourStore.size();
  return (
    <div
      ref={cardRef}
      className="prw-card"
      style={{
        ...(pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : null),
        ...(size ? { width: size.w, height: size.h } : null),
      }}
      onMouseMove={(e) => {
        overFooterRef.current = e.target instanceof Element && !!e.target.closest(".prw-foot");
      }}
      onMouseLeave={() => {
        overFooterRef.current = false;
      }}
    >
      <div className="prw-head" onMouseDown={onHeadDown}>
        <span className="prw-eyebrow">PR WALKTHROUGH</span>
        <span className="prw-head-actions">
          <button
            className="prw-x"
            aria-label="Ask about this step"
            data-prw-tip="Ask about this step (sends the step's context)"
            onClick={() => tourStore.askAboutStep()}
          >
            💬
          </button>
          <button
            className="prw-x"
            aria-label="Re-scroll and redraw"
            data-prw-tip="Re-scroll & redraw"
            onClick={() => tourStore.goto(stepIdx)}
          >
            ⟳
          </button>
          <button className="prw-x" aria-label="Close" onClick={() => tourStore.close()}>
            ×
          </button>
        </span>
      </div>
      <div className="prw-body">
        <p className="prw-title">{step.title}</p>
        <div className="prw-prose" dangerouslySetInnerHTML={{ __html: sanitizeSpecHtml(step.body) }} />
        {step.detail && (
          <>
            <button className="prw-more" onClick={() => setShowDetail((d) => !d)}>
              {showDetail ? "Hide details ▴" : "Show details ▾"}
            </button>
            {showDetail && (
              <div
                className="prw-prose prw-detail"
                dangerouslySetInnerHTML={{ __html: sanitizeSpecHtml(step.detail) }}
              />
            )}
          </>
        )}
      </div>
      <div className="prw-foot">
        <button
          className="prw-btn"
          style={{ opacity: stepIdx === 0 ? 0.4 : 1 }}
          onClick={() => {
            snapshotAnchor();
            tourStore.back();
          }}
        >
          ← Back
        </button>
        <button
          className="prw-btn prw-btn-primary"
          onClick={() => {
            snapshotAnchor();
            tourStore.next();
          }}
        >
          {stepIdx === count - 1 ? "Finish ✓" : "Next →"}
        </button>
        <span className="prw-count">
          {stepIdx + 1} / {count}
        </span>
      </div>
    </div>
  );
}
