"use client";

import { useActionState } from "react";
import { MOVIE_MAX_LENGTH } from "@/lib/validation";
import { saveFavoriteMovie, type OnboardingState } from "./actions";

const initialState: OnboardingState = {};

export function MovieForm() {
  const [state, formAction, pending] = useActionState(
    saveFavoriteMovie,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 text-left" noValidate>
      <label htmlFor="movie" className="text-sm font-medium text-paper">
        Favorite movie
      </label>
      <input
        id="movie"
        name="movie"
        type="text"
        required
        autoFocus
        autoComplete="off"
        // just a hint, real validation is in the server action
        maxLength={MOVIE_MAX_LENGTH}
        defaultValue={state.value ?? ""}
        placeholder="e.g. Spirited Away"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "movie-error" : undefined}
        className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-base text-paper placeholder:text-muted/60 focus:border-marquee focus:outline-none"
      />

      {state.error ? (
        <p id="movie-error" role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-full bg-marquee px-6 py-3 text-sm font-semibold text-ink transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
