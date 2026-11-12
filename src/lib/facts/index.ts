import "server-only";
import { prisma } from "@/lib/db";
import { generateMovieFact } from "./openai";
import { createFactService } from "./service";
import { createPrismaFactStore } from "./store";

export const factService = createFactService({
  store: createPrismaFactStore(prisma),
  generate: generateMovieFact,
});
