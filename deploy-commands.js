import { REST, Routes, Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

export const commands = [
  {
    name: 'help',
    description: 'Show help information about Okhit commands',
  },
  {
    name: 'archive',
    description: 'Archive messages from a channel, thread, or forum to a .txt file',
    options: [
      {
        name: 'export_name',
        description: 'Name for the exported file (without extension)',
        type: 3,
        required: true,
      },
      {
        name: 'source_channel',
        description: 'Single channel/thread/forum to archive',
        type: 7,
        channel_types: [0, 11, 15],
        required: false,
      },
      {
        name: 'source_channels',
        description: 'Multiple channels (comma/space separated IDs)',
        type: 3,
        required: false,
      },
      {
        name: 'message_limit',
        description: 'Maximum number of messages to fetch (default: 500, max: 2000)',
        type: 4,
        min_value: 1,
        max_value: 2000,
        required: false,
      },
      {
        name: 'filter_user',
        description: 'Only archive messages from this user (mention or ID)',
        type: 6,
        required: false,
      },
      {
        name: 'include_replies',
        description: 'Also include replies to the filtered user\'s messages',
        type: 3,
        choices: [
          { name: 'No (default)', value: 'no' },
          { name: 'Yes', value: 'yes' },
        ],
        required: false,
      },
    ],
  },
];

async function deployCommands() {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error deploying commands:', error);
    process.exit(1);
  }
}

deployCommands();
