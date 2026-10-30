import { getHookByToken } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

// Runs outside the workflow VM, where getHookByToken is available.
export async function hookExists(token: string): Promise<boolean> {
  "use step";

  try {
    const hook = await getHookByToken(token);
    return hook != null;
  } catch (error) {
    if (HookNotFoundError.is(error)) return false;
    throw error;
  }
}
