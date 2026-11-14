# Account mute list (Issue #24)

NIP-51 kind 10000 is loaded from the account's configured read/write relays on login and relay changes. Settings can explicitly reload. Public tags and self-encrypted NIP-44 tags apply together with the existing account-scoped browser-local preferences; local preferences are never uploaded or replaced.

Supported tags are `p` (author), `word` (normalized case-insensitive content), `t` (event hashtags), and `e` (the event itself, root/reply/legacy thread references, reaction and repost targets). The shared predicate covers timeline originals/reposts, thread/reply previews, quotes, and notification actors/targets. Quoting a muted thread does not hide unrelated outer content; the resolved quote itself is filtered. Filtering does not fetch missing ancestors solely to infer thread membership.

The editor defaults to private additions. Each add/remove is a single signed replacement; unknown tags and untouched tag fields remain intact. Public-only edits preserve the exact ciphertext. Private edits require NIP-44 encryption plus a successful round-trip check. Legacy NIP-04 (`?iv=`) lists are explicitly unsupported for decryption/editing. Undecryptable or malformed private content blocks **all** saves. Public entries can still be filtered. Private plaintext is held in memory, never persisted to localStorage.

Every relay must reach EOSE before editing. A partial read can still supply verified filtering state, but cannot be treated as an empty list. Signatures are verified without trusting nostr-tools' mutable verification cache. Refresh retains the latest verified state rather than rolling back to an older relay response. Before and after signing, fresh complete snapshots must match the displayed base event; timestamps must advance. Cancellation/account or relay changes stop publication. Acknowledgements show confirmed/configured counts; after any publication, reload is required before another edit. The UI starts this reload automatically after a confirmed save, and remains blocked unless it completes. A zero-ACK result is uncertain and never presented as successful.

Limits: 32 lookup relays, 10,000 tags, 100,000 ciphertext characters, bounded response/count/time budgets. No atomic compare-and-swap exists across Nostr relays: another client can still publish between the final check and send. A cancel after sending cannot revoke an event. Relay outages can prevent editing until a complete refresh succeeds. Synchronization is snapshot based (login/relay change/manual reload), not a permanent subscription. Existing browser-local profile-menu actions remain local; synced entries are edited in Settings.

Specifications checked: [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md), [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md), [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md).

## Validation

- `node tests/account-mutes.test.mjs`: generated disposable keys, real signatures/NIP-44, mock WebSockets, p/word/t/e matching, unknown-tag preservation, unreadable/legacy/invalid signature guards, conflicts, account changes, cancellation, complete/partial/empty relay snapshots and ACK outcomes.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run lint`.
- `node tests/browser/server.mjs`, then `python tests/browser/account-mutes.py`: actual components/hooks at 1280px and 390px, private default, local isolation, partial failures, cancellation during signing, account changes and socket cleanup. External browser requests are blocked; the fixture WebSocket rejects publication frames.
- `python tests/browser/account-mutes-app.py`: the actual App and settings dialog at 1280px, 390px and 320px. Tests entry from Settings, identifier expansion, 44px minimum touch targets, public add/remove, private encryption, invalid input, partial read/retry, automatic complete refresh, local add/remove and cancellation when changing storage during signing. All sockets are replaced by a local in-memory relay fixture before App mounts; external HTTP requests are blocked. Screenshots go to `/tmp/nosting-account-mutes-{width}{,-add,-error}.png`, never Git.

## Mobile flow review

1. Find the list: the previous settings dialog placed mutes below unrelated settings and showed local/account sections together. Settings now opens a dedicated mute dialog with a storage selector and count. Public/private groups remain explicit.
2. Inspect and remove: full keys and thread IDs previously wrapped into tall rows. They now show a compact identifier, with a touch-expandable, selectable full value. Remove stays next to its item. Buttons/inputs are 48px high and identifier expanders at least 44px.
3. Add: the previous list and form competed for the same narrow viewport. Add opens a separate editor with full-width type/input controls, visible scope choices, private default, and an explicit public action. Cancel returns to the list.
4. Save or recover: a confirmed save returns to the list and starts the required complete refresh. Partial reads still block edits and show a short reason with retry. Invalid input remains editable and does not sign or publish. Changing storage or closing aborts pending work.

The browser checks include a reduced-height mobile viewport for input/action reachability and horizontal overflow. They use Chromium viewport simulation; physical iOS/Android keyboards and a full screen-reader audit are not covered.

No production keys or public-relay test events are used. No dependency on other pending feature branches.
