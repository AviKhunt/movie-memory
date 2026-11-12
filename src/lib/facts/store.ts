import { Prisma, type PrismaClient } from "@prisma/client";
import type { FactStore } from "./service";

// every query here filters by userId
export function createPrismaFactStore(prisma: PrismaClient): FactStore {
  return {
    recentFacts(userId, movie, limit) {
      return prisma.fact.findMany({
        where: { userId, movie },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    },

    saveFactIfLockHeld(input, token) {
      // one transaction: the DELETE only matches if the lock row still has
      // our token, and it keeps that row locked until commit. so a takeover
      // can't land between "do I still own it" and the insert.
      return prisma.$transaction(async (tx) => {
        const released = await tx.factGenerationLock.deleteMany({
          where: { userId: input.userId, movie: input.movie, token },
        });
        if (released.count !== 1) return null;
        return tx.fact.create({ data: input });
      });
    },

    async acquireLock(userId, movie, token, now, ttlMs) {
      const expiresAt = new Date(now.getTime() + ttlMs);

      // expired lock from a crashed request -> take it over.
      // single conditional UPDATE so only one request can win it.
      const takenOver = await prisma.factGenerationLock.updateMany({
        where: { userId, movie, expiresAt: { lte: now } },
        data: { token, expiresAt },
      });
      if (takenOver.count === 1) return true;

      // otherwise insert. PK on (userId, movie) means only one insert wins.
      try {
        await prisma.factGenerationLock.create({
          data: { userId, movie, token, expiresAt },
        });
        return true;
      } catch (error) {
        if (isUniqueConstraintError(error)) return false;
        throw error;
      }
    },

    async releaseLock(userId, movie, token) {
      // match on token so we never delete a lock someone else took over
      await prisma.factGenerationLock.deleteMany({
        where: { userId, movie, token },
      });
    },

    async isLocked(userId, movie, now) {
      const active = await prisma.factGenerationLock.count({
        where: { userId, movie, expiresAt: { gt: now } },
      });
      return active > 0;
    },
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
