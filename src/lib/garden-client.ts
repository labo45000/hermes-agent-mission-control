import type { Garden } from "./personal-dashboard";

type MutationResponse = { ok: boolean; status: number; json(): Promise<unknown> };

type GardenMutationOptions = {
  request: () => Promise<MutationResponse>;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  onSaved: (garden: Garden) => void;
  onConflict: (garden: Garden | undefined) => void;
  retryMessage: string;
};

function gardenFrom(value: unknown): Garden | undefined {
  if (!value || typeof value !== "object" || !("garden" in value)) return undefined;
  return (value as { garden?: Garden }).garden;
}

export async function executeGardenMutation(options: GardenMutationOptions): Promise<void> {
  options.setSaving(true);
  options.setError(null);
  try {
    const response = await options.request();
    if (response.ok) {
      options.onSaved(await response.json() as Garden);
      return;
    }
    if (response.status === 409) {
      options.onConflict(gardenFrom(await response.json()));
      return;
    }
    options.setError(response.status === 401 ? "Sign in to change the garden." : options.retryMessage);
  } catch {
    options.setError(options.retryMessage);
  } finally {
    options.setSaving(false);
  }
}
