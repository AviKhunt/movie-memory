import { describe, expect, it } from "vitest";
import { MOVIE_MAX_LENGTH, validateMovie } from "@/lib/validation";

describe("validateMovie", () => {
  it("accepts a normal title", () => {
    expect(validateMovie("Spirited Away")).toEqual({
      ok: true,
      movie: "Spirited Away",
    });
  });

  it("trims the ends and collapses inner whitespace", () => {
    expect(validateMovie("   The \t  Matrix  ")).toEqual({
      ok: true,
      movie: "The Matrix",
    });
  });

  it("keeps punctuation and non-English titles", () => {
    expect(validateMovie("Amélie")).toEqual({ ok: true, movie: "Amélie" });
    expect(validateMovie("千と千尋の神隠し")).toEqual({
      ok: true,
      movie: "千と千尋の神隠し",
    });
    expect(validateMovie("WALL·E: 2008!")).toEqual({
      ok: true,
      movie: "WALL·E: 2008!",
    });
  });

  it("rejects empty and whitespace-only input", () => {
    expect(validateMovie("").ok).toBe(false);
    expect(validateMovie("    ").ok).toBe(false);
  });

  it("applies the length limit after trimming", () => {
    const atLimit = "a".repeat(MOVIE_MAX_LENGTH);
    expect(validateMovie(`  ${atLimit}  `)).toEqual({ ok: true, movie: atLimit });
    expect(validateMovie(`${atLimit}a`).ok).toBe(false);
  });

  it("rejects input that is not a string", () => {
    expect(validateMovie(null).ok).toBe(false);
    expect(validateMovie(undefined).ok).toBe(false);
    expect(validateMovie(42).ok).toBe(false);
    expect(validateMovie({ title: "Heat" }).ok).toBe(false);
  });

  it("rejects control characters", () => {
    expect(validateMovie("Heat\u0000").ok).toBe(false);
    expect(validateMovie("He\u0007at").ok).toBe(false);
  });

  it("returns a message the form can show", () => {
    const result = validateMovie("");
    expect(result).toEqual({ ok: false, error: "Please enter a movie title." });
  });
});
