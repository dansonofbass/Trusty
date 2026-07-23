"use client";

import { Suspense } from "react";
import DocsView from "@/components/docs/DocsView";

/** Docs — the private workspace as a directory (flat in P1, folders in P3). */
export default function DocsPage() {
  // useSearchParams (deep links ?open= / ?new=1) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <DocsView />
    </Suspense>
  );
}
