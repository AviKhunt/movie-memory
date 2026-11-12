import { redirect } from "next/navigation";
import { SignInButton } from "@/components/sign-in-button";
import { getCurrentUser } from "@/lib/auth";

type HomeProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const user = await getCurrentUser();
  if (user) redirect(user.favoriteMovie ? "/dashboard" : "/onboarding");

  // next-auth redirects back here with ?error= when sign in fails
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-marquee">
          Now showing
        </p>
        <h1 className="mt-4 font-display text-5xl font-semibold tracking-tight sm:text-6xl">
          Movie Memory
        </h1>
        <p className="mx-auto mt-5 max-w-sm text-base leading-relaxed text-muted">
          Tell us your favorite movie and get a fun fact about it every time
          you visit.
        </p>

        <div className="mt-10">
          <SignInButton />
        </div>

        {error ? (
          <p role="alert" className="mt-6 text-sm text-danger">
            {error === "AccessDenied"
              ? "That Google account couldn't be used to sign in. Please try another one."
              : "Sign-in didn't complete. Please try again."}
          </p>
        ) : null}
      </div>
    </main>
  );
}
