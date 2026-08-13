# Third-party notices

Image Assistant is distributed under the MIT License. Its production bundle also contains the third-party software listed below. These notices apply only to the identified third-party portions. The machine-readable, version-pinned inventory for every npm package with non-zero bytes in the production esbuild output is [`third-party/bundled-dependencies.json`](third-party/bundled-dependencies.json).

## heic-to 1.0.2

- Copyright: Hopper Gee and the heic-to contributors
- License: GNU Lesser General Public License v3.0 only (`LGPL-3.0-only`)
- Embedded libheif 1.18.2: Copyright (c) 2017 Dirk Farin and contributors; `LGPL-3.0-or-later`
- Embedded libde265 1.0.15: Copyright (c) 2013-2014 struktur AG, Dirk Farin and contributors; `LGPL-3.0-or-later`
- Upstream release: https://github.com/hoppergee/heic-to/tree/v1.0.2
- Upstream commit: `97313f3387b722fc50593785923f1ec9b4db2a46`
- Image Assistant import commit: `1159ec68f781d2ad45383c2ffa14573e993b959e`
- npm source archive: https://registry.npmjs.org/heic-to/-/heic-to-1.0.2.tgz
- npm integrity: `sha512-DppKJ/5Lolca2xuQQ49DIGWhodAeO3O/gFRkcQB9XCiCFLQJQpLQWmVKZnpEx08jKe7xg7Mu17ohSYqfT0O8PA==`
- Upstream `dist/heic-to.min.js` SHA-256: `bd3e6c03d698115c06658e4eb8ba4bf7b6eb06898b9a0bf114805db2485fefc4`
- Vendored file: `src/heic-to.min.js`
- Vendored SHA-256: `9a2ff22899ad5c28cd461e68c9370b263abb6ee418b78229d8bc14beecdcbe9e`

The vendored file is byte-for-byte identical to `dist/heic-to.min.js` from the 1.0.2 npm archive after removal of its single final LF byte. The same minified artifact also appeared in 1.0.1, so the minified bytes alone do not distinguish those two releases. Repository history identifies the imported package as 1.0.2: it was the latest release at Image Assistant import commit `1159ec68f781d2ad45383c2ffa14573e993b959e` on 2024-10-28, and the companion declaration file first shipped in the 1.0.2 archive. During the Image Assistant build the vendored module is bundled and minified into `main.js`; its program logic is otherwise unchanged by this project.

heic-to 1.0.2 states that its embedded decoder was built from libheif 1.18.2. The libheif Emscripten build used by that release defaults to the statically linked libde265 1.0.15 decoder. Corresponding upstream source and build instructions are available at:

- heic-to 1.0.2 source and build script: https://github.com/hoppergee/heic-to/tree/v1.0.2
- libheif 1.18.2 corresponding source: https://github.com/strukturag/libheif/tree/v1.18.2
- libde265 1.0.15 corresponding source: https://github.com/strukturag/libde265/tree/v1.0.15
- Image Assistant application source and build scripts: https://github.com/RandyAllenEEE/obsidian-image-assistant

Each GitHub Release also attaches the following verified source archives beside the plugin binaries:

- `heic-to-1.0.2.tgz`: SHA-256 `ac85610181bb8270faff5e7b5892da9b26131c476f823e695e5b0667675884e7`
- `libheif-1.18.2.tar.gz`: SHA-256 `c4002a622bec9f519f29d84bfdc6024e33fd67953a5fb4dc2c2f11f67d5e45bf`
- `libde265-1.0.15.tar.gz`: SHA-256 `00251986c29d34d3af7117ed05874950c875dd9292d016be29d3b3762666511d`

To replace or relink the LGPL component, build a compatible ES module from those sources, replace `src/heic-to.min.js`, then run `npm ci && npm run build`. The Image Assistant source, including the importing application code and esbuild configuration, is provided under terms that permit this modification. See `licenses/LGPL-3.0.txt` and the incorporated GNU GPL terms in `licenses/GPL-3.0.txt`.

## UTIF.js

- Copyright (c) 2017 Photopea
- License: MIT
- Exact upstream revision: https://github.com/photopea/UTIF.js/tree/2e6be655cb1beee3b4fc193deefee35b10b3a68c
- Upstream LF SHA-256: `b74b27602365347f78ae9977aa31aa8b6522a2f656152523cca3872adef1000d`
- Vendored file: `src/UTIF.js`
- Vendored SHA-256: `b8f55e42f779ebfc2f7fe88f59dea6393a3f4282a03ea5d503f98fec3dbe69d0`

The vendored file differs from the upstream blob only by normalization of 1,762 LF line endings to CRLF; its normalized LF content and program logic are otherwise unchanged. esbuild bundles and minifies it into `main.js`. The copyright and permission notice are reproduced in `licenses/UTIF-MIT.txt`.

## Vercel AI SDK

- Copyright 2023 Vercel, Inc.
- License: Apache License 2.0
- Source: https://github.com/vercel/ai

The production bundle contains the following pinned packages:

- `ai` 6.0.100
- `@ai-sdk/provider` 3.0.8
- `@ai-sdk/provider-utils` 4.0.15

No local changes are made to their source before esbuild tree-shakes, bundles, and minifies the modules used by Image Assistant. The Apache License 2.0 text and upstream copyright notice are reproduced in `licenses/Apache-2.0.txt`.

## Other production bundle dependencies

The following pinned dependencies also have non-zero bytes in the production bundle. Their exact versions, copyright notices and upstream locations are recorded in the inventory linked above. The MIT, ISC and BSD-3-Clause license texts are reproduced in `licenses/MIT.txt`, `licenses/ISC.txt` and `licenses/BSD-3-Clause.txt`.

| Package | Version | License |
| --- | --- | --- |
| `@borewit/text-codec` | 0.2.2 | MIT |
| `@tokenizer/inflate` | 0.4.1 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `debug` | 4.4.3 | MIT |
| `eventsource-parser` | 3.1.0 | MIT |
| `fabric` | 7.4.0 | MIT |
| `file-type` | 21.3.4 | MIT |
| `has-flag` | 4.0.0 | MIT |
| `ieee754` | 1.2.1 | BSD-3-Clause |
| `image-type` | 6.1.0 | MIT |
| `isexe` | 2.0.0 | ISC |
| `ms` | 2.1.3 | MIT |
| `path-browserify` | 1.0.1 | MIT |
| `path-key` | 3.1.1 | MIT |
| `piexifjs` | 1.0.6 | MIT |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `strtok3` | 10.3.5 | MIT |
| `supports-color` | 7.2.0 | MIT |
| `token-types` | 6.1.2 | MIT |
| `uint8array-extras` | 1.5.0 | MIT |
| `which` | 2.0.2 | ISC |
| `zod` | 4.4.3 | MIT |

## Obtaining source for a released build

The GitHub tag associated with each Image Assistant release contains the complete plugin source and build scripts. GitHub also provides source archives for every tag. The exact third-party revisions and reconstruction steps above are retained in this notice so that a recipient of the three standard Obsidian plugin files can locate the corresponding source from the notice embedded at the start of `main.js`.
