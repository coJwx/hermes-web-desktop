import { useEffect, useState, useMemo } from "react";
import {
  Palette,
  Languages,
  RotateCw,
  Download,
  LogOut,
  User,
  Type,
} from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@nous-research/ui/ui/components/card";
import { Select, SelectOption } from "@nous-research/ui/ui/components/select";
import { ConfirmDialog } from "@nous-research/ui/ui/components/confirm-dialog";
import { BUILTIN_THEMES, THEME_DEFAULT_FONT_ID, useTheme } from "@/themes";
import { useI18n, LOCALE_META } from "@/i18n";
import type { Locale } from "@/i18n";
import {
  api,
  type StatusResponse,
  type UpdateCheckResponse,
  type AuthMeResponse,
} from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import {
  sharedGatewayProfiles,
  sharedGatewayRestartDescription,
} from "@/lib/shared-gateway";
import { useSystemActions } from "@/contexts/useSystemActions";
import { ThemeSwatch } from "@/components/ThemeSwitcher";

export default function SettingsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6 max-w-4xl pb-12">
      <div>
        <h1 className="text-xl font-medium tracking-tight">
          {t.settingsPage?.title ?? t.app.nav?.settings ?? "Settings"}
        </h1>
        <p className="text-xs text-text-tertiary mt-1">
          {t.settingsPage?.description ??
            "Manage appearance, language, system actions, and account."}
        </p>
      </div>

      <ThemeSettingsSection />
      <LanguageSettingsSection />
      <GatewayActionsSection status={status} />
      <AccountSection />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Theme & Font Settings                                              */
/* ------------------------------------------------------------------ */

