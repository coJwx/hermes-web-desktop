import type { ModelOptionProvider } from "@hermes/shared";

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
