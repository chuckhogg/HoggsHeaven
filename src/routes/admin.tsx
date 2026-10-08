import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminOrders } from "@/components/admin-orders";
import { AdminProducts } from "@/components/admin-products";
import { AdminShipping } from "@/components/admin-shipping";
import { Shell } from "@/components/shell";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { adminState, claimDesk } from "@/lib/shop.functions";

export const Route = createFileRoute("/admin")({ component: AdminPage });

function AdminPage() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <Shell><p className="text-muted">Checking the desk…</p></Shell>;
  if (!user) {
    return (
      <Shell>
        <h1 className="text-4xl">Admin</h1>
        <p className="mt-2 max-w-lg text-muted">Sign in to add, edit, and delete listings and orders. Shoppers do not use this login.</p>
        <Link to="/login" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">Sign in</Link>
      </Shell>
    );
  }
  return (
    <Shell>
      <Desk />
    </Shell>
  );
}

function Desk() {
  const [tab, setTab] = useState<"orders" | "listings" | "shipping">("orders");
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

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">Private</p>
          <h1 className="text-4xl">Admin</h1>
        </div>
        <UserButton />
      </div>
      {error ? <p className="mt-3 text-sm text-barn">{error}</p> : null}
      {state === "loading" ? <p className="mt-4 text-muted">Opening the desk…</p> : null}
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
      {state === "open" ? (
        <div className="mt-4">
          <div className="flex gap-2">
            <button type="button" className={tab === "orders" ? "inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-paper" : "inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4"} onClick={() => setTab("orders")}>Orders</button>
            <button type="button" className={tab === "listings" ? "inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-paper" : "inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4"} onClick={() => setTab("listings")}>Listings</button>
            <button type="button" className={tab === "shipping" ? "inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-paper" : "inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4"} onClick={() => setTab("shipping")}>Shipping</button>
          </div>
          <div className="mt-6">{tab === "orders" ? <AdminOrders /> : tab === "listings" ? <AdminProducts /> : <AdminShipping />}</div>
        </div>
      ) : null}
    </div>
  );
}
