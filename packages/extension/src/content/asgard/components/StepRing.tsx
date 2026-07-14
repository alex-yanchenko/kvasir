// The G1 step head shared by the walkthrough and review tabs: a 38px gradient
// ring filled to the current step (count inside) beside an eyebrow + title.
import type { JSX } from "react";

const RING_R = 15.5; // 38px box, 3px stroke — r keeps the stroke inside the viewBox
const RING_C = 2 * Math.PI * RING_R;

/** Rotated -90° so progress starts at 12 o'clock; the count span stays upright
 * outside the rotation. The arc carries .kvasir-ring-fill so step changes sweep
 * (the consumer must keep this node mounted across navigation). */
export function StepRing({ index, count }: Readonly<{ index: number; count: number }>): JSX.Element {
  return (
    <div className="relative size-[38px] shrink-0" data-testid="step-ring">
      <svg viewBox="0 0 38 38" className="-rotate-90" aria-hidden="true">
        <circle cx="19" cy="19" r={RING_R} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          className="kvasir-ring-fill"
          cx="19"
          cy="19"
          r={RING_R}
          fill="none"
          stroke="url(#kvasir-ring-grad)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - (index + 1) / count)}
        />
        <defs>
          <linearGradient id="kvasir-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--aurora-2)" />
            <stop offset="1" stopColor="var(--aurora-1)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums">
        {index + 1}/{count}
      </span>
    </div>
  );
}

/** The full G1 head: ring beside the eyebrow + title. The eyebrow string carries
 * the position context (the consumer decides its shape — file vs repo·file);
 * index/count drive the ring. Consumers must keep this mounted across step
 * navigation so the ring's fill sweeps. */
export function StepHead({
  eyebrow,
  eyebrowTestId,
  title,
  index,
  count,
}: Readonly<{
  eyebrow: string;
  eyebrowTestId: string;
  title: string;
  index: number;
  count: number;
}>): JSX.Element {
  return (
    <div className="mb-3 flex items-center gap-3">
      <StepRing index={index} count={count} />
      <div className="min-w-0">
        <div
          className="truncate font-mono text-[9.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground"
          data-testid={eyebrowTestId}
        >
          {eyebrow}
        </div>
        <h3 className="text-[19px] font-[650] leading-tight tracking-tight">{title}</h3>
      </div>
    </div>
  );
}
