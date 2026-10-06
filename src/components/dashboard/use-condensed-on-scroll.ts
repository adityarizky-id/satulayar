"use client";

import { useEffect, useState } from "react";

/**
 * True once the page has scrolled past the threshold. The sticky filter bar
 * uses it to shrink so a long dashboard keeps more room for the data.
 */
export function useCondensedOnScroll(threshold = 40): boolean {
  const [isCondensed, setIsCondensed] = useState(false);

  useEffect(() => {
    function read() {
      // A dead band stops the bar flickering when a scroll lands on the edge.
      setIsCondensed((current) =>
        current
          ? window.scrollY > threshold - 16
          : window.scrollY > threshold,
      );
    }

    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [threshold]);

  return isCondensed;
}
