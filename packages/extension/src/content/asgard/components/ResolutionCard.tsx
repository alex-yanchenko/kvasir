// The reviewer-authorized checkout resolution card, shown in the walkthrough tab body
// (the FirstRunSteps empty-state idiom — NOT a modal) when a HEAVY generate found no
// local clone (`resolveStore` is "absent"/"error"), or a spinner while /resolve or
// /prepare is in flight. The reviewer authorizes a clone (or declines to the diff); the
// extension never derives a path — the three text inputs are the reviewer's explicit,
// server-validated authorization (the extension
// knows no disk; the reviewer owns the clone decision).
import { FolderGit2, Loader2 } from "lucide-react";
import type { JSX } from "react";
import { type PrepareAction, resolveStore } from "../launcher";
import { pairingStore } from "../pairing";
import { Button } from "../ui/button";

function Spinner({ label }: Readonly<{ label: string }>): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center" data-testid="resolve-spinner">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** A path action: a labelled text input + its submit button. The reviewer types the
 * absolute path; the button is disabled until it is non-empty (and while unpaired). */
function PathAction({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  action,
  cta,
}: Readonly<{
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  action: PrepareAction;
  cta: string;
}>): JSX.Element {
  const disabled = pairingStore.needsPairing() || value.trim() === "";
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-foreground" htmlFor={`resolve-input-${action}`}>
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={`resolve-input-${action}`}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          data-testid={`resolve-input-${action}`}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          data-testid={`resolve-action-${action}`}
          onClick={onSubmit}
        >
          {cta}
        </Button>
      </div>
    </div>
  );
}

/** The choices, shown for both "absent" (fresh) and "error" (a prior /prepare failed —
 * the reason is banner-ed and the reviewer can try another action). */
function Actions(): JSX.Element {
  const needsPairing = pairingStore.needsPairing();
  const error = resolveStore.error();
  return (
    <div className="flex flex-col gap-3 p-5 text-left">
      <div className="flex items-center gap-2">
        <FolderGit2 className="size-5 shrink-0 text-primary" />
        <p className="text-sm font-medium text-foreground">No local clone of this repo yet</p>
      </div>
      <p className="text-xs text-muted-foreground">
        A deep-context walkthrough reads the PR's code from a local clone. Authorize one — or use the diff
        alone.
      </p>
      {error && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive"
          data-testid="resolve-error"
        >
          {error}
        </p>
      )}
      <Button
        variant="default"
        disabled={needsPairing}
        data-testid="resolve-action-clone-kvasir"
        onClick={() => void resolveStore.prepareCheckout("clone-kvasir")}
      >
        Clone into kvasir's folder
      </Button>
      <PathAction
        label="Use a clone I already have"
        placeholder="/absolute/path/to/repo"
        value={resolveStore.existingPath()}
        onChange={(value) => resolveStore.setExistingPath(value)}
        onSubmit={() => void resolveStore.prepareCheckout("use-existing", resolveStore.existingPath().trim())}
        action="use-existing"
        cta="Use"
      />
      <PathAction
        label="Clone somewhere else"
        placeholder="/absolute/path/for/the/clone"
        value={resolveStore.clonePath()}
        onChange={(value) => resolveStore.setClonePath(value)}
        onSubmit={() => void resolveStore.prepareCheckout("clone-dest", resolveStore.clonePath().trim())}
        action="clone-dest"
        cta="Clone"
      />
      <PathAction
        label="Set a default clones folder (asked once)"
        placeholder="/absolute/path/to/your/clones"
        value={resolveStore.defaultRoot()}
        onChange={(value) => resolveStore.setDefaultRoot(value)}
        onSubmit={() =>
          void resolveStore.prepareCheckout("set-default-root", resolveStore.defaultRoot().trim())
        }
        action="set-default-root"
        cta="Save"
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={needsPairing}
          data-testid="resolve-action-diff-only"
          onClick={() => void resolveStore.prepareCheckout("diff-only")}
        >
          Just use the diff
        </Button>
        {/* Back out of the card entirely (no walkthrough) — distinct from "use the diff",
            which generates one. Returns to the empty state's Run button. */}
        <Button variant="link" size="sm" data-testid="resolve-cancel" onClick={() => resolveStore.dismiss()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ResolutionCard(): JSX.Element {
  const status = resolveStore.status();
  if (status === "resolving") return <Spinner label="Looking for a local clone…" />;
  if (status === "preparing") return <Spinner label="Preparing the checkout…" />;
  return <Actions />; // "absent" | "error" → the choices (error banners the reason)
}
