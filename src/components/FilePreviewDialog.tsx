import { useEffect, useState } from "react";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Modal } from "@/components/Modal";
import { useI18n } from "@/i18n/context";
import { api, type ManagedFileEntry } from "@/lib/api";
import { errorMessage } from "@/lib/api-error";
import { filePreviewContent, MAX_FILE_PREVIEW_BYTES, type FilePreviewContent } from "@/lib/file-preview";

interface FilePreviewDialogProps {
  entry: ManagedFileEntry;
  onClose: () => void;
}

export function FilePreviewDialog({ entry, onClose }: FilePreviewDialogProps) {
  const { t } = useI18n();
  const [content, setContent] = useState<FilePreviewContent | null>(
    entry.size !== null && entry.size > MAX_FILE_PREVIEW_BYTES ? { kind: "tooLarge" } : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (entry.size !== null && entry.size > MAX_FILE_PREVIEW_BYTES) return;
    let active = true;
    void api.readFile(entry.path).then((file) => {
      if (active) setContent(filePreviewContent(file));
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [entry.path, entry.size]);

  const failedLabel = t.files.previewFailed ?? "Could not preview file";
  return (
    <Modal open onClose={onClose} size="xl" title={entry.name}
      subtitle={<span className="break-all font-mono">{entry.path}</span>}>
      {error ? (
        <p role="alert" className="text-sm text-destructive">{failedLabel}: {error}</p>
      ) : content === null ? (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-text-secondary">
          <Spinner />{t.common.loading}
        </div>
      ) : content.kind === "image" ? (
        <img src={content.source} alt={entry.name} className="mx-auto max-h-[65dvh] max-w-full object-contain"
          onError={() => setError(failedLabel)} />
      ) : content.kind === "text" ? (
        <pre tabIndex={0} aria-label={entry.name}
          className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background/40 p-4 font-mono text-sm text-foreground">{content.text}</pre>
      ) : (
        <p role="status" className="py-8 text-sm text-text-secondary">
          {content.kind === "tooLarge"
            ? t.files.previewTooLarge ?? "Preview is limited to files up to 5 MB. Use the download button for larger files."
            : t.files.previewUnsupported ?? "This binary file or text encoding cannot be previewed. Use the download button to save it."}
        </p>
      )}
    </Modal>
  );
}
