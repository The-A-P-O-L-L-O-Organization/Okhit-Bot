import { Client, GatewayIntentBits, AttachmentBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const ALLOWED_CHANNEL_IDS = process.env.CHANNEL_IDS
  ? process.env.CHANNEL_IDS.split(',').map(id => id.trim())
  : [];

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'archive':
      await handleArchiveCommand(interaction);
      break;
    case 'help':
      await handleHelpCommand(interaction);
      break;
  }
});

async function handleHelpCommand(interaction) {
  await interaction.reply({
    content: `**Okhit - Archive Bot**\n\n` +
      `**Commands:**\n` +
      `/archive - Archive messages from a channel, thread, forum, or all allowed channels\n\n` +
      `**Options:**\n` +
      `- \`source_channel\` - Specific channel/thread/forum to archive (optional - if omitted, archives ALL allowed channels)\n` +
      `- \`message_limit\` - Max messages per channel (default: 500, max: 2000)\n` +
      `- \`filter_user\` - Only archive messages from this user (optional)\n` +
      `- \`include_replies\` - Include replies to the filtered user's messages (default: No)\n` +
      `- \`export_name\` - Filename for the export (required)\n\n` +
      `**Supported Channel Types:**\n` +
      `- Text Channels\n` +
      `- Public/Private Threads\n` +
      `- Forum Channels (includes all threads and archived threads)\n\n` +
      `**Note:** If no channel is specified, the bot will archive from all channels in the CHANNEL_IDS list.`,
    ephemeral: true,
  });
}

