# Movie Memory

A full-stack application that remembers a user's favorite movie and generates a short movie fact using OpenAI.

**Submission:** required base implementation plus **Variant A - Backend-Focused: Caching and Correctness**.

**Stack:** TypeScript, Next.js 16 App Router, React 19, TailwindCSS 4, PostgreSQL, Prisma 6, Google OAuth through NextAuth.js 4, OpenAI, and Vitest.

## Setup instructions

### Prerequisites

- **Node.js 24 LTS** and npm. The repository includes `.nvmrc` for users of nvm.
- **PostgreSQL**, either through the included Docker Compose service or an existing local/hosted server.
- A **Google OAuth Web application** client.
- An **OpenAI API project key** with access to the configured model and available quota.

Run commands from the project root, where `package.json` is located.

### 1. Configure the environment

Create `.env` from the example without overwriting an existing configuration:

```bash
cp -n .env.example .env
```

Open `.env` in your editor and fill in the required variables listed below. Generate a random authentication secret locally:

```bash
openssl rand -base64 32
```

Paste the result into `NEXTAUTH_SECRET`. Keep `.env` local; `.env.example` is the template committed to Git.

### 2. Configure Google OAuth

Create a Web application OAuth client in Google Cloud Console. Configure the consent screen and add the Google account used for testing as a test user when the application is in Testing mode.

| Google setting | Local value |
| --- | --- |
| Authorized JavaScript origin | `http://localhost:3000` |
| Authorized redirect URI | `http://localhost:3000/api/auth/callback/google` |

Copy the client ID and client secret into `.env`. Use `http://localhost:3000` consistently when opening the app. If the host or port changes, update both `NEXTAUTH_URL` and the Google client settings.

### 3. Start Postgres and install dependencies

Using the included Docker Compose service:

```bash
docker compose up -d
npm ci
```

The example database URL matches `docker-compose.yml`. If using Postgres.app or another existing server, start that server, create a `movie_memory` database, and set `DATABASE_URL` to its actual username, password, host, and port. Docker is not required when using an existing database.

`npm ci` installs the versions recorded in `package-lock.json`. Its postinstall script generates Prisma Client.

### 4. Apply migrations and start the app

```bash
npm run db:deploy
npm run dev
```

Open **http://localhost:3000**. Sign in with Google, choose a favorite movie, and continue to the dashboard. Restart the development server after changing `.env`.

For a production build and local production server:

```bash
npm run build
npm start
```

