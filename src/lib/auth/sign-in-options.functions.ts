import { createServerFn } from "@tanstack/react-start";
import { signInOptions, type SignInOption } from "./sign-in-options";

/**
 * The sign-in buttons this deployment can finish. Read at request time because
 * provider credentials are runtime secrets (Cloudflare Pages / Vercel env), not
 * build-time values. Returns ids and labels only, never credentials.
 */
export const getSignInOptions = createServerFn({ method: "GET" }).handler(
  async (): Promise<SignInOption[]> => signInOptions(process.env),
);