async function handleArchiveCommand(interaction) {
  const sourceChannel = interaction.options.getChannel('source_channel');
  const messageLimit = interaction.options.getInteger('message_limit') ?? 500;
  const exportName = interaction.options.getString('export_name', true);
  const filterUser = interaction.options.getUser('filter_user');
  const includeReplies = interaction.options.getString('include_replies') === 'yes';

  const safeFileName = exportName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(process.cwd(), `${safeFileName}.txt`);

  let progressMessage;

  if (sourceChannel) {
    if (ALLOWED_CHANNEL_IDS.length > 0 && !ALLOWED_CHANNEL_IDS.includes(sourceChannel.id)) {
      await interaction.reply({
        content: 'Error: This channel is not authorized for archiving.',
        ephemeral: true,
      });
      return;
    }

    progressMessage = await interaction.reply({
      content: `Starting archive of <#${sourceChannel.id}>...`,
    });

    try {
      let messages = [];
      let channelName = sourceChannel.name;

      if (sourceChannel.type === ChannelType.GuildText) {
        messages = await fetchMessagesFromTextChannel(sourceChannel, messageLimit, progressMessage, filterUser, includeReplies);
      } else if (
        sourceChannel.type === ChannelType.PublicThread ||
        sourceChannel.type === ChannelType.PrivateThread ||
        sourceChannel.type === ChannelType.AnnouncementThread
      ) {
        channelName = sourceChannel.parent?.name || sourceChannel.name;
        messages = await fetchMessagesFromThread(sourceChannel, messageLimit, progressMessage, filterUser, includeReplies);
      } else if (sourceChannel.type === ChannelType.GuildForum) {
        const forumData = await fetchMessagesFromForum(sourceChannel, messageLimit, progressMessage, filterUser, includeReplies);
        messages = forumData.messages;
        messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      } else {
        await interaction.editReply({
          content: 'Error: Selected channel type is not supported. Please use a Text Channel, Thread, or Forum.',
        });
        return;
      }

      if (messages.length === 0) {
        await interaction.editReply({ content: 'No messages found to archive.' });
        return;
      }

      const formattedContent = messages.map(msg => {
        const threadName = msg.threadName || channelName;
        let line = `[${formatDate(msg.createdAt)}] [${threadName}] [${msg.author.username}]: ${msg.content || ''}`;
        if (msg.attachments.size > 0) {
          const attachments = msg.attachments.map(att => att.url).join(', ');
          line += ` [Attachment(s): ${attachments}]`;
        }
        return line;
      }).join('\n');

      fs.writeFileSync(filePath, formattedContent, 'utf-8');

      const fileSize = fs.statSync(filePath).size;
      const maxSize = 8 * 1024 * 1024;

      if (fileSize > maxSize) {
        fs.unlinkSync(filePath);
        await interaction.editReply({
          content: `Error: The archived content (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds Discord's 8 MB file limit.`,
        });
        return;
      }

      const fileAttachment = new AttachmentBuilder(filePath, { name: `${safeFileName}.txt` });

      await interaction.editReply({
        content: `Successfully archived ${messages.length} messages from <#${sourceChannel.id}>.`,
        files: [fileAttachment],
      });

      console.log(`[${new Date().toISOString()}] Archived ${messages.length} messages from ${sourceChannel.id} (${sourceChannel.name}) for ${interaction.user.tag}`);

    } catch (error) {
      console.error(`[${new Date().toISOString()}] Archive error:`, error);
      await interaction.editReply({
        content: `Error during archive: ${error.message}`,
      });
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } else {
    if (ALLOWED_CHANNEL_IDS.length === 0) {
      await interaction.reply({
        content: 'Error: No CHANNEL_IDS configured and no channel specified.',
        ephemeral: true,
      });
      return;
    }

    progressMessage = await interaction.reply({
      content: `Starting archive of all ${ALLOWED_CHANNEL_IDS.length} allowed channels...`,
    });

    try {
      const allMessages = [];
      const channelIdsToFetch = [...ALLOWED_CHANNEL_IDS];
      let totalMessages = 0;
      let channelsProcessed = 0;

      for (const channelId of channelIdsToFetch) {
        channelsProcessed++;
        const channel = await client.channels.fetch(channelId);

        if (!channel) {
          await updateProgress(progressMessage, channelsProcessed, channelIdsToFetch.length, `Channel ${channelId} not found, skipping...`);
          continue;
        }

        await updateProgress(
          progressMessage,
          channelsProcessed,
          channelIdsToFetch.length,
          `Processing channel ${channelsProcessed}/${channelIdsToFetch.length}: #${channel.name}...`
        );

        let channelMessages = [];

        if (channel.type === ChannelType.GuildText) {
          channelMessages = await fetchMessagesFromTextChannel(channel, messageLimit, null, filterUser, includeReplies);
        } else if (
          channel.type === ChannelType.PublicThread ||
          channel.type === ChannelType.PrivateThread ||
          channel.type === ChannelType.AnnouncementThread
        ) {
          channelMessages = await fetchMessagesFromThread(channel, messageLimit, null, filterUser, includeReplies);
        } else if (channel.type === ChannelType.GuildForum) {
          const forumData = await fetchMessagesFromForum(channel, messageLimit, null, filterUser, includeReplies);
          channelMessages = forumData.messages;
        }

        allMessages.push(...channelMessages);
        totalMessages += channelMessages.length;

        await updateProgress(
          progressMessage,
          channelsProcessed,
          channelIdsToFetch.length,
          `Processed #${channel.name}: ${channelMessages.length} messages (Total: ${totalMessages})`
        );
      }

      if (allMessages.length === 0) {
        await interaction.editReply({ content: 'No messages found to archive.' });
        return;
      }

      allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      const formattedContent = allMessages.map(msg => {
        const channelName = msg.channelName || 'Unknown';
        let line = `[${formatDate(msg.createdAt)}] [${channelName}] [${msg.author.username}]: ${msg.content || ''}`;
        if (msg.attachments.size > 0) {
          const attachments = msg.attachments.map(att => att.url).join(', ');
          line += ` [Attachment(s): ${attachments}]`;
        }
        return line;
      }).join('\n');

      fs.writeFileSync(filePath, formattedContent, 'utf-8');

      const fileSize = fs.statSync(filePath).size;
      const maxSize = 8 * 1024 * 1024;

      if (fileSize > maxSize) {
        fs.unlinkSync(filePath);
        await interaction.editReply({
          content: `Error: The archived content (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds Discord's 8 MB file limit.`,
        });
        return;
      }

      const fileAttachment = new AttachmentBuilder(filePath, { name: `${safeFileName}.txt` });

      await interaction.editReply({
        content: `Successfully archived ${allMessages.length} messages from ${channelsProcessed} channels.`,
        files: [fileAttachment],
      });

      console.log(`[${new Date().toISOString()}] Archived ${allMessages.length} messages from ${channelsProcessed} channels for ${interaction.user.tag}`);

    } catch (error) {
      console.error(`[${new Date().toISOString()}] Archive error:`, error);
      await interaction.editReply({
        content: `Error during archive: ${error.message}`,
      });
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}

async function fetchMessagesFromTextChannel(channel, limit, progressMessage, filterUser, includeReplies) {
  const messages = [];
  let lastId = null;
  const filteredUserId = filterUser?.id;

  while (messages.length < limit) {
    const fetched = await channel.messages.fetch({
      limit: Math.min(100, limit - messages.length),
      before: lastId,
    });

    if (fetched.size === 0) break;

    for (const [_, msg] of fetched) {
      msg.channelName = channel.name;

      if (filteredUserId) {
        const isFromFilterUser = msg.author.id === filteredUserId;
        const isReplyToFilterUser = includeReplies && msg.reference?.messageId;

        if (isFromFilterUser) {
          messages.push(msg);
        } else if (isReplyToFilterUser && includeReplies) {
          if (!messages.some(m => m.id === msg.reference.messageId)) {
            const referencedMsg = await fetchReplyMessage(channel, msg.reference.messageId);
            if (referencedMsg && referencedMsg.author.id === filteredUserId) {
              messages.push(msg);
            }
          } else {
            messages.push(msg);
          }
        }
      } else {
        messages.push(msg);
      }
    }
    lastId = fetched.lastKey();

    if (messages.length % 500 === 0 || messages.length >= limit) {
      await updateProgress(progressMessage, messages.length, limit);
    }
  }

  return messages;
}

async function fetchMessagesFromThread(thread, limit, progressMessage, filterUser, includeReplies) {
  const messages = [];
  let lastId = null;
  const filteredUserId = filterUser?.id;

  while (messages.length < limit) {
    const fetched = await thread.messages.fetch({
      limit: Math.min(100, limit - messages.length),
      before: lastId,
    });

    if (fetched.size === 0) break;

    for (const [_, msg] of fetched) {
      msg.threadName = thread.name;

      if (filteredUserId) {
        const isFromFilterUser = msg.author.id === filteredUserId;
        const isReplyToFilterUser = includeReplies && msg.reference?.messageId;

        if (isFromFilterUser) {
          messages.push(msg);
        } else if (isReplyToFilterUser && includeReplies) {
          if (!messages.some(m => m.id === msg.reference.messageId)) {
            const referencedMsg = await fetchReplyMessage(thread, msg.reference.messageId);
            if (referencedMsg && referencedMsg.author.id === filteredUserId) {
              messages.push(msg);
            }
          } else {
            messages.push(msg);
          }
        }
      } else {
        messages.push(msg);
      }
    }
    lastId = fetched.lastKey();

    if (messages.length % 500 === 0 || messages.length >= limit) {
      await updateProgress(progressMessage, messages.length, limit);
    }
  }

  return messages;
}

async function fetchMessagesFromForum(forumChannel, limit, progressMessage, filterUser, includeReplies) {
  const allMessages = [];
  let totalFetched = 0;

  await updateProgress(progressMessage, totalFetched, limit, 'Fetching active threads...');

  const fetchedThreads = await forumChannel.threads.fetch();
  const allThreads = [...fetchedThreads.threads.values()];

  await updateProgress(progressMessage, totalFetched, limit, 'Fetching archived threads...');

  const archivedFetch = await forumChannel.threads.fetchArchived();
  allThreads.push(...archivedFetch.threads.values());

  const uniqueThreads = Array.from(new Map(allThreads.map(t => [t.id, t])).values());

  let threadCount = 0;
  const totalThreads = uniqueThreads.length;

  for (const thread of uniqueThreads) {
    if (totalFetched >= limit) break;

    threadCount++;

    const status = thread.archived ? 'archived' : 'active';
    await updateProgress(
      progressMessage,
      totalFetched,
      limit,
      `Processing ${status} thread ${threadCount}/${totalThreads}: ${thread.name}...`
    );

    const remainingLimit = limit - totalFetched;
    const threadMessages = await fetchMessagesFromThread(thread, remainingLimit, null, filterUser, includeReplies);

    threadMessages.forEach(msg => {
      msg.channelName = forumChannel.name;
    });

    allMessages.push(...threadMessages);
    totalFetched += threadMessages.length;
  }

  return { messages: allMessages, threadCount };
}

async function fetchReplyMessage(channel, messageId) {
  try {
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

async function updateProgress(progressMessage, current, total, customText = null) {
  const percentage = Math.min(100, Math.round((current / total) * 100));
  const statusText = customText || `Fetching messages...`;
  const filledBars = Math.floor(percentage / 5);
  const emptyBars = 20 - filledBars;
  const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

  try {
    await progressMessage.edit(`${statusText}\n\`\`\`[${progressBar}] ${percentage}% (${current}/${total})\`\`\``);
  } catch {
  }
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

client.login(process.env.TOKEN);
