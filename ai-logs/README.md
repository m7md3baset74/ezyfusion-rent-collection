# AI logs

- `claude-code-session.jsonl` is the full transcript of the only AI session used for this assessment: Claude Code in the Claude desktop app (Code tab), exported with the app's Export. One JSON object per line.
- `tool-results/` holds the browser screenshots that the transcript refers to. They show only the local app.

## Redaction

One change was made to the exported transcript, and nothing else was edited. Every occurrence of my claude.ai account email address was replaced with the placeholder `[redacted-account-email]`. That covers the full address, which the app injects as session context, and the address's user-name part where it appears on its own inside the assistant's search patterns. Every line was checked to still be valid JSON after the replacement.

The export also contained app metadata (`metadata.json`, `local-session-state.json`: app settings and tool configuration, not conversation). Those files aren't included.
