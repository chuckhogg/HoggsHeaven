import { useEffect, useState } from "react";
import type { Product } from "@/lib/catalog";
import { listShop, type ShopSettings } from "@/lib/shop.functions";

const FALLBACK: ShopSettings = { shipEggs: 18, taxRate: 0 };

export function useCatalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<ShopSettings>(FALLBACK);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    const next = await listShop();
    setProducts(next.products);
    setSettings(next.settings);
    setReady(true);
    setError("");
    return next;
  }

  useEffect(() => {
    let live = true;
    listShop()
      .then((next) => {
        if (!live) return;
        setProducts(next.products);
        setSettings(next.settings);
        setReady(true);
      })
      .catch(() => {
        if (live) setError("The shop catalog did not load.");
      });
    return () => {
      live = false;
    };
  }, []);

  return { products, settings, ready, error, reload };
}
