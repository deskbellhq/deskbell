# D16 — End-user identity is verified by the server, never asserted by the page

**Decision.** When a project names an identity provider, the widget endpoints
verify a signed bearer token from that provider on every request, bind the
conversation to the verified subject, and use that binding as the only
authorization for reading, continuing, rating, renaming or deleting it. A page
cannot name its visitor by sending an id; it can only forward a token the
provider signed. Anonymous projects keep session possession as their
authorization, unchanged.

**Why.** The widget runs in a browser the site owner does not control, against
an endpoint that is public by design. Any identity the page asserts, a script
can assert too, and a conversation history keyed on an asserted id is a
history anyone can read by guessing ids. A signed token from the provider
costs the same one header and closes that entirely: the server checks the
signature, the issuer, the audience and the expiry, and nothing the page says
about the visitor is trusted.

The binding also has to exist before any action does. An agent that later
looks up an order or an account on the visitor's behalf runs as that visitor
or it is a confused deputy; the identity the action runs under must be the one
verified here, on the same request, by the same code. Retrofitting that under
an existing conversation model means re-auditing every read for whose rows it
returns.

**What this rules out.** Identifying a visitor by an attribute or a global the
page sets. Treating a token that fails verification as an anonymous visitor.
Letting a token bypass origin binding, rate limits or the token budget: it
says who is asking, not whether they may. Mixing a signed-in visitor's threads
with the anonymous threads of the browser they are on.

**Where it bites in code.** `apps/web/lib/widget-guard.ts` runs the identity
step after origin and rate checks and before anything that spends;
`apps/web/lib/identity/verify.ts` is the only verifier;
`apps/web/lib/conversation-access.ts` is the one ownership clause, and every
route under `apps/web/app/api/v1/` that touches a conversation uses it. The
schema in `packages/shared/src/index.ts` (`ProjectIdentitySchema`) is what a
project may store, and `packages/sdk` is where the token enters a request.
