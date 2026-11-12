import { describe, expect, it, vi } from "vitest";
import {
  createFactService,
  FactUnavailableError,
  type FactGenerator,
} from "@/lib/facts/service";
import { createClock, createMemoryStore, deferred } from "../helpers/memory-store";

const USER = "user-a";
const MOVIE = "Inception";

function setup(generate: FactGenerator) {
  const memory = createMemoryStore();
  const clock = createClock();
  const service = createFactService({
    store: memory.store,
    generate,
    now: clock.now,
    // don't actually sleep while polling
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    onError: () => {},
  });
  return { service, clock, ...memory };
}

// returns "fact 1", "fact 2", ...
function countingGenerator() {
  let calls = 0;
  return vi.fn<FactGenerator>(async () => `fact ${++calls}`);
}

describe("60-second cache window", () => {
  it("generates and stores a fact when none exists", async () => {
    const generate = countingGenerator();
    const { service, facts } = setup(generate);

    const result = await service.getFact(USER, MOVIE);

    expect(result.source).toBe("generated");
    expect(result.fact.content).toBe("fact 1");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ userId: USER, movie: MOVIE });
  });

  it("returns the cached fact while it is under 60 seconds old", async () => {
    const generate = countingGenerator();
    const { service, clock, facts } = setup(generate);
    const first = await service.getFact(USER, MOVIE);

    clock.advance(59_999);
    const second = await service.getFact(USER, MOVIE);

    expect(second.source).toBe("cache");
    expect(second.fact.id).toBe(first.fact.id);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(facts).toHaveLength(1);
  });

  it("generates a new fact once the latest one is 60 seconds old", async () => {
    const generate = countingGenerator();
    const { service, clock, facts } = setup(generate);
    const first = await service.getFact(USER, MOVIE);

    clock.advance(60_000);
    const second = await service.getFact(USER, MOVIE);

    expect(second.source).toBe("generated");
    expect(second.fact.id).not.toBe(first.fact.id);
    expect(second.fact.content).toBe("fact 2");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(facts).toHaveLength(2);
  });

  it("measures the window from the most recent fact", async () => {
    const generate = countingGenerator();
    const { service, clock } = setup(generate);
    await service.getFact(USER, MOVIE);
    clock.advance(61_000);
    const second = await service.getFact(USER, MOVIE);

    clock.advance(30_000);
    const third = await service.getFact(USER, MOVIE);

    expect(third.source).toBe("cache");
    expect(third.fact.id).toBe(second.fact.id);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a fact cached for a different movie", async () => {
    const generate = countingGenerator();
    const { service } = setup(generate);
    await service.getFact(USER, "Inception");

    const other = await service.getFact(USER, "Heat");

    expect(other.source).toBe("generated");
    expect(other.fact.movie).toBe("Heat");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("tells the generator about earlier facts so it can avoid repeats", async () => {
    const generate = countingGenerator();
    const { service, clock } = setup(generate);
    await service.getFact(USER, MOVIE);
    clock.advance(60_000);

    await service.getFact(USER, MOVIE);

    expect(generate).toHaveBeenLastCalledWith(MOVIE, ["fact 1"]);
  });
});

describe("authorization: facts are private to their user", () => {
  it("never serves one user's cached fact to another user with the same movie", async () => {
    const generate = countingGenerator();
    const { service } = setup(generate);
    const mine = await service.getFact("user-a", MOVIE);

    const theirs = await service.getFact("user-b", MOVIE);

    expect(theirs.source).toBe("generated");
    expect(theirs.fact.id).not.toBe(mine.fact.id);
    expect(theirs.fact.userId).toBe("user-b");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to another user's fact when generation fails", async () => {
    const generate = vi
      .fn<FactGenerator>()
      .mockResolvedValueOnce("a fact for user a")
      .mockRejectedValueOnce(new Error("OpenAI is down"));
    const { service } = setup(generate);
    await service.getFact("user-a", MOVIE);

    await expect(service.getFact("user-b", MOVIE)).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
  });
});

