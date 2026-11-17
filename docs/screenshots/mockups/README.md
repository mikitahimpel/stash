# Mockups for #148 (media rows, hierarchy, search)

Static pages on made-up data, for the owner's approval before the real pages change. They are
dev-only routes built from the kit (`/_mockups/inbox`, `/_mockups/search`, `/_mockups/search-empty`
under `pnpm dev:web`), and `pnpm --filter @stash/web screenshots:mockups` regenerates these
pictures: Inbox, Search with a query and Search with none, dark and light, 1440 and 390 wide.
The previews are SVG drawn in `apps/web/src/mockups/mockup-thumbs.ts`, not real thumbnails.
