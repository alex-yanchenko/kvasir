import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class combiner: clsx for conditional joins, tailwind-merge to dedupe
 * conflicting utilities (last-wins) so component overrides behave predictably. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