describe("burst protection", () => {
  it("generates only once when many requests arrive together", async () => {
    const pending = deferred<string>();
    const generate = vi.fn<FactGenerator>(() => pending.promise);
    const { service, facts } = setup(generate);

    const requests = Array.from({ length: 8 }, () =>
      service.getFact(USER, MOVIE),
    );
    // give all 8 time to hit the generator or start waiting
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(generate).toHaveBeenCalledTimes(1);

    pending.resolve("the one fact");
    const results = await Promise.all(requests);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(facts).toHaveLength(1);
    expect(new Set(results.map((result) => result.fact.id)).size).toBe(1);
    expect(results.filter((result) => result.source === "generated")).toHaveLength(1);
    expect(results.filter((result) => result.source === "cache")).toHaveLength(7);
  });

  it("releases the lock so the next window can generate again", async () => {
    const generate = countingGenerator();
    const { service, clock, locks } = setup(generate);

    await service.getFact(USER, MOVIE);
    expect(locks.size).toBe(0);

    clock.advance(60_000);
    const next = await service.getFact(USER, MOVIE);
    expect(next.source).toBe("generated");
    expect(locks.size).toBe(0);
  });

  it("takes over a lock left behind by a crashed request", async () => {
    const generate = countingGenerator();
    const { service, clock, store } = setup(generate);
    // lock taken, never released
    await store.acquireLock(USER, MOVIE, "dead-request", clock.now(), 30_000);

    clock.advance(30_001);
    const result = await service.getFact(USER, MOVIE);

    expect(result.source).toBe("generated");
  });

  it("does not save a second fact if its lock expired and another request took over", async () => {
    const slow = deferred<string>();
    const generate = vi
      .fn<FactGenerator>()
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValueOnce("fact from request 2");
    const { service, clock, facts, locks } = setup(generate);

    // request 1 gets the lock and hangs in generate
    const first = service.getFact(USER, MOVIE);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(generate).toHaveBeenCalledTimes(1);

    // its lock expires, request 2 takes over and finishes
    clock.advance(30_001);
    const second = await service.getFact(USER, MOVIE);
    expect(second.source).toBe("generated");

    // request 1 wakes up late with its own fact
    slow.resolve("fact from request 1");
    const late = await first;

    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("fact from request 2");
    expect(late.fact.id).toBe(second.fact.id);
    expect(late.source).toBe("cache");
    expect(locks.size).toBe(0);
  });

  it("lets different users generate at the same time", async () => {
    const generate = countingGenerator();
    const { service } = setup(generate);

    const [a, b] = await Promise.all([
      service.getFact("user-a", MOVIE),
      service.getFact("user-b", MOVIE),
    ]);

    expect(a.source).toBe("generated");
    expect(b.source).toBe("generated");
  });
});

describe("OpenAI failure handling", () => {
  it("returns the most recent fact when generation fails", async () => {
    const generate = vi
      .fn<FactGenerator>()
      .mockResolvedValueOnce("the original fact")
      .mockRejectedValueOnce(new Error("timeout"));
    const { service, clock, facts } = setup(generate);
    const first = await service.getFact(USER, MOVIE);

    clock.advance(5 * 60_000);
    const fallback = await service.getFact(USER, MOVIE);

    expect(fallback.source).toBe("stale");
    expect(fallback.fact.id).toBe(first.fact.id);
    expect(facts).toHaveLength(1);
  });

  it("throws FactUnavailableError when generation fails and nothing is cached", async () => {
    const generate = vi.fn<FactGenerator>().mockRejectedValue(new Error("500"));
    const { service, facts } = setup(generate);

    await expect(service.getFact(USER, MOVIE)).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
    expect(facts).toHaveLength(0);
  });

  it("releases the lock after a failure so the next request can retry", async () => {
    const generate = vi
      .fn<FactGenerator>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("second attempt worked");
    const { service, locks } = setup(generate);

    await expect(service.getFact(USER, MOVIE)).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
    expect(locks.size).toBe(0);

    const retry = await service.getFact(USER, MOVIE);
    expect(retry.source).toBe("generated");
    expect(retry.fact.content).toBe("second attempt worked");
  });

  it("gives waiting requests the same fallback when the generating request fails", async () => {
    const pending = deferred<string>();
    const generate = vi
      .fn<FactGenerator>()
      .mockResolvedValueOnce("the original fact")
      .mockImplementationOnce(() => pending.promise);
    const { service, clock } = setup(generate);
    const first = await service.getFact(USER, MOVIE);
    clock.advance(2 * 60_000);

    const requests = [service.getFact(USER, MOVIE), service.getFact(USER, MOVIE)];
    await new Promise((resolve) => setTimeout(resolve, 20));
    pending.reject(new Error("timeout"));
    const results = await Promise.all(requests);

    expect(generate).toHaveBeenCalledTimes(2);
    for (const result of results) {
      expect(result.source).toBe("stale");
      expect(result.fact.id).toBe(first.fact.id);
    }
  });

  it("stops waiting after the wait timeout", async () => {
    const generate = countingGenerator();
    const memory = createMemoryStore();
    const clock = createClock();
    const service = createFactService({
      store: memory.store,
      generate,
      now: clock.now,
      waitTimeoutMs: 15_000,
      // every poll = +5s
      sleep: async () => clock.advance(5_000),
      onError: () => {},
    });
    // someone else holds the lock and never finishes
    await memory.store.acquireLock(USER, MOVIE, "slow-request", clock.now(), 60_000);

    await expect(service.getFact(USER, MOVIE)).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
