import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { adminState, claimDesk } from "@/lib/shop.functions";

/**
 * Signed-in + desk-owner gate shared by /admin and the order view
 * (/admin/orders/$id). Renders `children` only for the desk owner.
 */
export function DeskGate({ children, title = "Admin" }: { children: ReactNode; title?: string }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <p className="text-muted">Checking the desk…</p>;
  if (!user) {
    return (
      <div>
        <h1 className="text-4xl">{title}</h1>
        <p className="mt-2 max-w-lg text-muted">Sign in to add, edit, and delete listings and orders. Shoppers do not use this login.</p>
        <Link to="/login" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">Sign in</Link>
      </div>
    );
  }
  return <OwnerCheck title={title}>{children}</OwnerCheck>;
}

function OwnerCheck({ children, title }: { children: ReactNode; title: string }) {
  const [state, setState] = useState<"loading" | "claim" | "refused" | "denied" | "open">("loading");
  const [error, setError] = useState("");
  const [refusal, setRefusal] = useState("");

  useEffect(() => {
    adminState()
      .then((next) => {
        if (next.isOwner) setState("open");
        else if (next.ownerExists) setState("denied");
        else if (next.canClaim) setState("claim");
        else {
          setRefusal(next.refusal ?? "This account cannot claim the farm desk.");
          setState("refused");
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "The desk did not open."));
  }, []);

  async function claim() {
    setError("");
    try {
      await claimDesk();
      setState("open");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim the desk.");
    }
  }

  if (state === "open") return <>{children}</>;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">Private</p>
          <h1 className="text-4xl">{title}</h1>
        </div>
        <UserButton />
      </div>
      {error ? <p className="mt-3 text-sm text-barn">{error}</p> : null}
      {state === "loading" && !error ? <p className="mt-4 text-muted">Opening the desk…</p> : null}
      {state === "claim" ? (
        <div className="mt-4 max-w-lg rounded-card border border-line bg-paper p-4">
          <p>This browser is signed in, and the desk has no owner yet. Claim it to manage listings and orders.</p>
          <button type="button" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper" onClick={() => void claim()}>
            This is my farm desk
          </button>
        </div>
      ) : null}
      {state === "refused" ? <p className="mt-4 max-w-lg">{refusal}</p> : null}
      {state === "denied" ? <p className="mt-4">This farm desk belongs to another account.</p> : null}
    </div>
  );
}
