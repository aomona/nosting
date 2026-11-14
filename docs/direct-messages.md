# NIP-17 DM (Issue #26)

First stage: opt-in, one-to-one kind 14 text messages. Open **DM**, then explicitly
load messages. Use a NIP-07 signer with both NIP-44 methods; NIP-04 is never used.

## Protocol boundaries

- Reads recipient and sender inboxes from verified latest kind 10050 events on the
  configured read relays. An empty latest list revokes readiness. Missing lists or
  incomplete discovery block sending; no fallback to kind 10002 or default relays.
  Supports up to three advertised inboxes and sixteen discovery relays.
- Publishes separately encrypted kind 1059 gift wraps for the peer and sender.
  Unsigned rumors and signed kind 13 seals never enter the relay publisher.
  The wrap uses a fresh ephemeral key, wiped after use. Both wrapper timestamps
  are randomized into the preceding two days. The extension retains the user key.
- Verifies both signatures before decryption, seal/rumor authors, rumor hash,
  exact one-to-one recipients, kinds, timestamps, unsigned rumor, and empty seal
  tags. Rumor ID deduplicates different wrappers; ordering uses rumor time.
- DM connections are separate from the public feed. NIP-42 is opt-in per mounted
  inbox; authentication discloses the account to the connected relay. Challenges
  are bound to that connection and URL; AUTH is sent only after an auth-required
  rejection/hint, and rejected reads/writes retry only after a valid matching OK.
- Recipient and archive acknowledgements are shown separately. A timeout is an
  uncertain result, not proof of failure. Retry reuses the exact same ciphertext
  IDs and re-resolves the current inbox lists. Navigation, account change and
  cancellation close sockets and invalidate outstanding signer/decrypt callbacks.
  Already dispatched messages cannot be recalled.
- DM settings can explicitly publish kind 10050 to the configured read relays
  (directory discovery locations). They do not modify kind 10002 or public relay
  settings. Partial setting publication is reported and can be retried.

## Privacy, spam and limits

Plaintext and ciphertext are held in memory only; navigating away clears them,
including unsent drafts and pending retry state. Only accepted/blocked public keys
are stored in an account-scoped browser policy. Untrusted errors, content and keys
are never logged. Text is rendered as text; no link/image previews or remote
profile fetches. Requests hide the text until explicitly accepted; blocking hides
that peer and stops new sends (including npub aliases). Sending initiates acceptance.

Loading is manual (no background signer prompts), bounded to 100 wrappers per
batch, 500 displayed rumors, 500 frames per socket, a 10-second timeout, and bounded
frame/ciphertext sizes. Historical queries use an inclusive outer timestamp cursor
because wrappers can be backdated. Overlaps deduplicate. Partial reads do not advance
the cursor. Equal-timestamp saturation stops with a visible limit instead of
silently skipping messages. Relays with more than 100 events at the same timestamp
and histories beyond 500 messages require a later pagination/storage design.
A malicious relay can still omit events. This is not a complete anti-spam solution;
unknown wrappers must be decrypted to identify senders, and extensions may prompt.

No groups, files, calls, NIP-04, edits/deletions, disappearing messages, remote
signers, automatic polling, or cross-device synchronization of acceptance policies.
These need separate issues. This implementation does not depend on Issues #17–25
or the parallel quote/image-scroll work. Public feed rendering remains separate.

## Verification

```
node tests/direct-messages.test.mjs
npm test
npm run typecheck
npm run build
npm run lint
node tests/browser/direct-messages-server.mjs
python tests/browser/direct-messages.py
python tests/browser/direct-messages-app.py
```

All DM tests use generated test keys and mocked WebSockets, never public relays.
The browser fixture blocks external HTTP and offers `?full=1` to exercise the actual
application route and navigation with the same mocked relay and extension.
Screenshots are written to `/tmp`, not tracked in Git.

References reviewed during implementation:
[NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md),
[NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md),
[NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md),
[NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md),
[NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md).
