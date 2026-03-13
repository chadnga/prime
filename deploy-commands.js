console.log("Registering slash commands...");

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),

  new SlashCommandBuilder()
    .setName('looksmax')
    .setDescription('Looksmax system status'),

  new SlashCommandBuilder()
    .setName('rate')
    .setDescription('Rate a user 1–10')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to rate')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete messages (1–100)')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of messages to delete')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true))
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true))
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user')
    .addStringOption(option =>
      option.setName('userid').setDescription('User ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a member')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(option =>
      option.setName('minutes')
        .setDescription('0 = permanent')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute a member')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription('Check your level'),

  new SlashCommandBuilder()
    .setName('leaderboardlevel')
    .setDescription('View XP leaderboard'),

  new SlashCommandBuilder()
    .setName('givexp')
    .setDescription('Admin: give xp')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(option =>
      option.setName('amount').setDescription('XP amount').setRequired(true)),

  new SlashCommandBuilder()
    .setName('takexp')
    .setDescription('Admin: remove xp')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(option =>
      option.setName('amount').setDescription('XP amount').setRequired(true)),

  new SlashCommandBuilder()
    .setName('censored')
    .setDescription('Manage censored words')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add censored word')
        .addStringOption(opt =>
          opt.setName('word').setDescription('Word').setRequired(true))
        .addStringOption(opt =>
          opt.setName('action')
            .setDescription('warn or mute')
            .setRequired(true)
            .addChoices(
              { name: 'warn', value: 'warn' },
              { name: 'mute', value: 'mute' }
            ))
        .addIntegerOption(opt =>
          opt.setName('duration')
            .setDescription('Mute duration (minutes)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove censored word')
        .addStringOption(opt =>
          opt.setName('word').setDescription('Word').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List censored words')
    ),

  new SlashCommandBuilder()
    .setName('rolesend')
    .setDescription('Admin: Send role selection messages to the roles channel'),

  // =====================
  // MOG BATTLE COMMAND
  // =====================
  new SlashCommandBuilder()
    .setName('mogbattle')
    .setDescription('Create a mog or fog battle with two images')
    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Battle title e.g. "Player1 VS Player2"')
        .setRequired(true)
    )
    .addAttachmentOption(opt =>
      opt.setName('image1')
        .setDescription('Left image')
        .setRequired(true)
    )
    .addAttachmentOption(opt =>
      opt.setName('image2')
        .setDescription('Right image')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('channel')
        .setDescription('Which channel to send the battle to')
        .setRequired(true)
        .addChoices(
          { name: '🔱 MogBattles', value: 'mog' },
          { name: '👧 FogBattles', value: 'fog' }
        )
    )
    .addStringOption(opt =>
      opt.setName('ping')
        .setDescription('Who to ping e.g. @everyone or leave blank for no ping')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('text')
        .setDescription('Extra text to add e.g. "Battle of the buzzcels"')
        .setRequired(false)
    ),

].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log(`Successfully registered ${commands.length} commands`);
  } catch (error) {
    console.error(error);
  }
})();