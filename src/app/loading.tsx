import { BrandGlyph } from "@/components/dashboard/brand-mark";

export default function Loading() {
  return (
    <main className="route-state">
      <div className="route-state__mark">
        <BrandGlyph className="route-state__glyph" />
      </div>
      <p>Preparing the dashboard…</p>
    </main>
  );
}
