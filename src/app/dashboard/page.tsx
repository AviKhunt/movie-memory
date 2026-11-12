import { redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentUser } from "@/lib/auth";
import { FactCard } from "./fact-card";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.favoriteMovie) redirect("/onboarding");

  // some google accounts have no display name
  const displayName = user.name ?? user.email.split("@")[0];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10 sm:py-16">
      <header className="flex items-center justify-between gap-4">
        <p className="font-display text-xl font-semibold tracking-tight">
          Movie Memory
        </p>
        <SignOutButton />
      </header>

      <section
        aria-label="Your profile"
        className="mt-10 flex items-center gap-4"
      >
        <Avatar src={user.image} label={displayName} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{displayName}</h1>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </section>

      <section aria-label="Your favorite movie" className="mt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
          Favorite movie
        </p>
        <p className="mt-2 break-words font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          {user.favoriteMovie}
        </p>
      </section>

      <div className="mt-10">
        <FactCard />
      </div>
    </main>
  );
}
