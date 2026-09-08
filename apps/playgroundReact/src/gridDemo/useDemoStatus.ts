import { useCallback, useState } from "react";

/** Compact application-owned status text. Empty until an action needs feedback. */
export function useDemoStatus(): {
  status: string;
  announce: (message: string) => void;
} {
  const [status, setStatus] = useState("");
  const announce = useCallback((message: string) => {
    setStatus(message);
  }, []);
  return { status, announce };
}
