import { useEffect, useRef, useState } from "react";

/** Copy feedback expires after the latest successful write; the action stays available. */
export function useClipboardCopy(text: string) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestId = useRef(0);

  useEffect(() => () => {
    clearTimeout(resetTimer.current);
    requestId.current++;
  }, []);

  const copyText = async () => {
    const request = ++requestId.current;
    try {
      await navigator.clipboard.writeText(text);
      if (request !== requestId.current) return;
      clearTimeout(resetTimer.current);
      setCopiedText(text);
      setCopyError(false);
      resetTimer.current = setTimeout(() => setCopiedText(null), 2_000);
    } catch {
      if (request !== requestId.current) return;
      clearTimeout(resetTimer.current);
      setCopiedText(null);
      setCopyError(true);
    }
  };

  return { copied: copiedText === text, copyError, copyText };
}
