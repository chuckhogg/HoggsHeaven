import { Link, useRouterState } from "@tanstack/react-router";
import { Mail, Menu, ShoppingBag, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { LOGO_URL } from "@/lib/catalog";
import { cartCount, hydrateFarm, useFarm } from "@/lib/farm-store";

const links = [
  { to: "/", label: "Home", exact: true },
  { to: "/shop", label: "Shop", exact: false },
  { to: "/about", label: "About", exact: true },
  { to: "/track", label: "Track order", exact: true },
  { to: "/admin", label: "Admin", exact: true },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const farm = useFarm();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    hydrateFarm();
  }, []);
  const count = cartCount(farm.cart);

  return (
    <div className="min-h-screen bg-cream text-ink">
      <div className="bg-ink text-cream">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
          <span>Shelbyville, Kentucky · Farm pickup or USPS/UPS shipping</span>
          <a className="inline-flex items-center gap-2" href="mailto:farm@hoggs.org">
            <Mail className="size-4" aria-hidden />
            farm@hoggs.org
          </a>
        </div>
      </div>
      <header className="sticky top-0 z-20 border-b border-line bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="mr-auto flex items-center">
            <img src={LOGO_URL} alt="Hogg's Heaven Farm" className="h-12 w-auto object-contain sm:h-16" />
          </Link>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-paper md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <nav className="hidden items-center gap-5 md:flex">
            {links.map((link) => {
              const active = link.exact ? path === link.to : path.startsWith(link.to);
              return (
                <Link key={link.to} to={link.to} className={active ? "font-semibold text-barn" : "text-muted"}>
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <Link
            to="/cart"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-paper px-4 font-semibold"
          >
            <ShoppingBag className="size-4" aria-hidden />
            Cart
            <span className="inline-grid min-w-6 place-items-center rounded-full bg-barn px-1 text-sm text-paper">{count}</span>
          </Link>
        </div>
        {open ? (
          <nav className="flex flex-col gap-1 border-t border-line px-4 py-3 md:hidden">
            {links.map((link) => (
              <Link key={link.to} to={link.to} className="min-h-11 py-2 text-lg" onClick={() => setOpen(false)}>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
      <footer className="bg-ink text-cream">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-3">
          <div>
            <strong className="font-display text-xl">Hogg's Heaven Farm</strong>
            <p className="mt-2 text-sm text-cream/80">
              Husband-and-wife hatchery on five acres in Shelby County. Rare and heritage poultry, raised for health and type.
            </p>
          </div>
          <div className="text-sm">
            <strong>Visit</strong>
            <p className="mt-2 text-cream/80">
              Shelbyville, Kentucky 40065
              <br />
              <a href="mailto:farm@hoggs.org">farm@hoggs.org</a>
            </p>
          </div>
          <div className="text-sm">
            <strong>Shop</strong>
            <p className="mt-2 text-cream/80">
              <Link to="/shop" search={{ f: "all" }} className="text-gold">Hatching eggs and chicks</Link>
              <br />
              <Link to="/track" className="text-gold">Track an order</Link>
              <br />
              <a className="text-gold" href="https://www.facebook.com/hoggsheaven" target="_blank" rel="noreferrer">
                Facebook
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
