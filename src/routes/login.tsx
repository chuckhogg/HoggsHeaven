import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Shell } from "@/components/shell";
import { GROK_PROVIDERS, authClient, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "");
    const password = String(data.get("password") || "");
    const name = String(data.get("name") || "Farm desk");
    setPending(true);
    setError("");
    const result = mode === "up"
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message || "Could not sign in.");
      return;
    }
    await navigate({ to: "/admin" });
  }

  if (isPending) {
    return <Shell><p className="text-muted">Checking your session…</p></Shell>;
  }
  if (user) return <Navigate to="/admin" />;

  return (
    <Shell>
      <div className="mx-auto max-w-md rounded-card border border-line bg-paper p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-barn">Farm desk</p>
        <h1 className="mt-1 text-4xl">{mode === "up" ? "Create the desk login" : "Sign in"}</h1>
        <p className="mt-2 text-sm text-muted">Customers never need an account. This login is only for adding and editing listings and orders.</p>
        <form className="mt-4" onSubmit={onSubmit}>
          {mode === "up" ? (
            <>
              <label className="block text-sm font-semibold" htmlFor="name">Your name</label>
              <input id="name" name="name" required className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
            </>
          ) : null}
          <label className="mt-3 block text-sm font-semibold" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
          <label className="mt-3 block text-sm font-semibold" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required minLength={8} autoComplete={mode === "up" ? "new-password" : "current-password"} className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
          {error ? <p className="mt-3 text-sm text-barn">{error}</p> : null}
          <button type="submit" disabled={pending} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper disabled:opacity-60">
            {pending ? "Working…" : mode === "up" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button type="button" className="mt-3 text-sm font-semibold text-barn" onClick={() => { setMode(mode === "up" ? "in" : "up"); setError(""); }}>
          {mode === "up" ? "I already have a login" : "First time? Create the desk login"}
        </button>
        <div className="mt-5 space-y-2">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-line bg-cream px-4 font-semibold"
              onClick={() => signIn(provider.providerId, { callbackURL: "/admin" })}
            >
              Continue with {provider.label}
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}
