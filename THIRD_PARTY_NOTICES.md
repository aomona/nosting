# Third-party notices

nost.ing's MIT license does not replace licenses of third-party code.

- `scripts/vite/sites-vite-plugin.ts`: vendored OpenAI Sites plugin; retain `scripts/vite/sites-vite-plugin.LICENSE` (MIT, copyright OpenAI).
- `vendor/shadcn-tailwind-4.13.0.css`: retain `vendor/shadcn-tailwind-4.13.0.LICENSE.md` (MIT, copyright shadcn).
- The initial project includes the Vinext/Sites starter scaffolding and shadcn-style UI components. Existing notices are preserved.
- M3E React/Web and React: MIT; Lucide: ISC; nostr-tools: Unlicense; Drizzle and class-variance-authority: Apache-2.0, per the locked package metadata.
- DM Sans and Noto Sans JP are requested from Google Fonts at runtime, not bundled here. Self-hosted font redistribution must include its applicable font license (typically SIL OFL); check the specific downloaded release.

`package-lock.json` identifies exact dependencies and their declared licenses. Transitive/build dependencies include MPL-2.0 components (e.g. lightningcss) and LGPL-3.0-or-later libvips binaries used by sharp. Those licenses continue to apply; an MIT application license does not relicense these packages. If distributing binaries, containers, or modified third-party components, review the applicable source, notice, and redistribution obligations.

This repository distributes source, not node_modules or compiled third-party binaries. Keep original license files when installing or redistributing dependencies.
