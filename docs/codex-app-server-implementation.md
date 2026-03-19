# Codex App Server Integration Summary

## Overview
Superdesign now has a separate Codex-backed runtime path built on top of the local `codex` CLI and `codex app-server`. This integration is intentionally separate from the existing Claude API provider and does not reuse the OpenAI-compatible API transport.

## Configuration and commands
- `superdesign.llmProvider`
  - Added `codex`
  - Default changed to `codex`
- `superdesign.codexPath`
  - New setting
  - Defaults to `codex`
- `Superdesign: Setup Codex CLI`
  - Verifies the configured `codex` binary
  - Verifies `codex login status`
  - Sets `llmProvider=codex` on success
  - Offers terminal/setup guidance if login is missing

## Provider architecture
### New provider
- Added `src/providers/codexAppServerProvider.ts`
- Added `CODEX` to `LLMProviderType`
- Registered Codex in `LLMProviderFactory`
- Included Codex in provider validation and status reporting

### What the Codex provider does
`CodexAppServerProvider`:
- resolves workspace and `.superdesign` working directories
- reads `superdesign.codexPath`
- checks CLI availability with `codex --help`
- checks login state with `codex login status`
- starts `codex app-server --listen stdio://`
- initializes a JSON-RPC session over stdio
- creates and reuses a thread for the current Superdesign chat session
- starts turns with `turn/start`
- interrupts turns with `turn/interrupt`
- resets thread state on chat reset

## Streaming and event mapping
The provider translates app-server notifications into the existing message flow used by the chat UI.

### Assistant text
- `item/agentMessage/delta` -> assistant text chunks
- completed `agentMessage` items are used as a fallback if no deltas were seen

### Tool-like activity
These app-server items are mapped into the existing tool-call/tool-result UI shape:
- `commandExecution`
  - tool call name: `bash`
  - result includes aggregated output, exit code, and status
- `mcpToolCall`
  - tool call name: `<server>:<tool>`
  - result includes returned result or error
- `fileChange`
  - represented as a synthetic `fileChange` tool call/result

This preserves the current sidebar rendering without requiring a new frontend protocol.

## Runtime routing changes
### Custom agent service
`CustomAgentService` now treats `llmProvider=codex` as a binary-backed provider path, reusing the existing provider service layer rather than the AI SDK/OpenAI-compatible path.

Key changes:
- binary-provider routing now includes `codex`
- the current Superdesign system prompt is passed into the binary-provider query path
- `getSystemPrompt()` reports `codex` when the Codex provider is active
- `resetConversationSession()` was added so the extension can clear persistent Codex/Claude Code session state

### Provider service layer
`ClaudeCodeService` remains the generic entrypoint for binary providers and now exposes `resetSession()` so persistent providers can clear internal thread/session state.

### Claude Code provider
`ClaudeCodeProvider` now overrides `resetSession()` to clear its current session id.

## Extension command behavior
### Clear chat
The `superdesign.clearChat` command now:
1. resets the active provider session via `customAgent.resetConversationSession()`
2. sends the `clearChat` message to the webview

This prevents Codex thread reuse after the user clears the chat.

### Codex setup
`setupCodexCli()` in `src/extension.ts`:
- reads `superdesign.codexPath`
- runs CLI health checks via `child_process.spawn`
- prompts to open a terminal and run `codex login` if needed
- points the user to `superdesign.codexPath` settings if setup fails

## Error handling
`ChatMessageService` now detects when `llmProvider=codex` is active and shows Codex-specific guidance instead of API-key guidance.

The displayed message now tells the user to:
- ensure the `codex` binary is installed
- ensure they are logged in with `codex login`
- run `Superdesign: Setup Codex CLI`

## Sidebar and UI behavior
### Provider detection
`ChatSidebarProvider` now checks `llmProvider` first:
- `codex` -> reports provider as `codex` with model label `Codex CLI`
- `claude-code` -> reports provider as `claude-code` with model label `Claude Code`
- API-backed providers continue using the previous `aiModelProvider` logic

### Model selector behavior
`ChatInterface` now tracks `selectedProvider` and hides the model selector when:
- `codex` is active
- `claude-code` is active

In those cases, the UI shows a simple disabled status button instead of the model dropdown.

## Files changed
- `package.json`
- `src/extension.ts`
- `src/providers/llmProvider.ts`
- `src/providers/llmProviderFactory.ts`
- `src/providers/claudeCodeProvider.ts`
- `src/providers/codexAppServerProvider.ts`
- `src/services/claudeCodeService.ts`
- `src/services/customAgentService.ts`
- `src/services/chatMessageService.ts`
- `src/providers/chatSidebarProvider.ts`
- `src/webview/components/Chat/ChatInterface.tsx`

## Validation performed
- `npm run check-types`
- `npm run lint`
- local protocol probe against `codex app-server`
  - initialize over stdio JSON-RPC
  - `thread/start` response path

## Notes / current limitations
- The implementation uses the app-server as a separate runtime provider, but still adapts its streamed events into the existing internal chat message format rather than introducing a brand-new frontend protocol.
- The provider currently focuses on the most important item types for the existing UI: assistant messages, command execution, MCP tool calls, and file changes.
- The Claude API path was intentionally not modified for Codex support.
