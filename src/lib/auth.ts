import "server-only";
import { getServerSession, type NextAuthOptions } from "next-auth";
import { connection } from "next/server";
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// built lazily so a missing env var doesn't break `next build`
let cachedOptions: NextAuthOptions | undefined;

export function getAuthOptions(): NextAuthOptions {
  cachedOptions ??= buildAuthOptions();
  return cachedOptions;
}

function buildAuthOptions(): NextAuthOptions {
  return {
    providers: [
      GoogleProvider({
        clientId: requiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      }),
    ],
    // jwt cookie only holds our user id, everything else comes from the db
    session: { strategy: "jwt" },
    pages: { signIn: "/", error: "/" },
    callbacks: {
      signIn({ account, profile }) {
        if (account?.provider !== "google") return false;
        return (profile as GoogleProfile | undefined)?.email_verified === true;
      },

      async jwt({ token, account, profile }) {
        // account/profile are only set on the sign-in request, so this
        // upsert runs once per login
        if (account?.provider === "google" && profile) {
          const google = profile as GoogleProfile;
          const data = {
            email: google.email,
            name: google.name?.trim() || null,
            image: google.picture || null,
          };
          const user = await prisma.user.upsert({
            where: { googleId: google.sub },
            create: { googleId: google.sub, ...data },
            update: data,
            select: { id: true },
          });
          token.userId = user.id;
        }
        return token;
      },

      session({ session, token }) {
        if (session.user && token.userId) session.user.id = token.userId;
        return session;
      },
    },
  };
}

// The one place we figure out who's making the request. Returns null if
// there's no session or the user row is gone.
export async function getCurrentUser(): Promise<User | null> {
  // marks the route as dynamic so the build doesn't try to prerender it
  await connection();

  const session = await getServerSession(getAuthOptions());
  const userId = session?.user?.id;
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}
