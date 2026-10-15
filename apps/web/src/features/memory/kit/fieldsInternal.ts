import { cx } from "@friday/ui";
import { useId } from "react";

export { cx };

/** React's `useId` yields `:r1:`; strip the colons so the value is a valid CSS/ARIA id fragment. */
export function useStableIdLike(prefix: string): string {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}
