# Installing Deskbell

Deskbell is self-hosted. Clone the repository and run `docker compose up`; the web
application, the worker and the database start together.

Postgres is the only infrastructure dependency. There is no Redis, no message
broker and no separate vector database to operate — pgvector runs inside the same
Postgres instance, and the job queue is stored in Postgres as well.

For local development, `pnpm dx` is a single command that starts the Postgres
container, applies migrations, seeds a development project and starts the dev
server. The minimum Node version is 22.

Migrations run automatically on boot, so upgrading is `docker compose pull`
followed by `docker compose up`. The web container exposes a health endpoint at
`/api/health` for load balancers and container orchestrators.
