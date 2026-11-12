import { randomUUID } from "node:crypto";

// Variant A logic: 60s cache window, burst protection, OpenAI fallback.
// Storage, the model call and the clock are injected so this can be tested
// without a db or network.

export type Fact = {
  id: string;
  userId: string;
  movie: string;
  content: string;
  createdAt: Date;
};

// generated = new fact from this request
// cache     = latest fact is < 60s old
// stale     = generation failed, returning the last fact we have
export type FactSource = "generated" | "cache" | "stale";

export type FactResult = { fact: Fact; source: FactSource };

// generation failed and there's nothing to fall back to
export class FactUnavailableError extends Error {
  constructor() {
    super("No fact could be generated and none is cached.");
    this.name = "FactUnavailableError";
  }
}

export interface FactStore {
  // facts for this user + movie only, newest first
  recentFacts(userId: string, movie: string, limit: number): Promise<Fact[]>;
  // saves the fact and releases the lock in one step, but only if `token`
  // still owns the lock. returns null if it doesn't.
  saveFactIfLockHeld(
    input: { userId: string; movie: string; content: string; createdAt: Date },
    token: string,
  ): Promise<Fact | null>;
  // true for exactly one caller until released or expired
  acquireLock(
    userId: string,
    movie: string,
    token: string,
    now: Date,
    ttlMs: number,
  ): Promise<boolean>;
  releaseLock(userId: string, movie: string, token: string): Promise<void>;
  isLocked(userId: string, movie: string, now: Date): Promise<boolean>;
}

export type FactGenerator = (
  movie: string,
  previousFacts: string[],
) => Promise<string>;

export const CACHE_WINDOW_MS = 60_000;

export type FactServiceOptions = {
  store: FactStore;
  generate: FactGenerator;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  cacheWindowMs?: number;
  lockTtlMs?: number; // has to be longer than the OpenAI timeout
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  previousFactCount?: number;
  onError?: (error: unknown) => void;
};

export function createFactService({
  store,
  generate,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  cacheWindowMs = CACHE_WINDOW_MS,
  lockTtlMs = 30_000,
  pollIntervalMs = 250,
  waitTimeoutMs = 15_000,
  previousFactCount = 5,
  onError = (error) => console.error("[facts] generation failed:", error),
}: FactServiceOptions) {
  // strictly less than 60s. at exactly 60s it's expired.
  function isFresh(fact: Fact): boolean {
    return now().getTime() - fact.createdAt.getTime() < cacheWindowMs;
  }

  // userId must come from the session, never from the client
  async function getFact(userId: string, movie: string): Promise<FactResult> {
    const [latest] = await store.recentFacts(userId, movie, 1);
    if (latest && isFresh(latest)) return { fact: latest, source: "cache" };

    // only one request per user+movie gets to call OpenAI. the rest wait
    // for that one's result (fast refreshes, multiple tabs)
    const token = randomUUID();
    const acquired = await store.acquireLock(
      userId,
      movie,
      token,
      now(),
      lockTtlMs,
    );
    if (!acquired) return waitForOtherRequest(userId, movie);

    try {
      return await generateWhileHoldingLock(userId, movie, token);
    } finally {
      // no-op after a successful save (that already released it). covers
      // the failure paths. if this fails too the lock just expires.
      await store.releaseLock(userId, movie, token).catch(onError);
    }
  }

  async function generateWhileHoldingLock(
    userId: string,
    movie: string,
    token: string,
  ): Promise<FactResult> {
    // check again, someone may have finished between our first read and
    // us getting the lock
    const recent = await store.recentFacts(userId, movie, previousFactCount);
    const latest = recent[0];
    if (latest && isFresh(latest)) return { fact: latest, source: "cache" };

    let content: string;
    try {
      content = await generate(
        movie,
        recent.map((fact) => fact.content),
      );
    } catch (error) {
      onError(error);
      if (latest) return { fact: latest, source: "stale" };
      throw new FactUnavailableError();
    }

    const fact = await store.saveFactIfLockHeld(
      { userId, movie, content, createdAt: now() },
      token,
    );
    if (!fact) {
      // we ran past the lock ttl and another request took over. its fact is
      // the one for this window, so drop ours instead of saving a second.
      return waitForOtherRequest(userId, movie);
    }
    return { fact, source: "generated" };
  }

  async function waitForOtherRequest(
    userId: string,
    movie: string,
  ): Promise<FactResult> {
    const deadline = now().getTime() + waitTimeoutMs;

    for (;;) {
      await sleep(pollIntervalMs);

      // order matters: read the lock BEFORE the fact. the winner saves its
      // fact and then releases, so lock gone + no fresh fact = it failed.
      const stillGenerating = await store.isLocked(userId, movie, now());
      const [latest] = await store.recentFacts(userId, movie, 1);
      if (latest && isFresh(latest)) return { fact: latest, source: "cache" };

      if (!stillGenerating || now().getTime() >= deadline) {
        if (latest) return { fact: latest, source: "stale" };
        throw new FactUnavailableError();
      }
    }
  }

  return { getFact };
}

export type FactService = ReturnType<typeof createFactService>;
