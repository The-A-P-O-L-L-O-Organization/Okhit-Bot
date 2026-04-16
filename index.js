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

client.once('ready', () => {
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
      `/archive - Archive messages from a channel, thread, or forum\n\n` +
      `**Options:**\n` +
      `- \`source_channel\` - The channel, thread, or forum to archive (required)\n` +
      `- \`message_limit\` - Max messages to fetch (default: 500, max: 2000)\n` +
      `- \`export_name\` - Filename for the export (required)\n\n` +
      `**Supported Channel Types:**\n` +
      `- Text Channels\n` +
      `- Public/Private Threads\n` +
      `- Forum Channels (includes all threads and archived threads)`,
    ephemeral: true,
  });
}

async function handleArchiveCommand(interaction) {
  const sourceChannel = interaction.options.getChannel('source_channel', true);
  const messageLimit = interaction.options.getInteger('message_limit') ?? 500;
  const exportName = interaction.options.getString('export_name', true);

  if (ALLOWED_CHANNEL_IDS.length > 0 && !ALLOWED_CHANNEL_IDS.includes(sourceChannel.id)) {
    await interaction.reply({
      content: 'Error: This channel is not authorized for archiving.',
      ephemeral: true,
    });
    return;
  }

  const safeFileName = exportName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(process.cwd(), `${safeFileName}.txt`);

  const progressMessage = await interaction.reply({
    content: `Starting archive of <#${sourceChannel.id}>...`,
    fetchReply: true,
  });

  try {
    let messages = [];
    let channelName = sourceChannel.name;

    if (sourceChannel.type === ChannelType.GuildText) {
      messages = await fetchMessagesFromTextChannel(sourceChannel, messageLimit, progressMessage);
    } else if (
      sourceChannel.type === ChannelType.PublicThread ||
      sourceChannel.type === ChannelType.PrivateThread ||
      sourceChannel.type === ChannelType.AnnouncementThread
    ) {
      channelName = sourceChannel.parent?.name || sourceChannel.name;
      messages = await fetchMessagesFromThread(sourceChannel, messageLimit, progressMessage);
    } else if (sourceChannel.type === ChannelType.GuildForum) {
      const forumData = await fetchMessagesFromForum(sourceChannel, messageLimit, progressMessage);
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
}

async function fetchMessagesFromTextChannel(channel, limit, progressMessage) {
  const messages = [];
  let lastId = null;

  while (messages.length < limit) {
    const fetched = await channel.messages.fetch({
      limit: Math.min(100, limit - messages.length),
      before: lastId,
    });

    if (fetched.size === 0) break;

    messages.push(...fetched.values());
    lastId = fetched.lastKey();

    if (messages.length % 500 === 0 || messages.length >= limit) {
      await updateProgress(progressMessage, messages.length, limit);
    }
  }

  return messages;
}

async function fetchMessagesFromThread(thread, limit, progressMessage) {
  const messages = [];
  let lastId = null;

  while (messages.length < limit) {
    const fetched = await thread.messages.fetch({
      limit: Math.min(100, limit - messages.length),
      before: lastId,
    });

    if (fetched.size === 0) break;

    fetched.forEach((msg) => {
      msg.threadName = thread.name;
      messages.push(msg);
    });
    lastId = fetched.lastKey();

    if (messages.length % 500 === 0 || messages.length >= limit) {
      await updateProgress(progressMessage, messages.length, limit);
    }
  }

  return messages;
}

async function fetchMessagesFromForum(forumChannel, limit, progressMessage) {
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
    const threadMessages = await fetchMessagesFromThread(thread, remainingLimit, null);

    allMessages.push(...threadMessages);
    totalFetched += threadMessages.length;
  }

  return { messages: allMessages, threadCount };
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
