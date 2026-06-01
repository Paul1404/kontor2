# CLAUDE.md (repo)

Project-specific rules for this repository. The full stack/style guide lives
in the user-level `CLAUDE.md`; this file only adds what is specific to svuwv
and easy to miss.

## Version release protocol (read this before opening a PR)

This app ships its own in-app changelog. The single source of truth is
`src/lib/release-notes.ts`. The sidebar version chip, the login/setup footer,
and the "Versionshinweise" dialog all read from it, and `CURRENT_VERSION` is
derived from `RELEASES[0].version`.

If your change is observable by a user (feature, fix, improvement, or anything
needing operator action), you MUST, in the same PR:

1. Add an entry to the TOP of `RELEASES` in `src/lib/release-notes.ts`, or add
   a `change` to the current top entry if it is still unreleased. Newest first.
   Write `description` in German UI tone: short, direct, no marketing words,
   no em-dashes or en-dashes.
2. Bump the version using semver: `patch` for fixes, `minor` for non-breaking
   features, `major` for anything that needs operator action (env change, DB
   migration, re-import).
3. Keep `package.json` `version` in sync with `RELEASES[0].version`. They must
   always match.

Pure internal refactors that no user can observe may be folded into a `patch`
entry with category `internal`, but the version should still move so the change
is traceable.

Do not let a feature PR merge without a release entry. That is the mistake that
left the changelog stuck at 0.4.0 while many features shipped.
