# JPEG upload investigation (#11)

The reported camera files, their byte sizes/dimensions and original error messages
are unavailable. These changes address reproducible compatibility gaps; they do
not establish the cause of the report.

| Factor | Finding and behavior |
| --- | --- |
| Browser MIME | Selection previously required exactly `image/jpeg`. Inspect the signature and use canonical MIME even when `File.type` is empty, `image/jpg`, `image/pjpeg` or generic. Extensions only help the picker; they do not authorize content. |
| JPEG structure | Previously a SOF marker plus final `FFD9` passed without checking later data. Walk bounded segment lengths, frame/scan component references and entropy marker boundaries to a real EOI. Truncation, missing scans and malformed lengths fail. Baseline and progressive synthetic JPEGs pass. |
| EXIF / ICC | Skip metadata by segment length, including embedded thumbnails/marker bytes. Metadata is neither decoded nor stripped; EXIF orientation and original bytes remain intact. Malformed segment lengths fail. |
| Data after EOI | Accept a completed JPEG codestream followed by camera trailer bytes. Preserve the complete signed payload, including its trailer; these bytes count toward the upload limit. |
| Dimensions | Keep the existing 64,000,000 pixel and 16,384 pixel per-side limits. A structurally valid oversized JPEG gets a specific 413 error. |
| Request size | Keep exactly 30,000,000 bytes per upload, inclusive, enforced before reading client files and while reading server streams (with or without Content-Length). No daily/count/total quotas added. |

This is structural validation, **not full entropy decoding or proof that every
pixel can be decoded**. Unusual JPEG coding modes and real camera models still
need representative files. The parser follows marker framing in
[ITU-T T.81, Annex B](https://www.w3.org/Graphics/JPEG/itu-t81.pdf).
JPEG content is still checked against the request MIME. NIP-98 payload verification,
replay reservations, storage behavior, canonical media MIME, `nosniff` and sandbox
CSP remain in place. Neither metadata nor trailer bytes become HTML. Known 4xx
validation failures display the actual cause without an uncertain-storage warning;
network failures, 408/409 and server failures keep that warning.

## Local verification

- `npm test` includes synthetic baseline/progressive JPEGs, EXIF/ICC, trailers,
  truncated/invalid structures, signature/MIME mismatch, preserved stored bytes
  and hash, 64 MP/per-side boundaries, and 30 MB limits.
- `npm run typecheck`, `npm run build`, `npm run lint` are separate checks.
- Start `node tests/browser/server.mjs`, then run
  `python tests/browser/image-upload.py` (Playwright and Chromium required).
  This renders the production upload component in a local M3E harness at desktop
  and mobile sizes. Canvas-generated JPEGs, an ephemeral local signer, mocked
  upload responses, blocked external HTTP, and a forbidden WebSocket constructor
  prevent real account or public relay use. Screenshots go to `/tmp/nosting-issue11-*`.
  Browser mocked responses check presentation; the Node tests check server validation.

No screenshots are committed. GIF support (#12) and display order (#13) are outside
this change.
