import { beforeEach, describe, expect, it, vi } from "vitest";
import { FactUnavailableError } from "@/lib/facts/service";

const getCurrentUser = vi.fn();
const getFact = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/facts", () => ({
  factService: { getFact: (...args: unknown[]) => getFact(...args) },
}));

const { GET } = await import("@/app/api/fact/route");

const alice = {
  id: "user-alice",
  googleId: "google-alice",
  email: "alice@example.com",
  name: "Alice",
  image: null,
  favoriteMovie: "Arrival",
};

beforeEach(() => {
  getCurrentUser.mockReset();
  getFact.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/fact authorization", () => {
  it("rejects requests without a session and never touches facts", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    expect(getFact).not.toHaveBeenCalled();
  });

  it("only ever asks for the session user's own facts", async () => {
    getCurrentUser.mockResolvedValue(alice);
    getFact.mockResolvedValue({
      source: "generated",
      fact: {
        id: "fact-1",
        userId: alice.id,
        movie: "Arrival",
        content: "A fact about Arrival.",
        createdAt: new Date(),
      },
    });

    const response = await GET();
    const body = await response.json();

    // handler takes no args, so id + movie can only come from the session
    expect(GET.length).toBe(0);
    expect(getFact).toHaveBeenCalledExactlyOnceWith(alice.id, "Arrival");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.fact).toEqual({
      id: "fact-1",
      movie: "Arrival",
      content: "A fact about Arrival.",
      createdAt: expect.any(String),
    });
    // user id shouldn't leak into the response
    expect(JSON.stringify(body)).not.toContain(alice.id);
  });

  it("returns 409 when the user has not chosen a movie yet", async () => {
    getCurrentUser.mockResolvedValue({ ...alice, favoriteMovie: null });

    const response = await GET();

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("NO_FAVORITE_MOVIE");
    expect(getFact).not.toHaveBeenCalled();
  });
});

describe("GET /api/fact error handling", () => {
  it("returns a friendly 503 when no fact can be produced", async () => {
    getCurrentUser.mockResolvedValue(alice);
    getFact.mockRejectedValue(new FactUnavailableError());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("FACT_UNAVAILABLE");
    expect(body.error.message).toMatch(/try again/i);
  });

  it("hides internal error details from the client", async () => {
    getCurrentUser.mockResolvedValue(alice);
    getFact.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("ECONNREFUSED");
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
  });

  it("returns the JSON error when the session lookup itself fails", async () => {
    getCurrentUser.mockRejectedValue(new Error("db is down"));

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("db is down");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getFact).not.toHaveBeenCalled();
  });

  it("reports how old a cached fact is", async () => {
    getCurrentUser.mockResolvedValue(alice);
    getFact.mockResolvedValue({
      source: "cache",
      fact: {
        id: "fact-1",
        userId: alice.id,
        movie: "Arrival",
        content: "A fact about Arrival.",
        createdAt: new Date(Date.now() - 42_500),
      },
    });

    const body = await (await GET()).json();

    expect(body.source).toBe("cache");
    expect(body.ageSeconds).toBe(42);
  });
});
