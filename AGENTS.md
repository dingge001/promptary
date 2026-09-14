# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

A Chrome MV3 extension that reverse-engineers web images into AI art prompts and manages the resulting library. The distinguishing feature is that prompt output format is **per target model** — see `lib/vision/models.ts`.

## Commands

```bash
pnpm install    # also runs `wxt prepare` to generate types
pnpm dev        # launches a browser with the extension, hot-reloading
pnpm compile    # tsc --noEmit — this is the check to run after changes
pnpm build      # outputs to .output/chrome-mv3
pnpm zip        # packaged zip for the Chrome Web Store
```

`pnpm compile` is the single most useful command. It is also the CI check.

## Architecture notes that will bite you

**Type checking enforces i18n completeness.** All five locale files in `lib/i18n/locales/` are typed against `Dict` from `zh-CN.ts`. Adding a user-visible string means adding it to all five, or the build fails. This is deliberate.

**Two rendering contexts, one shared i18n.** The side panel is React; the in-page result panel (`lib/inpage/`) is plain DOM with Shadow DOM. They share `lib/i18n`, which is why the current locale lives in a module-level variable rather than React context — a DOM-only context cannot read React context.

**Never use `t` as a loop variable.** Several files previously did `tags.map((t) => ...)`, which shadows the translation function. Use `tag`.

**Tailwind class precedence is by CSS order, not by string order.** Writing `baseClass + ' ' + overrideClass` does not reliably override. Build the full class string conditionally instead (see `headerBtn` in `entrypoints/sidepanel/App.tsx`).

**The `neutral` scale is remapped.** `assets/tailwind.css` remaps Tailwind's `neutral-*` onto this project's semantic colors. `bg-neutral-900` does **not** mean "dark background" here — it resolves to `--surface-alt`. For a dark surface, use `bg-ink`. This has caused visible bugs twice.

**Dexie `update()` ignores `undefined` values.** To actually remove a field, use `.modify((obj) => { delete obj.field })`. See `restoreItem` in `lib/db/repo.ts`.

**MV3 Service Worker has no `FileReader`.** Encode base64 via `arrayBuffer()` + `btoa` in chunks. See `lib/vision/image.ts`.

## Boundaries — do not cross these

These are recorded in `docs/PRD.md`; check there for the reasoning.

- **No in-extension image generation.** MV3 service workers are terminated aggressively and generation takes 10–60s. The product injects prompts into the user's existing tool instead.
- **No third-party UI component library.** There are ~15 controls; a library would add hundreds of KB.
- **No network requests other than the user's configured model endpoint.** Local-first is the product's foundation, not an implementation detail. The one deliberate exception is the exports the user triggers themselves.

## Testing changes

There is no test suite. Verify by building and exercising the extension:

1. `pnpm build`
2. Load `.output/chrome-mv3` at `chrome://extensions` (Developer mode → Load unpacked)
3. **Reload the extension and refresh the target page** after changing `content.ts` or `background.ts` — content scripts are injected at page load, so a stale page will run the old code
