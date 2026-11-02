# Telegram Desktop

This module owns Telegram scenario names and routes. Only the installed Desktop
interface is supported: no MTProto, Bot API, session inspection, or proxy MCP.
Selecting a search row does not prove that the intended chat opened; verify its
header. A username is a public address, not a private cache identifier.

Sending, editing, deletion, administration, payments, and calls must stay within
the user's task. A feature unavailable in the UI must not be replaced with an
undisclosed network request.

`channel.info` reads the open profile panel's title and subscriber label. A
selected ListItem is not a profile. Abbreviated counts return the original label
and `null` instead of an invented exact number. Current parsing recognizes the
Russian and English labels implemented in `index.mjs`.