function ThemeSettingsSection() {
  const { themeName, availableThemes, setTheme, fontId, fontChoices, setFont } =
    useTheme();
  const { t } = useI18n();

  const currentTheme = availableThemes.find((th) => th.name === themeName);
  const paletteTheme = BUILTIN_THEMES[themeName] ?? currentTheme?.definition;

  return (
    <Card className="border border-current/10 bg-background-base">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-midground" />
          <CardTitle className="text-sm font-medium">
            {t.settingsPage?.appearance ?? t.theme?.title ?? "Appearance"}
          </CardTitle>
        </div>
        <CardDescription className="text-xs text-text-tertiary">
          {t.theme?.switchTheme ?? "Switch theme"} &amp; {t.theme?.fontTitle ?? "Font"}
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-current/10">
        {/* Theme select row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 first:pt-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {t.settingsPage?.theme ?? t.theme?.title ?? "Theme"}
            </div>
            <div className="text-xs text-text-tertiary mt-0.5">
              {currentTheme?.description || (t.theme?.switchTheme ?? "Select theme palette")}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-3">
            {paletteTheme && <ThemeSwatch theme={paletteTheme} />}
            <Select
              value={themeName}
              onValueChange={(val) => val && setTheme(val)}
              className="w-56 sm:w-64"
            >
              {availableThemes.map((th) => (
                <SelectOption key={th.name} value={th.name}>
                  {th.label}
                </SelectOption>
              ))}
            </Select>
          </div>
        </div>

        {/* Font select row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 last:pb-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Type className="h-3.5 w-3.5 text-text-tertiary" />
              <span className="text-sm font-medium">
                {t.settingsPage?.font ?? t.theme?.fontTitle ?? "Font"}
              </span>
            </div>
            <div className="text-xs text-text-tertiary mt-0.5">
              {fontId === THEME_DEFAULT_FONT_ID
                ? (t.theme?.fontDefaultHint ?? "Use active theme default font")
                : (fontChoices.find((f) => f.id === fontId)?.label ?? "Custom font")}
            </div>
          </div>
          <div className="shrink-0">
            <Select
              value={fontId}
              onValueChange={(val) => val && setFont(val)}
              className="w-56 sm:w-64"
            >
              <SelectOption value={THEME_DEFAULT_FONT_ID}>
                {t.theme?.fontDefault ?? "Theme default"}
              </SelectOption>
              {fontChoices.map((f) => (
                <SelectOption key={f.id} value={f.id}>
                  {`${f.label} (${f.category.toUpperCase()})`}
                </SelectOption>
              ))}
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Language Settings                                                  */
/* ------------------------------------------------------------------ */

function LanguageSettingsSection() {
  const { locale, setLocale, t } = useI18n();
  const allLocales = Object.entries(LOCALE_META) as Array<
    [Locale, (typeof LOCALE_META)[Locale]]
  >;
  const current = LOCALE_META[locale];

  return (
    <Card className="border border-current/10 bg-background-base">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Languages className="h-4 w-4 text-midground" />
          <CardTitle className="text-sm font-medium">
            {t.settingsPage?.language ?? t.language?.switchTo ?? "Language"}
          </CardTitle>
        </div>
        <CardDescription className="text-xs text-text-tertiary">
          {t.language?.selectLanguage ?? "Select display language"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {current?.name ?? locale}
            </div>
            <div className="text-xs text-text-tertiary mt-0.5">
              {t.language?.selectLanguage ?? "Select display language"}
            </div>
          </div>
          <div className="shrink-0">
            <Select
              value={locale}
              onValueChange={(val) => val && setLocale(val as Locale)}
              className="w-56 sm:w-64"
            >
              {allLocales.map(([loc, meta]) => (
                <SelectOption key={loc} value={loc}>
                  {`${meta.name} (${loc.toUpperCase()})`}
                </SelectOption>
              ))}
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Gateway Actions (Restart & Update)                                 */
/* ------------------------------------------------------------------ */

function GatewayActionsSection({ status }: { status: StatusResponse | null }) {
  const { t } = useI18n();
  const { activeAction, isBusy, isRunning, pendingAction, runAction } =
    useSystemActions();
  const canUpdateHermes = status?.can_update_hermes === true;
  const sharedGateway = sharedGatewayProfiles(status);

  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [updateConfirmInfo, setUpdateConfirmInfo] =
    useState<UpdateCheckResponse | null>(null);
  const [updateConfirmChecking, setUpdateConfirmChecking] = useState(false);

  useEffect(() => {
    if (!updateConfirmOpen) {
      setUpdateConfirmInfo(null);
      return;
    }
    let cancelled = false;
    setUpdateConfirmChecking(true);
    api
      .checkHermesUpdate(false)
      .then((info) => {
        if (!cancelled) setUpdateConfirmInfo(info);
      })
      .catch(() => {
        if (!cancelled) setUpdateConfirmInfo(null);
      })
      .finally(() => {
        if (!cancelled) setUpdateConfirmChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [updateConfirmOpen]);

  const updateConfirmDescription = useMemo(() => {
    if (updateConfirmInfo?.behind && updateConfirmInfo.behind > 0) {
      const cmd = updateConfirmInfo.update_command;
      const n = updateConfirmInfo.behind;
      return `This will run 'hermes update' (${cmd}) and pull ${n} new commit${n === 1 ? "" : "s"}. The gateway restarts when the update finishes; the current session keeps its prompt cache until then.`;
    }
    const cmd = updateConfirmInfo?.update_command ?? "hermes update";
    return (
      t.status.updateHermesConfirmMessage ??
      `This will run 'hermes update' (${cmd}) and restart the gateway when it finishes.`
    );
  }, [t.status.updateHermesConfirmMessage, updateConfirmInfo]);

  return (
    <Card className="border border-current/10 bg-background-base">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <RotateCw className="h-4 w-4 text-midground" />
          <CardTitle className="text-sm font-medium">
            {t.settingsPage?.system ?? t.app.system ?? "System & Gateway"}
          </CardTitle>
        </div>
        <CardDescription className="text-xs text-text-tertiary">
          {t.settingsPage?.systemDescription ??
            t.status.gateway ??
            "Gateway operations and updates"}
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-current/10">
        {/* Restart Gateway row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 first:pt-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {t.status.restartGateway}
            </div>
            <div className="text-xs text-text-tertiary mt-0.5">
              {sharedGateway
                ? sharedGatewayRestartDescription(sharedGateway)
                : (t.status.restartGatewayConfirmMessage ??
                  "Restart the Hermes gateway process. Connected channels and active sessions reconnect afterward.")}
            </div>
          </div>
          <div className="shrink-0">
            <Button
              type="button"
              outlined
              disabled={isBusy}
              onClick={() => setRestartConfirmOpen(true)}
              prefix={
                <RotateCw
                  className={cn(
                    "h-3.5 w-3.5",
                    (pendingAction === "restart" ||
                      (activeAction === "restart" && isRunning)) &&
                      "animate-spin",
                  )}
                />
              }
            >
              {activeAction === "restart" && isRunning
                ? t.status.restartingGateway
                : t.status.restartGateway}
            </Button>
          </div>
        </div>

        {/* Update Hermes row */}
        {canUpdateHermes && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {t.status.updateHermes}
              </div>
              <div className="text-xs text-text-tertiary mt-0.5">
                {status?.version ? `v${status.version}` : ""}
                {updateConfirmInfo?.behind
                  ? ` (${updateConfirmInfo.behind} commits behind)`
                  : ""}
              </div>
            </div>
            <div className="shrink-0">
              <Button
                type="button"
                outlined
                disabled={isBusy}
                onClick={() => setUpdateConfirmOpen(true)}
                prefix={<Download className="h-3.5 w-3.5" />}
              >
                {activeAction === "update" && isRunning
                  ? t.status.updatingHermes
                  : t.status.updateHermes}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        cancelLabel={t.common.cancel}
        confirmLabel={sharedGateway ? "Restart all" : t.status.restartGateway}
        description={
          sharedGateway
            ? sharedGatewayRestartDescription(sharedGateway)
            : (t.status.restartGatewayConfirmMessage ??
              "This restarts the Hermes gateway process. Connected channels and active sessions will reconnect afterward.")
        }
        loading={pendingAction === "restart"}
        onCancel={() => setRestartConfirmOpen(false)}
        onConfirm={() => {
          setRestartConfirmOpen(false);
          void runAction("restart");
        }}
        open={restartConfirmOpen}
        title={
          sharedGateway
            ? "Restart the shared gateway?"
            : (t.status.restartGatewayConfirmTitle ?? `${t.status.restartGateway}?`)
        }
      />

      <ConfirmDialog
        cancelLabel={t.common.cancel}
        confirmLabel={t.status.updateHermesConfirmNow ?? "Update now"}
        description={
          updateConfirmChecking ? t.common.loading : updateConfirmDescription
        }
        loading={pendingAction === "update" || updateConfirmChecking}
        onCancel={() => setUpdateConfirmOpen(false)}
        onConfirm={() => {
          setUpdateConfirmOpen(false);
          void runAction("update");
        }}
        open={updateConfirmOpen}
        title={t.status.updateHermesConfirmTitle ?? `${t.status.updateHermes}?`}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Account & Logout Section                                           */
/* ------------------------------------------------------------------ */

function AccountSection() {
  const { t } = useI18n();
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const gated =
    typeof window !== "undefined" && !!window.__HERMES_AUTH_REQUIRED__;

  useEffect(() => {
    if (!gated) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .getAuthMe()
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch((err: unknown) => {
        if (
          !cancelled &&
          err instanceof ApiError &&
          (err.status === 401 || err.status === 403)
        ) {
          setMe(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gated]);

  const handleLogout = () => {
    void api.logout();
  };

  return (
    <Card className="border border-current/10 bg-background-base">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-midground" />
          <CardTitle className="text-sm font-medium">
            {gated
              ? (t.settingsPage?.account ?? "Account")
              : (t.settingsPage?.localMode ?? "Session & Auth")}
          </CardTitle>
        </div>
        <CardDescription className="text-xs text-text-tertiary">
          {gated
            ? (t.settingsPage?.accountDescription ??
              "Logged-in user details and session management")
            : (t.settingsPage?.localModeDescription ??
              "Dashboard is running in local mode without authentication.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {loading ? (
            <div className="text-xs text-text-tertiary">
              {t.settingsPage?.loadingAccount ?? "Loading account details…"}
            </div>
          ) : gated && me ? (
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {me.display_name || me.email || me.user_id}
              </div>
              <div className="text-xs text-text-tertiary mt-0.5">
                via {me.provider} {me.email ? `(${me.email})` : ""}
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {gated
                  ? (t.settingsPage?.notLoggedIn ?? "Not logged in")
                  : (t.settingsPage?.localMode ?? "Local Mode")}
              </div>
              <div className="text-xs text-text-tertiary mt-0.5">
                {t.settingsPage?.localModeDescription ??
                  "Dashboard is running in local mode without authentication."}
              </div>
            </div>
          )}

          <div className="shrink-0">
            <Button
              type="button"
              outlined
              onClick={handleLogout}
              prefix={<LogOut className="h-3.5 w-3.5 text-destructive" />}
              className="text-destructive hover:text-destructive"
            >
              {t.settingsPage?.logout ?? "Log out"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
