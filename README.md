# Okhit - Discord Archive Bot

A Discord bot for archiving public roleplay actions into structured .txt files for geopolitical analysis.

## Setup

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   TOKEN=your_bot_token
   CLIENT_ID=your_client_id
   GUILD_ID=your_guild_id
   CHANNEL_IDS=allowed_channel_ids (comma-separated)
   ```
4. Deploy commands: `pnpm deploy`
5. Start the bot: `pnpm start`

## Commands

### /archive
Archive messages from a channel, thread, or forum.

**Options:**
- `source_channel` - Channel, thread, or forum to archive (required)
- `message_limit` - Max messages (default: 500, max: 2000)
- `export_name` - Output filename (required)

**Supported types:** Text Channels, Public/Private Threads, Forum Channels (includes archived threads)

### /help
Display help information about available commands.

## Output Format

```
[YYYY-MM-DD HH:mm] [ChannelName] [AuthorName]: Message content [Attachment(s): url(s)]
```

## Features

- Respects channel restrictions via `CHANNEL_IDS` in .env
- Fetches archived threads in forums
- Includes thread names for forum exports
- Cleans up temporary files after upload
- Progress updates during long archives
