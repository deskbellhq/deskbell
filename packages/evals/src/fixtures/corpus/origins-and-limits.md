# Origins, rate limits and budgets

Every public endpoint is protected by one guard that runs six checks in order:
bot filtering, project lookup, origin binding, rate limits, the daily token
budget, and a concurrent-stream cap.

## Origin allowlist

A project has an allowed-origins list. A browser request whose `Origin` is not on
that list is refused with 403. When the allowlist is empty, Deskbell fails closed
in production and stays open in development so the demo page works. Set
`DESKBELL_ALLOW_ANY_ORIGIN` to true to serve embeds across many unknown domains.

The dashboard's own origin is always allowed, whatever the allowlist says,
because the dashboard embeds the widget to let you try it.

## Rate limits and spend

Request rates come from environment variables, because an operator must be able
to cap a runaway tenant from outside the application. Spend is per project in the
database: `daily_token_budget` on the project sets how many tokens that project
may spend in a UTC day. A daily token budget of zero means unlimited.

When a limit is hit the response is 429 with a `Retry-After` header. Client IP
addresses are hashed with HMAC and never stored in plain text.
