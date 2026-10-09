# RuneScape Wiki for Raycast

This pnpm workspace keeps the Raycast extension in [`apps/rs3-wiki`](apps/rs3-wiki). The workspace package and the extension have separate names and authors.

```sh
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

To run a Raycast command directly from the extension directory, use `pnpm --dir apps/rs3-wiki <command>`. Store publication runs from that directory with `pnpm --dir apps/rs3-wiki run publish` and opens a pull request; do this only when ready to submit. Raycast's Store preparation guide currently requests npm and a `package-lock.json`, so reconcile that requirement before submission.
