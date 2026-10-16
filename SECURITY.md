# Security policy

## Reporting a vulnerability

Email **security@deskbell.dev**. Do not open a public issue for anything that
could be exploited before it is fixed.

Include what you found, how to reproduce it, and which version or commit you
tested. A proof of concept helps; a working exploit against someone else's
instance is not needed and not welcome.

You will get an acknowledgement within three working days and a decision on
severity and a fix plan within ten. Credit in the release notes is offered
unless you prefer otherwise.

## Scope

In scope: this repository, the published npm packages (`@deskbell/widget`,
`@deskbell/widget-react`, `@deskbell/sdk`, `@deskbell/shared`) and the Docker
images built from this repository.

Out of scope: instances run by other people, denial of service by volume against
the public widget endpoints (rate limits and token budgets are the mitigation
and are documented), and findings that need a compromised dashboard account.

## Supported versions

Pre-1.0, only `main` receives fixes. There are no maintenance branches yet.

## What protects a running instance

The widget endpoints are unauthenticated by design. Origin binding, rate limits
and a daily token budget are the controls, and ingested content is treated as
data, never as instructions. The
[security guide](apps/docs/content/docs/manage/security.mdx) explains each one
and what to set before an instance faces the internet.
