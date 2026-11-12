import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { MovieForm } from "./movie-form";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  // first-time only
  if (user.favoriteMovie) redirect("/dashboard");

  const firstName = user.name?.split(" ")[0];

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-marquee">
          One quick question
        </p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          {firstName ? `Welcome, ${firstName}.` : "Welcome."}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          What&apos;s your favorite movie?
        </p>
        <MovieForm />
      </div>
    </main>
  );
}