## Required environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string. The example matches the included local Docker service. |
| `NEXTAUTH_URL` | Yes | Canonical application origin; `http://localhost:3000` locally. |
| `NEXTAUTH_SECRET` | Yes | Random secret used by NextAuth; generate it with `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth Web application client ID. |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret, used on the server. |
| `OPENAI_API_KEY` | Yes | OpenAI project API key, used on the server. |
| `OPENAI_MODEL` | No | Responses API model; defaults to `gpt-5.4-mini`. |

Database and OpenAI modules use `server-only`. Secret variables do not use the `NEXT_PUBLIC_` prefix. The application sends the movie title and recent movie-fact text to OpenAI, rather than the user's Google profile details.

## Database migration steps

The committed initial migration creates `User`, `Fact`, and `FactGenerationLock`, including their unique keys, index, and foreign keys.

Apply committed migrations to a new or existing database:

```bash
npm run db:deploy
```

This runs `prisma migrate deploy`. To develop a new schema change, edit `prisma/schema.prisma`, generate a new migration, and review its SQL:

```bash
npx prisma migrate dev --name describe_the_change
```

Commit the schema and new migration together. The application uses Prisma 6 with `@prisma/adapter-pg` and `engineType = "client"`; the runtime database connection uses the Postgres driver adapter.

## Architecture overview

### Request flow and application boundaries

Server-rendered pages decide which screen an authenticated user may access. Small client components handle sign-in/out controls, the onboarding form, avatar fallback, and fact loading. The dashboard renders profile data immediately, then requests a fact from the API and shows loading, success, stale-fact, or error states.

| Route | Behavior |
| --- | --- |
| `/` | Landing page when logged out; redirects signed-in users to onboarding or the dashboard. |
| `/onboarding` | Protected favorite-movie form; redirects users who already completed onboarding. |
| `/dashboard` | Protected profile, favorite movie, fact card, and logout control. |
| `GET /api/fact` | Returns a fact for the authenticated user's saved movie; returns 401 without a session. |
| `/api/auth/*` | NextAuth Google OAuth and session endpoints. |

`getCurrentUser()` is the shared identity boundary. It reads the server session and loads the corresponding database user. Pages, the onboarding server action, and the fact endpoint each call it directly. A deleted or missing user is treated as logged out. The application does not rely solely on a client-side redirect to protect data.

### Authentication and data model

NextAuth handles the Google OAuth exchange and encrypted, HTTP-only JWT session cookies. During sign-in, the application requires Google's verified-email flag and upserts the user by Google's stable account identifier (`sub`). The application adds its own database user ID to the token and exposes that ID through the server session. Dashboard profile fields and the favorite movie are read from Postgres rather than trusted from browser input.

| Model | Purpose and key decisions |
| --- | --- |
| `User` | Unique `googleId`, email, optional name/image, and nullable `favoriteMovie`. A null movie means onboarding is incomplete. |
| `Fact` | Historical fact text with its user, exact movie title, and creation time. An index on `(userId, movie, createdAt DESC)` supports the latest-fact lookup. |
| `FactGenerationLock` | One lease per `(userId, movie)`, with an ownership token and expiry time for coordinating generation across requests and server instances. |

Google account ID is used instead of email as the identity key because email can change. The movie is a nullable user field because the product needs one favorite per user; a separate movie/preferences table would add little here. Each fact also stores its movie so the cache association remains explicit. User deletion cascades to facts and lock rows. Missing names use an email-based fallback; missing or failed photos display an initial.

### Onboarding and authorization

The onboarding server action validates movie input using Zod: it must be a string, is trimmed with internal whitespace collapsed, must contain 1-100 characters, and must not contain remaining control characters. A one-character movie title is valid. The server performs validation even if HTML form limits are bypassed.

The write is an atomic update filtered by both the session user ID and `favoriteMovie IS NULL`. Two tabs cannot overwrite an already-saved favorite. The API accepts no target user ID: it obtains both the user and their saved movie from the authenticated server lookup. Fact queries always filter by that user and movie, including fallback reads.

### Cache and concurrency strategy

The fact service receives a storage interface, generator function, and clock. It imports neither Next.js, Prisma, nor OpenAI, which lets tests control time and failures without real network calls. Prisma queries live in `store.ts`; the provider integration lives in `openai.ts`.

A fact is reused while its age is strictly below **60,000 milliseconds**. At exactly 60 seconds it is expired. Responses use `Cache-Control: no-store`; this is a database cache policy rather than browser or shared HTTP caching.

On expiry, a request tries to acquire the database lease. The composite primary key admits one insert, while a conditional update allows takeover of an expired lease. After acquiring it, the request reads the cache again to catch a result committed since its first read. Competing requests poll every 250 milliseconds for a fresh fact, stopping when generation ends or their 15-second wait limit is reached.

After generation, saving the fact and deleting the owned lock happen in one transaction. The delete must match the ownership token before the insert is allowed. This fences out a delayed request whose lock was taken over, preventing it from saving a second result after the new owner. Failure paths release only their own token; abandoned locks can be reclaimed after the 30-second lease expires.

### OpenAI and failure handling

The OpenAI request has a 10-second client timeout and no automatic retries. The prompt treats the quoted movie title as data, asks for a short accurate fact, and includes recent facts to discourage repetition. Responses must be completed, nonempty after trimming, and at most 600 characters. Invalid output is rejected rather than cut off mid-sentence. Provider errors are logged as a one-line summary (message, error code, request ID) rather than the SDK's full error object, which includes response headers.

If generation fails, the service returns the most recent fact for the same user and movie, even if stale. Without a saved fact, the endpoint returns a friendly 503 response. Other API failures, including session/database lookup failures, receive the generic JSON error response. Model output is rendered as plain text through React. AI trivia can still be inaccurate; prompt instructions are not a factual verification service.

## Which variant I chose and why

I chose **Variant A - Backend-Focused: Caching and Correctness**. The main engineering challenge is making a slow external call behave predictably under refreshes, multiple tabs, and failures. This variant keeps the product small while focusing on user isolation, the exact cache boundary, database-backed coordination, and useful fallback behavior.

Variant B's inline movie editing and 30-second client cache are outside this implementation's selected scope.

## Key tradeoffs

- **Database lease instead of a long transaction:** the OpenAI call does not occupy a transaction connection. The cost is another table, lease expiry, polling, and an ownership-checked save transaction.
- **Polling instead of notification infrastructure:** it is easy to test and works across instances, but increases database reads during bursts. Broader load would justify measuring those reads and considering notifications or a queue.
- **Application clock:** injecting time makes the exact 60-second boundary testable. Deployments with multiple instances need reasonably synchronized clocks.
- **JWT sessions instead of adapter session tables:** fewer persistence models are needed, but an individual session cannot be revoked in the database before expiry. Deleting a user prevents further application access.
- **GET with a generation side effect:** the fact endpoint can create a record on a cache miss. It is documented and marked no-store; a separate generation POST would express the side effect more explicitly.
- **Free-text titles and AI trivia:** no external movie catalog is required, but ambiguous titles and factual accuracy remain limitations.
- **Stable NextAuth 4 and Prisma 6:** these match the implemented integration; upgrades should include deliberate compatibility checks.

## Tests and verification

With Postgres running and `.env` configured, run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

`npm test` runs the unit tests without a database. The repository currently includes **41 unit tests** and **14 integration tests**. `npm run test:all` runs both suites. Tests mock OpenAI and do not make paid provider requests.

| Test file | Main guarantees |
| --- | --- |
| `tests/unit/fact-service.test.ts` | Cache boundary, burst protection, expired-owner behavior, scoped fallback, and user isolation. |
| `tests/unit/fact-route.test.ts` | Authentication, session-derived identity, API errors, and cache metadata. |
| `tests/unit/openai.test.ts` | Completed output, incomplete/failed/empty/oversized output rejection, error summaries, and prompt construction. |
| `tests/unit/validation.test.ts` | Movie input types, whitespace, length bounds, and control characters. |
| `tests/integration/fact-store.test.ts` | Actual Postgres scoping, concurrent lock acquisition/takeover, ownership-checked persistence, and service caching. |

Integration tests use `DATABASE_URL`, create uniquely identified test users, and delete those users afterward. Use a local development or disposable test database, never a production database. Apply the migration to whichever database the tests use.

The automated tests mock OpenAI and do not exercise Google sign-in, so these flows were also checked in the browser against real Google sign-in and the real OpenAI API: first login to onboarding, onboarding validation, movie persistence, fact generation, cache reuse inside 60 seconds, a new fact after 60 seconds, the friendly error when OpenAI was unavailable with nothing cached, and logout followed by direct dashboard navigation.

## What I would improve with 2 more hours

1. Add browser tests for first-time/returning users, onboarding validation, logout, and fact error states.
2. Add GitHub Actions for lint, types, unit tests, a Postgres-backed integration suite, and the production build.
3. Add per-user generation limits and provider-failure cooldowns to control repeated attempts during outages.
4. Add operational metrics for provider latency, cache hits, fallback use, and lock contention, then use those measurements to guide scaling decisions.

## AI usage

- Used AI coding assistance to help generate and refine implementation, tests, and documentation.
- Used AI for code review of cache boundaries, authorization, lock ownership, and error handling.
- I am responsible for understanding the submitted code and validating its behavior with my own local configuration and credentials.
