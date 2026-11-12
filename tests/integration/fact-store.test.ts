import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createFactService, type FactGenerator } from "@/lib/facts/service";
import { createPrismaFactStore } from "@/lib/facts/store";

// Runs against the real db at DATABASE_URL (needs migrations applied).
// Tests create their own users and delete them after, so it's safe to run
// against a dev db.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const store = createPrismaFactStore(prisma);

const createdUserIds: string[] = [];

async function createUser() {
  const user = await prisma.user.create({
    data: {
      googleId: `test-${randomUUID()}`,
      email: "integration-test@example.com",
      favoriteMovie: "Alien",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

afterEach(async () => {
  // facts + locks go with the user (cascade)
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("fact queries are scoped to user and movie", () => {
  it("never returns another user's facts for the same movie", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await prisma.fact.create({
      data: { userId: alice.id, movie: "Alien", content: "Alice's fact" },
    });

    expect(await store.recentFacts(bob.id, "Alien", 10)).toEqual([]);
    expect(await store.recentFacts(alice.id, "Alien", 10)).toHaveLength(1);
  });

  it("returns facts for the requested movie only, newest first", async () => {
    const user = await createUser();
    const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
    await prisma.fact.create({ data: { userId: user.id, movie: "Alien", content: "old", createdAt: at(0) } });
    await prisma.fact.create({ data: { userId: user.id, movie: "Alien", content: "new", createdAt: at(90) } });
    await prisma.fact.create({ data: { userId: user.id, movie: "Heat", content: "other", createdAt: at(120) } });

    const facts = await store.recentFacts(user.id, "Alien", 10);

    expect(facts.map((fact) => fact.content)).toEqual(["new", "old"]);
    expect(facts[0].createdAt).toEqual(at(90));
  });
});

describe("generation lock", () => {
  it("is granted to exactly one of many simultaneous requests", async () => {
    const user = await createUser();
    const now = new Date();

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        store.acquireLock(user.id, "Alien", randomUUID(), now, 30_000),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.isLocked(user.id, "Alien", now)).toBe(true);
  });

  it("can be taken again after it is released", async () => {
    const user = await createUser();
    const now = new Date();
    expect(await store.acquireLock(user.id, "Alien", "first", now, 30_000)).toBe(true);
    expect(await store.acquireLock(user.id, "Alien", "second", now, 30_000)).toBe(false);

    await store.releaseLock(user.id, "Alien", "first");

    expect(await store.isLocked(user.id, "Alien", now)).toBe(false);
    expect(await store.acquireLock(user.id, "Alien", "second", now, 30_000)).toBe(true);
  });

  it("is only released by the request that holds it", async () => {
    const user = await createUser();
    const now = new Date();
    await store.acquireLock(user.id, "Alien", "holder", now, 30_000);

    await store.releaseLock(user.id, "Alien", "someone-else");

    expect(await store.isLocked(user.id, "Alien", now)).toBe(true);
  });

  it("lets exactly one request take over an expired lock", async () => {
    const user = await createUser();
    const start = new Date();
    await store.acquireLock(user.id, "Alien", "crashed", start, 30_000);
    const later = new Date(start.getTime() + 30_001);
    expect(await store.isLocked(user.id, "Alien", later)).toBe(false);

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        store.acquireLock(user.id, "Alien", randomUUID(), later, 30_000),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("is separate for each user and each movie", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const now = new Date();

    expect(await store.acquireLock(alice.id, "Alien", "a", now, 30_000)).toBe(true);
    expect(await store.acquireLock(bob.id, "Alien", "b", now, 30_000)).toBe(true);
    expect(await store.acquireLock(alice.id, "Heat", "c", now, 30_000)).toBe(true);
  });
});

describe("saving a fact requires still holding the lock", () => {
  const input = (userId: string, content: string) => ({
    userId,
    movie: "Alien",
    content,
    createdAt: new Date(),
  });

  it("saves and releases the lock in one step", async () => {
    const user = await createUser();
    const now = new Date();
    await store.acquireLock(user.id, "Alien", "mine", now, 30_000);

    const fact = await store.saveFactIfLockHeld(input(user.id, "ok"), "mine");

    expect(fact?.content).toBe("ok");
    expect(await store.isLocked(user.id, "Alien", now)).toBe(false);
  });

  it("refuses to save after another request took over the lock", async () => {
    const user = await createUser();
    const start = new Date();
    await store.acquireLock(user.id, "Alien", "slow", start, 30_000);
    const later = new Date(start.getTime() + 30_001);
    expect(await store.acquireLock(user.id, "Alien", "fast", later, 30_000)).toBe(true);

    expect(await store.saveFactIfLockHeld(input(user.id, "late"), "slow")).toBeNull();
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(0);
    // and it must not have released the new owner's lock
    expect(await store.isLocked(user.id, "Alien", later)).toBe(true);

    const saved = await store.saveFactIfLockHeld(input(user.id, "on time"), "fast");
    expect(saved?.content).toBe("on time");
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("saves once when the same token is used concurrently", async () => {
    const user = await createUser();
    await store.acquireLock(user.id, "Alien", "mine", new Date(), 30_000);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.saveFactIfLockHeld(input(user.id, `attempt ${i}`), "mine"),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("stores one fact when a save races a takeover of the expired lock", async () => {
    // run it a few times, the interleaving is up to postgres
    for (let round = 0; round < 15; round++) {
      const user = await createUser();
      const start = new Date();
      await store.acquireLock(user.id, "Alien", "slow", start, 30_000);
      const later = new Date(start.getTime() + 30_001);

      const [lateSave, takeover] = await Promise.all([
        store.saveFactIfLockHeld(input(user.id, "slow fact"), "slow"),
        store.acquireLock(user.id, "Alien", "fast", later, 30_000),
      ]);

      // whichever way it went, the old owner saved XOR lost the lock first
      expect(takeover).toBe(true);
      const count = await prisma.fact.count({ where: { userId: user.id } });
      expect(count).toBe(lateSave ? 1 : 0);
      expect(await store.isLocked(user.id, "Alien", later)).toBe(true);
    }
  });
});

describe("fact service on Postgres", () => {
  it("stores one fact when a stalled request outlives its lock", async () => {
    const user = await createUser();
    let current = Date.now();
    let releaseSlow!: (fact: string) => void;
    const slow = new Promise<string>((resolve) => (releaseSlow = resolve));
    const generate = vi
      .fn<FactGenerator>()
      .mockImplementationOnce(() => slow)
      .mockResolvedValueOnce("fact from request 2");
    const service = createFactService({
      store,
      generate,
      now: () => new Date(current),
      pollIntervalMs: 20,
    });

    const first = service.getFact(user.id, "Alien");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    current += 30_001; // request 1's lock is now expired
    const second = await service.getFact(user.id, "Alien");
    releaseSlow("fact from request 1");
    const late = await first;

    const rows = await prisma.fact.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("fact from request 2");
    expect(second.source).toBe("generated");
    expect(late.fact.id).toBe(second.fact.id);
  });

  it("stores one fact when many requests arrive together", async () => {
    const user = await createUser();
    const generate = vi.fn<FactGenerator>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return "One fact for everyone.";
    });
    const service = createFactService({ store, generate, pollIntervalMs: 25 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.getFact(user.id, "Alien")),
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
    expect(new Set(results.map((result) => result.fact.id)).size).toBe(1);
    expect(await prisma.factGenerationLock.count({ where: { userId: user.id } })).toBe(0);
  });

  it("serves the cached fact inside the window and a new one after it", async () => {
    const user = await createUser();
    let current = Date.now();
    let calls = 0;
    const service = createFactService({
      store,
      generate: async () => `fact ${++calls}`,
      now: () => new Date(current),
    });

    const first = await service.getFact(user.id, "Alien");
    current += 59_000;
    const second = await service.getFact(user.id, "Alien");
    current += 1_000;
    const third = await service.getFact(user.id, "Alien");

    expect([first.source, second.source, third.source]).toEqual([
      "generated",
      "cache",
      "generated",
    ]);
    expect(second.fact.id).toBe(first.fact.id);
    expect(third.fact.content).toBe("fact 2");
  });
});
