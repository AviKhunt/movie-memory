import type { Fact, FactStore } from "@/lib/facts/service";

type Lock = { token: string; expiresAt: Date };

// in-memory FactStore so the service tests don't need postgres
export function createMemoryStore() {
  const facts: Fact[] = [];
  const locks = new Map<string, Lock>();
  const key = (userId: string, movie: string) => `${userId}\u0000${movie}`;

  const store: FactStore = {
    async recentFacts(userId, movie, limit) {
      return facts
        .filter((fact) => fact.userId === userId && fact.movie === movie)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },

    async saveFactIfLockHeld(input, token) {
      const k = key(input.userId, input.movie);
      if (locks.get(k)?.token !== token) return null;
      locks.delete(k);
      const fact: Fact = { id: `fact-${facts.length + 1}`, ...input };
      facts.push(fact);
      return fact;
    },

    async acquireLock(userId, movie, token, now, ttlMs) {
      const existing = locks.get(key(userId, movie));
      if (existing && existing.expiresAt.getTime() > now.getTime()) {
        return false;
      }
      locks.set(key(userId, movie), {
        token,
        expiresAt: new Date(now.getTime() + ttlMs),
      });
      return true;
    },

    async releaseLock(userId, movie, token) {
      if (locks.get(key(userId, movie))?.token === token) {
        locks.delete(key(userId, movie));
      }
    },

    async isLocked(userId, movie, now) {
      const existing = locks.get(key(userId, movie));
      return !!existing && existing.expiresAt.getTime() > now.getTime();
    },
  };

  return { store, facts, locks };
}

// fake clock
export function createClock(start = "2026-01-01T00:00:00.000Z") {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
