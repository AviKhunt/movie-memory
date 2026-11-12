import type { FactSource } from "./service";

// response shape of GET /api/fact, used by the route and the dashboard

export type FactResponse = {
  fact: {
    id: string;
    movie: string;
    content: string;
    createdAt: string;
  };
  source: FactSource;
  ageSeconds: number;
};

export type FactErrorCode =
  | "UNAUTHENTICATED"
  | "NO_FAVORITE_MOVIE"
  | "FACT_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type FactErrorResponse = {
  error: { code: FactErrorCode; message: string };
};
