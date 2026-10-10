import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Settings } from "lucide-react";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import type { StatusResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { SidebarTooltip } from "@/components/SidebarTooltip";
import { PluginSlot } from "@/plugins";

export function SidebarFooter({
  collapsed = false,
  onNavigate,
  status,
  tooltipWarmRef,
}: SidebarFooterProps) {
  const { t } = useI18n();
  const location = useLocation();
  const isActive = location.pathname === "/settings";

  const [hovered, setHovered] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLElement | null>(null);

  const settingsLabel = t.app.nav?.settings ?? "Settings";

  const showTooltip = (event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    setHovered(true);
    setTooltipAnchor(event.currentTarget);
  };

  const hideTooltip = () => {
    setHovered(false);
    setTooltipAnchor(null);
  };

  return (
    <div
      className={cn(
        "flex shrink-0 items-center border-t border-current/10",
        collapsed
          ? "flex-col gap-2 px-2 py-3"
          : "justify-between gap-2 px-4 py-2.5",
      )}
    >
      <div className={cn("flex items-center gap-2", collapsed && "flex-col")}>
        <PluginSlot name="header-right" />
        <Link
          to="/settings"
          onClick={onNavigate}
          onMouseEnter={collapsed ? showTooltip : undefined}
          onMouseLeave={collapsed ? hideTooltip : undefined}
          onFocus={collapsed ? showTooltip : undefined}
          onBlur={collapsed ? hideTooltip : undefined}
          aria-label={settingsLabel}
          className={cn(
            "flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/40",
            isActive
              ? "text-midground bg-current/10 font-medium"
              : "text-text-secondary hover:text-foreground hover:bg-current/5",
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <span className="font-sans text-display text-xs tracking-wider uppercase">
              {settingsLabel}
            </span>
          )}
        </Link>
      </div>

      <Typography
        className={cn(
          "font-mono-ui text-xs tabular-nums tracking-[0.08em] text-text-tertiary lowercase",
          collapsed && "text-[0.65rem] text-center",
        )}
        title={status?.version != null ? `v${status.version}` : undefined}
      >
        {status?.version != null ? `v${status.version}` : "—"}
      </Typography>

      {collapsed && hovered && tooltipAnchor && (
        <SidebarTooltip
          anchor={tooltipAnchor}
          label={settingsLabel}
          warmRef={tooltipWarmRef}
        />
      )}
    </div>
  );
}

interface SidebarFooterProps {
  collapsed?: boolean;
  onNavigate?: () => void;
  status: StatusResponse | null;
  tooltipWarmRef?: React.RefObject<number>;
}
