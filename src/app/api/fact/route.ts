import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { factService } from "@/lib/facts";
import type {
  FactErrorCode,
  FactErrorResponse,
  FactResponse,
} from "@/lib/facts/contract";
import { FactUnavailableError } from "@/lib/facts/service";

// per-user + time sensitive, don't let anything cache it
const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: FactErrorCode, message: string) {
  return NextResponse.json<FactErrorResponse>(
    { error: { code, message } },
    { status, headers: NO_STORE },
  );
}

// No params on purpose. The user comes from the session, so there's no id
// a client could swap to read someone else's facts.
export async function GET() {
  try {
    // inside the try so a session/db failure also gets the JSON error below
    const user = await getCurrentUser();
    if (!user) {
      return errorResponse(401, "UNAUTHENTICATED", "Please sign in first.");
    }
    if (!user.favoriteMovie) {
      return errorResponse(
        409,
        "NO_FAVORITE_MOVIE",
        "Choose a favorite movie before asking for a fact.",
      );
    }

    const { fact, source } = await factService.getFact(
      user.id,
      user.favoriteMovie,
    );
    const ageMs = Date.now() - fact.createdAt.getTime();
    return NextResponse.json<FactResponse>(
      {
        fact: {
          id: fact.id,
          movie: fact.movie,
          content: fact.content,
          createdAt: fact.createdAt.toISOString(),
        },
        source,
        ageSeconds: Math.max(0, Math.floor(ageMs / 1000)),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof FactUnavailableError) {
      return errorResponse(
        503,
        "FACT_UNAVAILABLE",
        "We couldn't come up with a fact right now. Please try again in a moment.",
      );
    }
    // log it here, send the client something generic
    console.error("[api/fact] unexpected error:", error);
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Something went wrong. Please try again.",
    );
  }
}
