import { Button } from "@nous-research/ui/ui/components/button";
import { AlertTriangle } from "lucide-react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { cn, themedBody } from "@/lib/utils";
import { useModalBehavior } from "@/hooks/useModalBehavior";

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  description?: string;
  destructive?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}

export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  description,
  destructive = false,
  loading = false,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  const requestCancel = () => { if (!loading) onCancel(); };
  const dialogRef = useModalBehavior({ open, onClose: requestCancel });
  const titleId = useId();
  const descriptionId = useId();

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestCancel();
      }}
      style={{ zIndex: 200 }}
      className="fixed inset-0 flex items-center justify-center bg-background/85 p-4"
    >
      <div
        ref={dialogRef}
        className={cn(
          themedBody,
          "relative w-full min-w-0 max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto border border-border bg-card shadow-2xl",
        )}
      >
        <div className="flex items-start gap-3.5 p-5 border-b border-border">
          {destructive && (
            <div aria-hidden className="mt-0.5 shrink-0 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-foreground"
            >
              {title}
            </h2>

            {description && (
              <p
                id={descriptionId}
                className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line mt-0.5"
              >
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-border bg-current/[0.02]">
          <Button data-autofocus type="button" outlined size="sm" onClick={requestCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            data-confirm
            type="button"
            size="sm"
            destructive={destructive}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
