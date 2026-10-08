import { useEffect, useState } from "react";
import type { SignInOption } from "./sign-in-options";
import { getSignInOptions } from "./sign-in-options.functions";

/**
 * The sign-in buttons this deployment can finish (see `./sign-in-options`).
 * Empty until the server answers, and empty on error, so a provider that is not
 * configured never shows a button.
 */
export function useSignInOptions(): { options: SignInOption[]; ready: boolean } {
  const [options, setOptions] = useState<SignInOption[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    getSignInOptions()
      .then((next) => {
        if (live) setOptions(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return { options, ready };
}
