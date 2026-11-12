"use client";

import { useCallback, useEffect, useState } from "react";
import type { FactErrorResponse, FactResponse } from "@/lib/facts/contract";

type State =
  | { status: "loading" }
  | { status: "ready"; data: FactResponse }
  | { status: "error"; message: string };

const GENERIC_ERROR = "We couldn't load a fact. Please try again.";

async function fetchFact(): Promise<State> {
  try {
    const response = await fetch("/api/fact", { cache: "no-store" });
    const body: unknown = await response.json();
    if (response.ok) return { status: "ready", data: body as FactResponse };
    const message = (body as Partial<FactErrorResponse>).error?.message;
    return { status: "error", message: message ?? GENERIC_ERROR };
  } catch {
    return { status: "error", message: GENERIC_ERROR };
  }
}

function caption({ source, ageSeconds }: FactResponse): string {
  switch (source) {
    case "generated":
      return "Freshly generated.";
    case "cache":
      return `Generated ${ageSeconds}s ago. A new fact is available once this one is a minute old.`;
    case "stale":
      return "We couldn't generate a new fact just now, so here's your most recent one.";
  }
}

export function FactCard() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setState(await fetchFact());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchFact().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-labelledby="fact-heading"
      className="rounded-2xl border border-line bg-panel p-6 sm:p-8"
    >
      <div className="flex items-center justify-between gap-4">
        <h2
          id="fact-heading"
          className="text-xs font-semibold uppercase tracking-[0.3em] text-marquee"
        >
          Fun fact
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.status === "loading"}
          className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-paper transition hover:border-muted disabled:cursor-wait disabled:opacity-60"
        >
          {state.status === "loading" ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div aria-live="polite" className="mt-5 min-h-24">
        {state.status === "loading" ? (
          <div className="space-y-3" aria-label="Loading a fun fact">
            <div className="h-4 w-full animate-pulse rounded bg-line" />
            <div className="h-4 w-11/12 animate-pulse rounded bg-line" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
          </div>
        ) : null}

        {state.status === "ready" ? (
          <>
            <p className="font-display text-xl leading-relaxed text-paper">
              {state.data.fact.content}
            </p>
            <p className="mt-4 text-sm text-muted">{caption(state.data)}</p>
          </>
        ) : null}

        {state.status === "error" ? (
          <p role="alert" className="text-base text-danger">
            {state.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
