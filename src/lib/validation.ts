import { z } from "zod";

export const MOVIE_MIN_LENGTH = 1;
export const MOVIE_MAX_LENGTH = 100;

// trim + collapse whitespace first, then check length.
// "  The   Matrix " -> "The Matrix"
export const movieSchema = z
  .string({ error: "Please enter a movie title." })
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(MOVIE_MIN_LENGTH, "Please enter a movie title.")
      .max(
        MOVIE_MAX_LENGTH,
        `Movie title must be ${MOVIE_MAX_LENGTH} characters or fewer.`,
      )
      // no control chars, this ends up in the OpenAI prompt and on the page
      .refine(
        (value) => !/[\u0000-\u001f\u007f]/.test(value),
        "Movie title contains invalid characters.",
      ),
  );

export type MovieValidation =
  | { ok: true; movie: string }
  | { ok: false; error: string };

export function validateMovie(input: unknown): MovieValidation {
  const result = movieSchema.safeParse(input);
  if (result.success) return { ok: true, movie: result.data };
  return {
    ok: false,
    error: result.error.issues[0]?.message ?? "Invalid movie title.",
  };
}
