# Bookmarks (Issue #20)

The saved view explicitly queries kind 1 IDs and kind 5 deletion requests on the
configured reading relays, independently of the home timeline. Signed kind 10003
lists are read for the current account when the saved view opens, every minute
while visible, on focus/online, and with **再取得**. Leaving the view, hiding the
tab, changing accounts/relays, and unmounting cancel outstanding reads.

## Storage and privacy

- `petal-bookmarks:v2:guest` and `petal-bookmarks:v2:<pubkey>` isolate local IDs,
  locally hidden remote IDs, and the last verified account list.
- The legacy shared `petal-bookmarks` IDs have unknown ownership. Copy them to the
  guest namespace once, leaving the original key untouched. Never copy them into
  an account's public list. Log out to access the migrated guest saves.
- The bookmark button changes only this browser's current owner namespace. The
  toast says **この端末に保存しました** / **この端末のブックマークを解除しました**.
  Removing a remote bookmark locally leaves its signed list untouched.
- This feature never requests a signature or sends an EVENT frame. Account sync
  is **read-only**: public `e` tags from kind 10003 are combined with local saves.
  Private ciphertext, article `a` references, and unknown tags are retained in the
  complete signed event, without decryption, rewriting or publication.
- Storage errors are visible; failed local writes do not claim success or replace
  existing data. Storage events reload the current namespace across tabs. Before
  writing, reread local edits and retain the newest signed list from storage so
  an older tab does not blindly overwrite a newer snapshot.

## Protocol and limits

Original specifications checked 2026-11-14:
[NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md),
[NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md),
[NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md).

The latest signed list wins by timestamp, then lowest lexical ID for ties. An
older/missing relay result cannot regress a cached list; it is marked incomplete.
An explicit newer empty list removes remote IDs but retains private local saves.
Only a verified deletion request whose pubkey matches the retrieved target can
mark a post deleted. Without its target, deletion cannot be authenticated: show
**見つかりません**, not a claim that the post was deleted. EOSE means completion
only for the queried relays, not proof that no other relay has the post.

Unknown/failed/deleted IDs remain visible, removable and retryable. Valid notes
remain visible during partial failure. Requests use 50 IDs per batch, up to 32
configured reading relays, an 8 second deadline per batch/relay, and per-relay
500-event / 2M-character aggregate limits in addition to existing inbound frame
limits. Relay hints never expand the configured read destinations.

At most 500 saved IDs are fetched per refresh. Larger lists are retained without
truncation; the next refresh prioritizes remaining unrequested IDs, then rotates
through previously retrieved IDs. Remaining work is explicit in the saved view. Automatic remote editing,
private bookmark decryption, article rendering and global relay completeness are
outside this change; there is no dependency on the other parallel issues.

## Local verification

```sh
node tests/bookmarks.test.mjs
npm test
npm run typecheck
npm run build
npm run lint
node tests/browser/bookmarks-server.mjs
# another terminal, with Python Playwright and Chromium available:
python3 tests/browser/bookmarks.py
```

The browser fixture renders the real App, uses ephemeral test keys and synthetic
signed events, mocks WebSocket, rejects any publication or signing request and
blocks non-local HTTP. It covers desktop/mobile, migration/reload, account
separation, external list updates, partial failure/retry, local removal of a
remote bookmark, delayed-response cancellation and unmount cleanup. Screenshots
are written to `/tmp/nosting-bookmarks-{1280,390}-{guest,partial}.png`, never committed.
