# Petal v2 design revision

Source: https://design.google/library/expressive-material-design-google-research
https://m3.material.io/styles/motion/overview/how-it-works
https://m3.material.io/styles/color/the-color-system/

Material 3 Expressive prioritizes key actions through color, size, shape and containment, with coherent spring motion. Functionality and familiar patterns remain paramount; decorative flourishes must not compete with the task. This is an independent web implementation, not a claim of complete component conformance.

Before: large hero + subtitle + promotional right rail consumed the first viewport; duplicate login and relay descriptions; text as small as 8-12px; decorative flowers and post art distracted from notes.
After: two-column navigation/feed; one app bar; one mode selector; composer and notes immediately visible; 48px interactive targets; semantic surface/primary/secondary roles; connected shape-changing tabs; action-only spring motion and reduced-motion override. Security details progressively disclosed in mode/login panels, with demo/non-public designation retained.

Validation: desktop screenshot; 390px light/dark viewport, like/bookmark, settings sheet, live mode with 47 verified notes. TypeScript check passed. QA wrapper removed before publication.

## v3: library migration (2026-11-10)
- Replaced bespoke controls with @m3e/react + @m3e/web 2.12.0 (MIT), https://github.com/matraic/m3e . Independent community project, not Google software or certified complete M3E compliance.
- Actual M3eTheme (seed #426427, expressive motion, strong focus), Button, IconButton, connected ButtonGroup, NavMenu/NavMenuItem, NavBar/NavItem, Dialog. Dynamic color roles now drive application surfaces as well as component colors. Removed app-level CSS-driven component shape/motion overrides; components own their interaction styles.
- Compared @material/web (core M3, not sufficient Expressive), @kyralabs/m3e-react (Expressive, Apache-2.0, CSR), Expressive (source-copy + Tailwind/Base UI, MIT). Chose matraic's typed React bindings for modular components and theme, connected groups, responsive nav and dialogs in one dependency suite. CSR-only boundary prevents DOM-dependent custom elements from executing in Worker SSR.
- App-specific timeline, avatars, composer text area, search input and toast remain custom. This is a real library migration, not a claim that every pixel conforms to a complete official Google web M3E release.
- Desktop + 390px browser viewport: labels, dynamic light/dark, local demo posting, mobile bar, settings dialog tested. No physical handset testing or real signing/posting performed.

## v4: alignment and motion repair
- Fixed incorrect default-slot SVGs in mode selector, timeline selection and settings: use trailing-icon, selected-icon and leading/trailing slots. SVGs block-level and consistently sized; no baseline gap.
- Replaced centered settings buttons with M3eActionList/ListAction so icons and labels align in columns.
- Removed obsolete bespoke button/nav/dialog styles and spring definitions entirely. M3E alone owns control motion; no app-level transform/shape overrides.
- Keep last dialog contents through close animation instead of replacing them with the About screen when modal becomes empty. Dialog minimum width stable within viewport.
- Selection listens to component change event and selected property, not click + transient reflected attributes. Removed manually competing aria-pressed from library radio controls. Verified selected state survives unrelated rerenders; added aria-pressed for local reaction/bookmark actions.
- Explicit settings selection and active destination restoration. Connecting live resets timeline filter to All.
- QA: desktop and390px screenshots, light/dark settings, tab selection/reaction rerender, dialog open/close. Reduced-motion audited in app CSS and library source: component transitions disabled; library ripple retains short90ms non-expanding feedback. No physical-device or OS reduced-motion emulation performed.

## v5: live-only public release
- Removed sample notes, demo mode, local fake publication, demo switching and demo copy from runtime.
- Startup connects to real relays. Retained status, reconnect, connecting/error/empty states, signing requirements and public-post warning.
- Added connection generation guard for async setup/unmount/reconnect, closed old sockets, bounded connecting phase to12seconds. Filtered legacy fake bookmark IDs from loaded state.
- Scope: remove demo and publish, not a claim of production security audit or complete Nostr protocol support.

## v6: note media
- NIP-92 imeta and HTTPS filename image/video parsing; max6media per note; rejects credentials, HTTP, literal IP/local host and unsupported media types. No iframe/HTML embeds; NIP-36 media warnings remain gated.
- Actual M3E Card/Button/IconButton/Dialog for media, responsive layout, lazy images/no-referrer, video network gated by explicit load and no autoplay. Native video controls used for accessibility; no claim of a bespoke M3E video player.
- Tested parser(9assertions), local PNG load/error fallback, real relay images and enlargement(11image elements), real browser MP4 playback(readyState4, paused=false,2s), desktop/390px. Fixtures removed before publishing. No external posts made.
- Browser codec support applies; HLS/DASH, YouTube iframe, media upload not added.

## v7: user-configured relays
- Default wss://yabu.me/ read=true/write=true. Existing installs without relay storage migrate to this default; saved configurations use versioned localStorage and are preserved, invalid stored data falls back safely.
- M3E checkbox rows, add/remove, explicit Save/connect, URL validation, duplicate rejection,16relay limit, per-relay states. Both boxes off disconnects that relay.
- All feed/profile/contact REQ paths are read-gated. EVENT publishing and acknowledgement targets are restricted to connected write-enabled relays. Write-only sockets never subscribe or accept incoming notes. No signing or real external posting used in QA.
- Unit assertions11 passed(URL/duplicates/read-write/default). Browser tested yabu read-only + nos.lol write-only, save/reload persistence, disabling all reads gave0notes with readable message, invalid ws URL error, restored default and47real notes from yabu,390px editor screenshot. Production build/type check required before deploy.

## v8: avatars and profiles
- M3E Avatar renders sanitized HTTPS kind0 picture, lazy/no-referrer with Unicode initial fallback. Avatar/name opens responsive M3E profile card with name,handle,about,safe website,copy public key and author notes.
- Existing signature verification precedes metadata parsing. Typed length-bounded metadata, newest created_at wins (lowest event id tie-break), read-enabled relays only, per-socket metadata request deduplication. Ignore unsigned extra kind1 name/handle fields. Kind3 ownership checked against active login.
- Separate author-note subscription/storage filters by selected pubkey;60notes per relay,100cap. Existing feed stays separate. EOSE closes profile lookups, missing metadata/no-note states displayed. No NIP05 verification claim, no follow/write/profile editing added.
- QA:9parser/version/unsafeURL tests; generated ephemeral local kind0 signature valid/tampered acceptance tests;41feed avatar elements; actual profile61avatars loaded and60same-author notes;390px profile header fixed and inspected; broken-image harness rendered initial F and0img. Temporary QA route removed. No external posts/signing with user account.

## v9: infinite history
- IntersectionObserver loads older notes near the bottom, with explicit manual load/retry/end controls. Home and profile keep independent per-relay cursors; read-disabled relays are excluded. History REQs close after EOSE, timeout or reset; page results batch into id-deduplicated descending lists. Removed old180/100item truncation; content-visibility reduces offscreen layout work.
- Inclusive until overlap protects timestamp boundary. Dense same-second pages double request limits up to1600; ambiguous capped boundary stops with an explicit message instead of silently skipping a second. Relay-provided history/completeness is inherently limited by its retention and limits.
- Generation guards/cancellation,10s timeout, disconnected relay retry, one concurrent page, author/until validation, independent live stream preserved. Reset on reconnect/author change.
- QA:12boundary/filter/dedupe/disconnect/cancel assertions plus multirelay independent cursor/end tests. Browser desktop53→102 notes;390px50→99→149(unique149), profile60→109(unique109). No external posts. Same-second caps/missing history cannot guarantee global completeness across all Nostr relays.

## Inline replies and presentation fixes
- Per-note inline reply unfolds down then right; icon inside growing text area, send right, Escape close, Ctrl/Cmd Enter send. Local isolated callback QA confirmed failure preserves draft and success closes, no relay publication used.
- Real M3E LoadingIndicator for initial connecting/profile and older-page loading; reduced-motion uses static status text.
- Desktop/mobile Home and logo return to top (actual scrollTop 0 verified).
- NIP36 now gates entire content and offers hide again; no hidden image/video/dialog mounted. Warning layout bounded, image contain sizing, mobile limits. Fixed card shadow flex zero-height pitfall with nonshrinking auto-basis content.
- Desktop and 390px iframe tested, no horizontal overflow. Physical phone and OS reduced-motion not exercised.

## Markdown
- react-markdown / remark-gfm / remark-breaks (MIT), AST-based media extraction preserving code and labelled links; gallery dedup including NIP92 metadata.
- HTML skipped, only credential-free HTTP(S) links, no raw HTML/iframes, no independent Markdown images. NIP36 gate applies to rendered Markdown and gallery.
- Formatting, URL/XSS, code, references, media cap unit tests; desktop/390px visual QA. One image from repeated Markdown/bare URL, no horizontal page overflow, code internally scrolls. Reveal/hide toggles confirmed hidden body images and headings 0.
- Markdown changes display only; Nostr kind1 plaintext is unchanged and other clients may display syntax literally.

## Navigation performance
- Memoized note rows and content, stable action ref (latest committed state), memoized filter/ID sets. Different-page transitions jump to top; repeated Home tap alone uses smooth motion when enabled.
- Bounded compiled Markdown LRU: 750 entries, 2M source-key characters, 100k HAST nodes. Unified pipeline produces safe React elements and gallery metadata once. No mounted DOM or reply state cached. HTML discarded; fixed link policy before caching.
- 390px browser/React dev Profiler, 500 synthetic bodies: unrelated parent update 3-run mean before-equivalent 750.9ms vs memoized 2.3ms. Unique-body cold mount 827.4ms vs warm remount 102.7/109.9ms; this is body rendering, not total app/network latency. Cache hits confirmed, no recompilation on warm remount.
- Actual mobile navigation, bookmark add/filter/remove, reply open/input/cancel, profile→home top=0 verified. Security/format/media/cache bound tests and tsc pass. Very long lists still retain DOM and network delays remain; no blanket instant-performance claim.

## Relay search (NIP-50)
- Search now issues explicit NIP-50 REQ to configured read-enabled, connected relays whose NIP-11 declares 50. No automatic relay addition; default remains yabu.me. Unknown/undeclared support is not treated as a working search or silently replaced by local filtering.
- Separate search result collection, no follow tab leakage or timeline pollution; cancel/CLOSE on query/view change, signature validation, per-relay50/global200 bounds,10s timeout, partial/error/unsupported states. Explicit submit avoids transmitting every keystroke.
- yabu.me NIP11 supported_nips [1,2,4,9,11,22,28,40,70,77]; direct search test no response in12s. search.nos.today declares50 and returned5 valid-signed events+EOSE in protocol test. Browser desktop/390px returned50 results (limit marked), read-off excluded, followed-home filter did not affect search, clearing query discarded old results. Test-added relay removed after QA.
- TypeScript and relay-search tests cover gating, verified-only result adoption, dedup, generations, timeout/CLOSED/disconnect, limits, invalid queries, send failures, REQ/CLOSE only. No actual account publication. Empty-result timeout is not misreported as no matches.

## Reply field revision (local draft, based on public v13)
- Excludes the separately saved/unpublished v14 page-motion changes.
- Actual M3eFormField outlined container, native textarea, prefix message icon and suffix cancel/medium filled send controls. Library manages focus outline and component states; M3 shape token28px.
- Real note rows use a two-column grid; desktop reply aligns with text, mobile reply spans avatar+text columns with16px screen margins. Full field measured358px on390px viewport and288px on320px viewport; no page overflow.
- Preserves down-then-right reveal, mobile starts52px from field edge to align with source reply button. Autosize reacts to width changes, no long scroll added.
- Desktop/390/320 visual QA, multiline input, failure preserves draft+error, success closes (isolated callbacks), Escape closes, real-feed integration widths and cancel verified. No external posts, no production deployment requested/performed for this draft.

## Reply-only easing correction
- User clarified easing belongs to replies, not bottom navigation. No page-motion import/effect/file in this version; bottom navigation retains public v13 behavior.
- Reply expands down in180ms, then starts rightward reveal after60ms for220ms (280ms total instead of previous350+120≈470ms). Both use emphasized deceleration cubic-bezier(.2,0,0,1); close150ms with matching timer. Reduced-motion disabling remains.
- Browser computed CSS verified .18s/.22s/.06s and easing. Real390px reply width343 within375px content viewport; textarea input/Escape close and home→search still function. No real post sent.

## Reply send action separation (v17)
- Actual M3E filled button now lives outside the outlined input; left message icon and cancel remain inside. Desktop uses a 12px gap and horizontal action; <=480px keeps the input full width and places the wider action at lower right.
- Preserved 280ms down/right reveal, reduced motion, input focus and failure draft retention. Deferred ResizeObserver height writes through rAF to avoid resize notification loops.
- Verified 390/320px and desktop screenshots; isolated failure callback and close. No actual Nostr posts made.

## v18 correction
- All viewport widths now use the same non-wrapping flex row: shrinking input followed by a separate 80px minimum M3E send button. No mobile stacking. Left icon, cancellation and easing preserved. Verified 320/390px and isolated failure/cancel; no real posts.

## v19 Independent relay failures
- Per-relay constructor/send/timeout isolation and bounded reconnect (1/2/4 seconds, 12-second connect deadlines). Old-generation callbacks cannot disconnect current subscriptions.
- Read/write selection respected, healthy connections remain usable; unavailable readers do not block history pagination. Per-relay ACK dedup and partial publish confirmation.
- Fake sockets verified constructor/send failures, hanging connection deadlines, stale callbacks, partial success, all-failure, timeout and ACK edge cases. Existing search regression and TypeScript checks pass.
- Actual browser: yabu.me + unavailable.invalid => 1/2 connected with 51 notes; all failed/disabled => explicit unavailable UI; restored default yabu => connected with 52 notes. No real posts made.

## v20 Expressive profile header
Actual M3E filled card and tonal/outlined buttons group identity and useful actions. Large name hierarchy, clean spacing, native avatar, safe kind0 banner with overlap only when present; no decorative placeholder banner or repeated description. Source principles: https://design.google/library/expressive-material-design-google-research (intentional shape/size/containment, familiar interactions and accessible readability).
Verified desktop and 390/320px, light/dark, blank metadata, long name/about, broken banner/avatar, no horizontal overflow, copy callback and existing actual relay profile navigation/60 author notes/back. Parser URL safety and tsc pass. No real posts. Temporary QA fixtures removed.

## v21 Manual reconnect
- Individual failed relays offer Reconnect in the upper-right connection panel. Automatic retries are limited to 3, 1/2/4 seconds with ±20% jitter and 12-second deadlines. Manual restart resets only that relay budget.
- Desktop/390px browser: failed relay button appears after exhaustion, clicking resets to 1/3 while yabu and 56 timeline notes remain. Fake socket timer/stale-event/subscription-retention tests and tsc pass.

## v22 Responsive header
- Desktop header sticks at top; mobile keeps its original header until scrolling past 80px, then fixes the same controls at the top. No duplicate action controls, original space retained. Returning to top restores ordinary placement.
- Compact mobile relay counts prevent title wrapping, profile retains connection control. Fixed header has explicit z-index; no motion added.
- Browser verified 390px fixed top=0/header count=1, Home returns static top=16; 320px profile header no horizontal overflow and relay action visible. Desktop sticky top=0 and relay dialog still operates. tsc/build checked.

## Navigation, local persistence, relay discovery, and bounded sessions
- Based on published v48; preserves its profile follow-button alignment. Adds hash routes for every main screen, exact note/profile links, browser Back/Forward, and event-ID/viewport-offset restoration. Keeps framework history metadata and at most two previous author feeds, each with its paging cursor.
- Posting and reply drafts save locally on edits, scoped to account and target. Failed publication keeps text; successful publication clears only the matching sent text. Storage failures are visible. Drafts and mutes are not synchronized to relays.
- Relay settings offer named NIP-50 candidates but require current NIP-11 verification before adding. NIP-65 discovery uses existing read-enabled relay sockets, verified newest kind 10002, and explicit user choice to add a relay. Author outbox suggestions are read-only by default; no automatic write permission or contact-list publication.
- Account-scoped user/word mutes apply to feeds, quoted content, thread replies, and notifications. Profile biographies safely link HTTP(S) URLs. Notifications refresh every 30 seconds after completion while visible, with cancellation and stale-account guards.
- Home/current-author event budgets are 1,200 each. Reaching the limit pauses further loading and offers explicit refresh rather than removing visible history. Bounded profile/event caches and batched feed updates complement existing request/Markdown bounds. Time labels share one timer and one visibility listener.
- Optional session-only lightweight rendering reuses measured wrappers and retains drafts, focused/selected rows, disclosed protected content, loaded videos, and dialogs. It is off by default. Tab navigation and layout changes fall back to full rendering; native Find/screenreader users are told to leave it off. It is not used for search, threads, or notifications.
- QA: TypeScript, all 35 test files, and production build passed. Actual browser checks covered reload-persistent post/reply drafts, thread/profile deep links, mute/unmute, author relay discovery, and a 390px iframe with no horizontal overflow. A light-mode 60-row profile rendered 7 heavy rows; Back restored the selected row at exactly the measured viewport offset in the final run. No real-account signing, posting, uploads, or payment was performed.
- Limits: physical screenreader/phone/IME, actual video playback continuity, large-session heap/CWV/INP, and live authenticated notification delivery were not measured. Notification/socket behavior is covered by fake-socket/timer tests. Public relay availability and NIP-11 CORS can prevent capability checks and are reported as unknown rather than successful.
