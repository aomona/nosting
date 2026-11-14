# Account mute list (Issue #24)

NIP-51 kind 10000 is loaded from the account's configured read/write relays on login and relay changes. Settings can explicitly reload. Public tags and self-encrypted NIP-44 tags apply together with the existing account-scoped browser-local preferences; local preferences are never uploaded or replaced.

Supported tags are `p` (author), `word` (normalized case-insensitive content), `t` (event hashtags), and `e` (the event itself, root/reply/legacy thread references, reaction and repost targets). The shared predicate covers timeline originals/reposts, thread/reply previews, quotes, and notification actors/targets. Quoting a muted thread does not hide unrelated outer content; the resolved quote itself is filtered. Filtering does not fetch missing ancestors solely to infer thread membership.

The editor defaults to private additions. Each add/remove is a single signed replacement; unknown tags and untouched tag fields remain intact. Public-only edits preserve the exact ciphertext. Private edits require NIP-44 encryption plus a successful round-trip check. Legacy NIP-04 (`?iv=`) lists are explicitly unsupported for decryption/editing. Undecryptable or malformed private content blocks **all** saves. Public entries can still be filtered. Private plaintext is held in memory, never persisted to localStorage.

Every relay must reach EOSE before editing. A partial read can still supply verified filtering state, but cannot be treated as an empty list. Signatures are verified without trusting nostr-tools' mutable verification cache. Refresh retains the latest verified state rather than rolling back to an older relay response. Before and after signing, fresh complete snapshots must match the displayed base event; timestamps must advance. Cancellation/account or relay changes stop publication. Acknowledgements show confirmed/configured counts; after any publication, reload is required before another edit. A zero-ACK result is uncertain and never presented as successful.

Limits: 32 lookup relays, 10,000 tags, 100,000 ciphertext characters, bounded response/count/time budgets. No atomic compare-and-swap exists across Nostr relays: another client can still publish between the final check and send. A cancel after sending cannot revoke an event. Relay outages can prevent editing until a complete refresh succeeds. Synchronization is snapshot based (login/relay change/manual reload), not a permanent subscription. Existing browser-local profile-menu actions remain local; synced entries are edited in Settings.

Specifications checked: [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md), [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md), [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md).

## Validation

- `node tests/account-mutes.test.mjs`: generated disposable keys, real signatures/NIP-44, mock WebSockets, p/word/t/e matching, unknown-tag preservation, unreadable/legacy/invalid signature guards, conflicts, account changes, cancellation, complete/partial/empty relay snapshots and ACK outcomes.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run lint`.
- `node tests/browser/server.mjs`, then `python tests/browser/account-mutes.py`: actual components/hooks at 1280px and 390px, private default, local isolation, partial failures, cancellation during signing, account changes and socket cleanup. External browser requests are blocked; the fixture WebSocket rejects publication frames. Screenshots go to `/tmp/nosting-account-mutes-{width}.png`, never Git.

No production keys or public-relay test events are used. No dependency on other pending feature branches.
