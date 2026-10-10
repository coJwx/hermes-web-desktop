import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/api-error";

type Config = Record<string, unknown>;
type Schema = Record<string, Record<string, unknown>>;

/** Own the two editor representations and their last successfully saved baselines. */
export function useConfigEditor() {
  const [config, setConfig] = useState<Config | null>(null);
  const [savedConfig, setSavedConfig] = useState<Config | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [defaults, setDefaults] = useState<Config | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlText, setYamlText] = useState("");
  const [savedYaml, setSavedYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const actionInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void Promise.all([api.getConfig(), api.getSchema(), api.getDefaults(), api.getConfigRaw()])
      .then(([nextConfig, nextSchema, nextDefaults, raw]) => {
        if (cancelled) return;
        const fields = { ...nextSchema.fields } as Schema;
        // The dedicated Plugins UI owns this field, not the generic config editor.
        delete fields["memory.provider"];
        setConfig(nextConfig);
        setSavedConfig(nextConfig);
        setSchema(fields);
        setDefaults(nextDefaults);
        setCategoryOrder(nextSchema.category_order ?? []);
        setYamlText(raw.yaml);
        setSavedYaml(raw.yaml);
        setConfigPath(raw.path ?? null);
      })
      .catch((error) => { if (!cancelled) setLoadError(errorMessage(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const dirty = yamlMode ? yamlText !== savedYaml : JSON.stringify(config) !== JSON.stringify(savedConfig);

  const save = async () => {
    if (actionInFlight.current || !config || loading || loadError) return;
    actionInFlight.current = true;
    setSaving(true);
    try {
      if (yamlMode) {
        await api.saveConfigRaw(yamlText);
        setSavedYaml(yamlText);
      } else {
        await api.saveConfig(config);
        setSavedConfig(config);
      }
    } finally {
      actionInFlight.current = false;
      setSaving(false);
    }
  };

  const switchMode = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setSwitching(true);
    try {
      // Only discard the current draft after the destination is ready. A failed read
      // must leave the user in the original editor with all their edits intact.
      if (yamlMode) {
        const next = await api.getConfig();
        setConfig(next);
        setSavedConfig(next);
        setYamlText(savedYaml);
      } else {
        const raw = await api.getConfigRaw();
        setYamlText(raw.yaml);
        setSavedYaml(raw.yaml);
        setConfigPath(raw.path ?? null);
        setConfig(savedConfig);
      }
      setYamlMode(!yamlMode);
    } finally {
      actionInFlight.current = false;
      setSwitching(false);
    }
  };

  return {
    config, setConfig, schema, defaults, categoryOrder, configPath,
    yamlMode, yamlText, setYamlText, loading, loadError,
    retry: () => setAttempt((value) => value + 1),
    saving, switching, busy: saving || switching, dirty, save, switchMode,
  };
}
