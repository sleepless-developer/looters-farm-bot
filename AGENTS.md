# Repository instructions

## Language

All GitHub-facing content must be in English. This includes README and wiki
pages, documentation, code comments, UI and CLI messages, test descriptions,
commit messages, issue and pull request text, and release notes.

Keep API identifiers, commands, filenames, proper names, and user-supplied data
unchanged unless a separate functional change requires it. Do not rewrite
existing Git history to translate old commit messages.

## Safety and verification

- Never commit credentials, cookies, proxy passwords, runtime data, HAR files,
  private machine paths, or browser state.
- Preserve unrelated local changes. Translation work must not publish
  unfinished features from another working tree.
- Use offline tests and isolated temporary settings for verification.
- Do not start workers, access saved account credentials, or perform game
  actions as part of a translation or documentation check.
- Run `npm run check` before publishing when execution is authorized.
- Keep `wiki/project-status.md`, `wiki/codebase-map.md`, and the append-only
  `wiki/log.md` up to date with safe summaries.
