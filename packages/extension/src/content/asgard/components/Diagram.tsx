// Renders a walkthrough's optional mermaid flow diagram. mermaid is lazy-loaded
// (see mermaidLoader) so it costs nothing unless a diagram is actually opened.
// The render is async and effect-driven; a failed parse shows a quiet fallback
// rather than throwing.
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { loadMermaid } from "../mermaidLoader";

// mermaid requires a unique element id per render call; a monotonic counter avoids
// Math.random and stays stable across re-renders of the same source.
let renderSeq = 0;

export function Diagram({ source }: Readonly<{ source: string }>): JSX.Element {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    setSvg("");
    renderSeq += 1;
    const id = `kvasir-diagram-${renderSeq}`;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const rendered = await mermaid.render(id, source);
        if (alive) setSvg(rendered.svg);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [source]);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="diagram">
      {failed ? (
        <p className="text-sm text-destructive">Couldn’t render this diagram.</p>
      ) : (
        // mermaid renders with securityLevel:"strict", which sanitizes the source into safe SVG.
        <div className="kvasir-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}
