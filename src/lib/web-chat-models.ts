import type { ModelOptionProvider } from "@hermes/shared";

export interface WebChatModelIdentity { provider: string; model: string }

/** Session detail may carry model_config as serialized JSON on older servers. */
export function storedSessionModel(config: unknown, fallbackModel?: string | null): WebChatModelIdentity | null {
  let value = config;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const nested = root.gateway_runtime;
  const runtime = nested && typeof nested === "object" && !Array.isArray(nested) ? nested as Record<string, unknown> : null;
  const route = typeof runtime?.provider === "string" && runtime.provider.trim() ? runtime : root;
  const provider = typeof route.provider === "string" ? route.provider.trim() : "";
  const model = [route.model, root.model, fallbackModel].find((entry) => typeof entry === "string" && entry.trim());
  return provider && typeof model === "string" ? { provider, model: model.trim() } : null;
}

export function sessionModelValue(provider: string, model: string): string {
  if ([provider, model].some((value) => !value || /\s/.test(value) || value.startsWith("--"))) {
    throw new Error("Invalid provider or model identifier.");
  }
  return model + " --provider " + provider + " --session";
}

export function webChatModelLabel(provider: string | undefined, model: string | undefined): string {
  return model ? (provider ? provider + "/" + model : model) : "Hermes";
}

/** Keep the active model selectable even when it is absent from the provider's cached catalog. */
export function webChatModelProviders(rows: ModelOptionProvider[], provider: string, model: string): ModelOptionProvider[] {
  const providers = rows.map((row) => ({ ...row, models: [...new Set(row.models || [])] }));
  const current = providers.find((row) => row.slug === provider || row.aliases?.includes(provider));
  if (current && model && !current.models.includes(model)) current.models.unshift(model);
  if (!current && provider && model) providers.unshift({ slug: provider, name: provider, models: [model], is_current: true });
  return providers;
}
