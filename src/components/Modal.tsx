import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { cn, themedBody } from "@/lib/utils";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { useI18n } from "@/i18n";

export type ModalSize = "sm" | "md" | "lg" | "xl";

export const MODAL_SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showCloseButton?: boolean;
  headerActions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  closeOnBackdropClick?: boolean;
  closeDisabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  zIndex?: number;
}

export function Modal({
  open,
  onClose,
  size = "md",
  title,
  subtitle,
  children,
  footer,
  showCloseButton = true,
  headerActions,
  className,
  bodyClassName,
  closeOnBackdropClick = true,
  closeDisabled = false,
  ariaLabel,
  ariaLabelledBy,
  zIndex = 100,
}: ModalProps) {
  const requestClose = () => { if (!closeDisabled) onClose(); };
  const containerRef = useModalBehavior({ open, onClose: requestClose });
  const titleId = React.useId();
  const descriptionId = React.useId();
  const { t } = useI18n();

  if (!open) return null;

  const resolvedLabelledBy = ariaLabelledBy || (title ? titleId : undefined);

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={resolvedLabelledBy}
      aria-label={ariaLabel}
      aria-describedby={subtitle ? descriptionId : undefined}
      style={{ zIndex }}
      className="fixed inset-0 flex items-center justify-center bg-background/85 backdrop-blur-sm p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        className={cn(
          themedBody,
          "relative w-full min-w-0 border border-border bg-card shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[85dvh]",
          MODAL_SIZE_CLASSES[size],
          className,
        )}
      >
        {/* Header */}
        {(title || showCloseButton || headerActions) && (
          <header className={cn("relative shrink-0 flex flex-col p-4 sm:p-5 border-b border-border", showCloseButton && "pr-14 sm:pr-14")}>
            <div className="flex items-center justify-between gap-3">
              {title && (
                typeof title === "string" ? (
                  <h2
                    id={resolvedLabelledBy}
                    className="min-w-0 break-words font-mondwest text-display text-base tracking-wider text-foreground leading-snug"
                  >
                    {title}
                  </h2>
                ) : (
                  <div id={resolvedLabelledBy}>{title}</div>
                )
              )}
              {headerActions && (
                <div className="flex items-center gap-2">{headerActions}</div>
              )}
            </div>

            {subtitle && (
              <div id={descriptionId} className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                {subtitle}
              </div>
            )}

            {showCloseButton && (
              <Button
                ghost
                size="icon"
                type="button"
                onClick={requestClose}
                disabled={closeDisabled}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground h-10 w-10"
                aria-label={t.common.close}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </header>
        )}

        {/* Body */}
        <div
          className={cn(
            "flex-1 overflow-y-auto min-h-0 min-w-0 p-4 sm:p-6 space-y-4",
            bodyClassName,
          )}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <footer className="px-4 sm:px-6 py-4 border-t border-border bg-muted/10 flex flex-wrap items-center justify-end gap-3 shrink-0">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
