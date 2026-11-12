"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateMovie } from "@/lib/validation";

export type OnboardingState = {
  error?: string;
  value?: string; // what they typed, so the input isn't wiped on error
};

export async function saveFavoriteMovie(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  // server actions are callable directly, so check the session here too
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const raw = formData.get("movie");
  const result = validateMovie(raw);
  if (!result.ok) {
    return {
      error: result.error,
      value: typeof raw === "string" ? raw.slice(0, 200) : "",
    };
  }

  // favoriteMovie: null keeps this first-time only. a second submit
  // (other tab, replayed request) just does nothing.
  await prisma.user.updateMany({
    where: { id: user.id, favoriteMovie: null },
    data: { favoriteMovie: result.movie },
  });

  redirect("/dashboard");
}
