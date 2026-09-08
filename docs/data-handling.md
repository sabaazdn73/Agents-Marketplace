# Data handling and third-party terms

What the running system stores, what it deliberately does not, and the
outside constraints it works within. This describes the implementation. It
is not legal advice and no lawyer has reviewed it.

## Personal data

The only personal data the backend stores is a salted hash used to decide
whether someone has visited before.

`backend/core/first_visit.py` takes the client address from
`X-Forwarded-For`, salts it with `FIRST_VISIT_SALT`, hashes it with SHA-256,
and keeps the first 32 hex characters with a timestamp. The address itself
is never written. Records expire after 90 days through a MongoDB TTL index,
so the collection stays a short-lived set of recent visitors rather than a
log that grows forever.

A cookie would be cleaner, because it is per-browser and stores nothing
about anyone. It does not work here: the frontend is on Vercel and the API
is on Render, so a cookie set by the API is third-party from the browser's
point of view. Safari blocks those and the API's CORS is
`allow_origins=["*"]`, which browsers refuse to pair with credentialed
requests.

One thing to fix: `FIRST_VISIT_SALT` is unset in the current environment, so
the code falls back to a fixed string in source. With a known salt the hash
can be reversed for any address by anyone reading this repository, which
removes the protection the hashing exists to provide. Set it.

## Private keys

The backend holds none, by design. It signs nothing.

Every transaction is signed in the browser by the user's own wallet. Where a
settlement rail needs a signed authorisation, such as B402's EIP-3009 or
Permit2 payloads, the backend refuses to proceed without one rather than
holding a key to produce it. `core/commerce/rails/b402_rail.py` states this
where it declines.

Deploy scripts that need a key are run by the project owner, not by any
automated process, and no key is committed. A gitleaks scan across all 318
commits found no credential in history.

## Spending controls

The commerce pipeline can place orders through Crossmint, so three
independent limits sit in front of it.

Orders are disabled unless `COMMERCE_ALLOW_REAL_ORDERS` is set. A spend
ceiling lives in `core/commerce/limits.py` as a source constant rather than
an environment variable, because a constant has to be edited and committed
while an environment variable can be changed by a deploy config. Browser
profiles, which persist a user's logged-in session at a merchant, are never
created, and an existing profile id is only ever used when the caller states
that the user authorised it in that session.

## Third-party marks

The partner strip shows a logo only where the vendor's terms allow it. Three
services the project uses have no mark:

Gemini, because Google's rules require Google-approved artwork and the only
assets that resolve are either build-hash URLs that rot or Google's and
DeepMind's corporate icons rather than the Gemini product mark.

Claude Code, because Anthropic requires written permission for logo use.
Saying in plain text that a product uses Claude Code is allowed, and that is
what this does.

Infura, because no logo asset resolves on infura.io, and using Consensys's
or MetaMask's icon would misrepresent three companies at once.

Ledger was left out earlier for the same kind of reason.

## Payment partners

MoonPay declined our partner onboarding on country and industry grounds.
Nothing in the codebase is built against MoonPay or against Tnega PayBox,
which depended on it. See `future-tnega-paybox.md` for the research that led
there and for B402, which replaced it.

Crossmint physical-goods checkout needs the `worldstoreCheckout` addon,
which this project does not have. The adapter reports that as a missing
entitlement rather than as a bug.
