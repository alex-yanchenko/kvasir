import { FolderGit2, Loader2 } from "lucide-react";
import type { JSX } from "react";
import { resolveStore } from "../launcher";
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
        A deep-context walkthrough reads the PR's code from a local clone. Point kvasir at the folder your
        repositories live in, clone a fresh one, or use the diff alone.
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
        data-testid="resolve-action-set-default-root"
        onClick={() => void resolveStore.prepareCheckout("set-default-root")}
      >
        Locate my repos folder…
      </Button>
      <p className="text-xs text-muted-foreground">
        Opens a native folder picker. Choose the folder your repositories live in — kvasir remembers it and
        finds this repo and future ones under it.
      </p>
      <Button
        variant="secondary"
        disabled={needsPairing}
        data-testid="resolve-action-clone-kvasir"
        onClick={() => void resolveStore.prepareCheckout("clone-kvasir")}
      >
        Clone it into kvasir's folder
      </Button>
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
  return <Actions />;
}
