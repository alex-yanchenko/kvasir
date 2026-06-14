/** Flatten HTML to plain text: drop tags, collapse whitespace. Shared by the tour
 * and review guides to turn a step's body/detail into chat-context text. */
export const stripHtml = (html: string | undefined): string =>
  (html || "")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
