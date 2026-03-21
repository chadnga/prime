// =====================
// STORAGE
// =====================
const battles = new Map();
const leaderboardSessions = new Map();
const voteSessions = new Map();
const VOTE_SESSION_TTL = 60 * 60 * 1000; // 1 hour

// =====================
// IMPORTS & SETUP
// =====================
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
require('dotenv').config();
const { QuickDB } = require('quick.db');
const db = new QuickDB();
const { createCanvas, loadImage } = require('canvas');
const config = require('./config');
const { drawCover: drawCoverUtil, normalizeRoleName, getDateKey, formatDateLabel, getChannelByName, logError } = require('./src/utils');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// Destructure config
const {
  PREFIX,
  CENSOR_KEY,
  AUTO_MOD_WARN_PREFIX,
  JOIN_LEAVE_STATS_PREFIX,
  VOTE_BATTLE_PREFIX,
  ESCALATION_ALERT_USERNAME,
  SPAM_LIMIT,
  SPAM_TIME,
  SPAM_MUTE,
  XP_PER_MESSAGE,
  COOLDOWN,
  LEVEL_ROLES,
  PROTECTED_ROLES,
  ALLOWED_ROLE_MANAGERS,
  SKULL_EMOJI,
  SKULL_THRESHOLD,
  SKULL_BOARD_KEY,
  SKULL_CHANNEL_NAME,
  PIC_PERMS_ROLE,
  PIC_PERMS_EXEMPT,
  ROLE_CATEGORIES,
} = config;

const spamMap = new Map();
const levelCooldown = new Map();

function drawCover(ctx, img, x, y, w, h) { return drawCoverUtil(ctx, img, x, y, w, h); }

// =====================
// HELPER: grant pic perms role on level-up (once only, exempt if Servus)
// =====================
async function grantPicPermsIfEligible(member) {
  if (!member) return;

  // Skip if they have the exempt role (𝑺𝒆𝒓𝒗𝒖𝒔)
  const isExempt = member.roles.cache.some(r => r.name === PIC_PERMS_EXEMPT);
  if (isExempt) return;

  // Skip if they already have the pic perms role
  const alreadyHasRole = member.roles.cache.some(r => r.name === PIC_PERMS_ROLE);
  if (alreadyHasRole) return;

  // Grant the role
  const picRole = member.guild.roles.cache.find(r => r.name === PIC_PERMS_ROLE);
  if (picRole) await member.roles.add(picRole).catch(err => logError('grantPicPerms', err));
}

// =====================
// HELPER: mod log
// =====================
function sendModLog(guild, embed) {
  const logChannel = getChannelByName(guild, 'MODERATION_LOGS');
  if (!logChannel) return;
  logChannel.send({ embeds: [embed] }).catch(err => logError('sendModLog', err));
}

async function applyAutoDiscipline(message, reason) {
  if (!message.member || message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return { action: 'none', warnCount: 0, muteMinutes: 0 };
  }

  const warnKey = `${AUTO_MOD_WARN_PREFIX}_${message.guild.id}_${message.author.id}`;
  const warnCount = (await db.get(warnKey) || 0) + 1;
  await db.set(warnKey, warnCount);

  let action = 'warn';
  let muteMinutes = 0;

  if (warnCount === 2) { action = 'mute'; muteMinutes = 5; }
  else if (warnCount === 3) { action = 'mute'; muteMinutes = 10; }
  else if (warnCount >= 4) { action = 'mute'; muteMinutes = 120; }

  if (action === 'warn') {
    await message.channel.send(`${message.author} warned (${warnCount}/4). Next mute: 5m.`);
  } else if (message.member.moderatable) {
    await message.member.timeout(muteMinutes * 60 * 1000, `Auto moderation: ${reason}`).catch(err => logError('applyAutoDiscipline:timeout', err));

    let escalationPing = '';
    if (warnCount >= 4) {
      const alertMember = message.guild.members.cache.find(m =>
        normalizeRoleName(m.user.username) === normalizeRoleName(ESCALATION_ALERT_USERNAME) ||
        normalizeRoleName(m.displayName) === normalizeRoleName(ESCALATION_ALERT_USERNAME)
      );
      escalationPing = alertMember ? `<@${alertMember.id}> ` : `@${ESCALATION_ALERT_USERNAME} `;
    }

    await message.channel.send(`${escalationPing}${message.author} muted for ${muteMinutes} minute(s). (warn ${warnCount})`);
  } else {
    await message.channel.send(`${message.author} warned (${warnCount}/4). Could not auto-mute this user.`);
    action = 'warn';
    muteMinutes = 0;
  }

  sendModLog(message.guild, new EmbedBuilder()
    .setColor(action === 'warn' ? 0xffc107 : 0xff5555)
    .setTitle('Auto Moderation Triggered')
    .addFields(
      { name: 'User', value: `${message.author.tag}`, inline: true },
      { name: 'Reason', value: reason.slice(0, 200), inline: true },
      { name: 'Action', value: action === 'warn' ? 'Warned' : `Muted ${muteMinutes}m`, inline: true },
      { name: 'Warning Count', value: `${warnCount}`, inline: true }
    )
    .setTimestamp()
  );

  await addModCase(message.guild.id, { type: action === 'warn' ? 'warn' : 'mute', userId: message.author.id, userTag: message.author.tag, modId: 'auto', modTag: 'Auto Mod', reason, duration: action === 'mute' ? muteMinutes : null });
  return { action, warnCount, muteMinutes };
}

async function addModCase(guildId, { type, userId, userTag, modId, modTag, reason, duration }) {
  try {
    const key = `${config.MOD_CASES_PREFIX}_${guildId}`;
    const cases = await db.get(key) || [];
    const id = cases.length + 1;
    cases.unshift({ id, type, userId, userTag, modId, modTag, reason: (reason || 'No reason')?.slice(0, 500), duration, createdAt: Date.now() });
    if (cases.length > 500) cases.pop();
    await db.set(key, cases);
  } catch (err) { logError('addModCase', err); }
}

async function incrementJoinLeaveStat(guildId, type) {
  if (type !== 'joins' && type !== 'leaves') return;
  const key = `${JOIN_LEAVE_STATS_PREFIX}_${guildId}_${getDateKey(0)}`;
  const current = await db.get(key) || { joins: 0, leaves: 0 };
  current[type] = (current[type] || 0) + 1;
  await db.set(key, current);
}

async function getWeeklyJoinLeaveStats(guildId) {
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const dateKey = getDateKey(i);
    const key = `${JOIN_LEAVE_STATS_PREFIX}_${guildId}_${dateKey}`;
    const data = await db.get(key) || { joins: 0, leaves: 0 };
    rows.push({ dateKey, label: formatDateLabel(dateKey), joins: data.joins || 0, leaves: data.leaves || 0 });
  }
  return rows;
}

function renderJoinLeaveChart(guildName, rows) {
  const width = 1000;
  const height = 520;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#0b1220');
  bg.addColorStop(1, '#111827');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const pad = { top: 95, right: 50, bottom: 85, left: 80 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  ctx.fillStyle = '#f9fafb';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Weekly Joins vs Leaves', pad.left, 45);

  ctx.fillStyle = '#22c55e';
  ctx.fillRect(width - 250, 34, 22, 8);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '18px sans-serif';
  ctx.fillText('Joins', width - 220, 44);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(width - 140, 34, 22, 8);
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('Leaves', width - 110, 44);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1;

  const maxValue = Math.max(5, ...rows.map(r => Math.max(r.joins, r.leaves)));
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const y = pad.top + (chartH * i / yTicks);
    const tickValue = Math.round(maxValue - (maxValue * i / yTicks));
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '18px sans-serif';
    ctx.fillText(String(tickValue), 28, y + 6);
  }

  const xStep = rows.length > 0 ? chartW / rows.length : 0;
  for (let i = 0; i < rows.length; i++) {
    const x = pad.left + (xStep * i) + (xStep / 2);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '17px sans-serif';
    ctx.fillText(rows[i].label, x - 18, height - 40);
  }

  const getY = value => pad.top + chartH - ((value / maxValue) * chartH);
  const groupWidth = Math.min(84, xStep * 0.72);
  const barWidth = Math.max(8, (groupWidth - 10) / 2);

  for (let i = 0; i < rows.length; i++) {
    const centerX = pad.left + (xStep * i) + (xStep / 2);
    const joinHeight = ((rows[i].joins || 0) / maxValue) * chartH;
    const leaveHeight = ((rows[i].leaves || 0) / maxValue) * chartH;
    const joinX = centerX - barWidth - 3;
    const leaveX = centerX + 3;
    const joinY = getY(rows[i].joins || 0);
    const leaveY = getY(rows[i].leaves || 0);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(joinX, joinY, barWidth, joinHeight);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(leaveX, leaveY, barWidth, leaveHeight);
  }

  return canvas.toBuffer();
}

function createLeaderboardRow(sessionId, page, totalPages) {
  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lb_prev:' + sessionId)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId('lb_next:' + sessionId)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled)
  );
}

async function createLeaderboardEmbed(entries, page, pageSize, guildName) {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;
  const pageEntries = entries.slice(start, start + pageSize);

  const lines = [];
  for (let i = 0; i < pageEntries.length; i++) {
    const rank = start + i + 1;
    const row = pageEntries[i];
    let username = 'Unknown User';
    try { username = (await client.users.fetch(row.userId)).tag; } catch {}
    const level = Math.floor(0.1 * Math.sqrt(row.xp));
    lines.push(`#${rank} ${username} - Level ${level} (${row.xp} XP)`);
  }

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`XP Leaderboard (Page ${safePage + 1}/${totalPages})`)
    .setDescription(lines.length ? lines.join('\n') : 'No leaderboard data yet.')
    .setFooter({ text: guildName })
    .setTimestamp();
}

async function getLeaderboardEntries(guildId) {
  const all = await db.all();
  return all
    .filter(data => data.id.startsWith(`xp_${guildId}_`))
    .sort((a, b) => b.value - a.value)
    .map(data => ({ userId: data.id.split('_')[2], xp: data.value }));
}

// =====================
// READY
// =====================
client.once('ready', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

// =====================
// SKULLBOARD
// =====================
async function handleSkullboard(reaction, guild) {
  // Only care about skull emoji
  if (reaction.emoji.name !== SKULL_EMOJI) return;

  const message = reaction.message;

  // Don't skullboard bot messages or messages in the skullboard channel itself
  if (message.author?.bot) return;
  const skullChannel = getChannelByName(guild, 'SKULLBOARD');
  if (!skullChannel) return;
  if (message.channel.id === skullChannel.id) return;

  // Count skulls
  const skullReaction = message.reactions.cache.get(SKULL_EMOJI);
  const count = skullReaction ? skullReaction.count : 0;
  if (count < SKULL_THRESHOLD) return;

  // Check if already posted
  const dbKey = `${SKULL_BOARD_KEY}_${guild.id}_${message.id}`;
  const alreadyPosted = await db.get(dbKey);

  if (alreadyPosted) {
    // Already posted — just update the skull count in the existing skullboard message
    try {
      const existingMsg = await skullChannel.messages.fetch(alreadyPosted);
      const updatedContent = `${SKULL_EMOJI} **${count}** | <#${message.channel.id}>`;
      await existingMsg.edit({ content: updatedContent });
    } catch (err) {
      logError('skullboard:update', err);
      await db.delete(dbKey);
    }
    return;
  }

  // Build the embed
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({
      name: message.author.tag,
      iconURL: message.author.displayAvatarURL()
    })
    .setDescription(message.content || null)
    .addFields({ name: 'Original', value: `[Jump to Message](${message.url})` })
    .setTimestamp(message.createdAt);

  // If the message has an image attachment, show it
  const imageAttachment = message.attachments.find(a =>
    a.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(a.url)
  );
  if (imageAttachment) embed.setImage(imageAttachment.url);

  // If the message has an embed with an image (e.g. a link preview), grab that too
  if (!imageAttachment && message.embeds[0]?.image) {
    embed.setImage(message.embeds[0].image.url);
  }

  const headerContent = `${SKULL_EMOJI} **${count}** | <#${message.channel.id}>`;

  const posted = await skullChannel.send({ content: headerContent, embeds: [embed] });

  // Save the skullboard message ID so we can update the count later
  await db.set(dbKey, posted.id);
}

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  // Fetch partial reactions
  if (reaction.partial) {
    try { await reaction.fetch(); } catch (err) { logError('reactionAdd:fetch', err); return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch (err) { logError('reactionAdd:msgFetch', err); return; }
  }
  if (!reaction.message.guild) return;
  await handleSkullboard(reaction, reaction.message.guild);
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch (err) { logError('reactionRemove:fetch', err); return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch (err) { logError('reactionRemove:msgFetch', err); return; }
  }
  if (!reaction.message.guild) return;
  await handleSkullboard(reaction, reaction.message.guild);
});

// =====================
// LEAVE / KICK LOG
// =====================
client.on("guildMemberRemove", async member => {
  if (!member.user.bot) await incrementJoinLeaveStat(member.guild.id, "leaves");
  const channel = getChannelByName(member.guild, 'BAN_LEAVE_LOGS');
  if (!channel) return;

  const banList = await member.guild.bans.fetch().catch(() => null);
  if (banList && banList.has(member.id)) return;

  const fetchedLogs = await member.guild.fetchAuditLogs({ limit: 1, type: 20 });
  const kickLog = fetchedLogs.entries.first();

  if (kickLog && kickLog.target.id === member.id && Date.now() - kickLog.createdTimestamp < 5000) {
    channel.send(`👢 **KICK**\nUser: ${member.user.tag}\nUser ID: ${member.user.id}\nBy: ${kickLog.executor.tag}`);
  } else {
    channel.send(`🚪 **LEFT**\nUser: ${member.user.tag}\nUser ID: ${member.user.id}`);
  }
});

// =====================
// BAN LOG
// =====================
client.on("guildBanAdd", async ban => {
  const channel = getChannelByName(ban.guild, 'BAN_LEAVE_LOGS');
  if (!channel) return;

  const fetchedLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
  const banLog = fetchedLogs?.entries.first();
  const executor = (banLog && banLog.target.id === ban.user.id) ? banLog.executor.tag : 'Unknown';

  channel.send(`🔨 **BANNED**\nUser: ${ban.user.tag}\nUser ID: ${ban.user.id}\nBanned By: ${executor}`);
});

// =====================
// WELCOME
// =====================
client.on('guildMemberAdd', async member => {
  if (member.user.bot) return;
  await incrementJoinLeaveStat(member.guild.id, "joins");
  const welcomeChannel = getChannelByName(member.guild, 'WELCOME');
  if (!welcomeChannel) return;

  welcomeChannel.send({
    content: `Welcome to PrimeLooks, ${member}! 💀`,
    embeds: [new EmbedBuilder()
      .setColor(0xD3D3D3)
      .setTitle("New Face in the Grind")
      .setDescription(`Hey ${member}, welcome.\n\n**Rules:** Read #rules\n**Next:** Claim roles • Start mogging`)
      .setThumbnail(member.user.displayAvatarURL())
      .setImage("https://media.discordapp.net/attachments/1461462234709491783/1477739615572988126/ezgif-2e95202608cf4691.gif?ex=69a5dbc3&is=69a48a43&hm=c38716b5e331a425888ec1cc20ca7b5e927655b97d0c58fd83160c9b6c54faed&=")
      .setFooter({ text: `Member #${member.guild.memberCount}` })
      .setTimestamp()
    ]
  });
});

// =====================
// DELETED MEDIA LOGGING
// =====================
client.on("messageDelete", async (message) => {
  if (!message.guild || message.author?.bot) return;
  const logChannel = getChannelByName(message.guild, 'MODERATION_LOGS');
  if (!logChannel) return;

  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      await logChannel.send({
        content: `🗑️ Deleted Media\nUser: ${message.author.tag}\nChannel: ${message.channel}\nMessage ID: ${message.id}`,
        files: [attachment.url],
        allowedMentions: { parse: [] }
      });
    }
  }

  const mediaRegex = /(https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp|mp4|mov|webm))/gi;
  const links = message.content?.match(mediaRegex);
  if (links) {
    for (const link of links) {
      await logChannel.send({
        content: `🗑️ Deleted Media Link\nUser: ${message.author.tag}\nChannel: ${message.channel}\nMessage ID: ${message.id}\nLink: ${link}`,
        allowedMentions: { parse: [] }
      });
    }
  }
});

// =====================
// MESSAGE EDITED LOG
// =====================
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  sendModLog(newMessage.guild, new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('✏️ Message Edited')
    .addFields(
      { name: 'Channel', value: `${newMessage.channel}`, inline: true },
      { name: 'Message ID', value: newMessage.id, inline: true },
      { name: 'Author', value: `${newMessage.author} (${newMessage.author.tag})`, inline: true },
      { name: 'Before', value: oldMessage.content?.slice(0, 1000) || '[unknown]' },
      { name: 'After', value: newMessage.content?.slice(0, 1000) || '[unknown]' }
    )
    .setTimestamp()
  );
});

// =====================
// ROLE CREATED / DELETED / UPDATED
// =====================
client.on('roleCreate', async role => {
  sendModLog(role.guild, new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ Role Created')
    .addFields(
      { name: 'Role', value: `${role} (${role.name})`, inline: true },
      { name: 'ID', value: role.id, inline: true }
    )
    .setTimestamp()
  );
});

client.on('roleDelete', async role => {
  sendModLog(role.guild, new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('🗑️ Role Deleted')
    .addFields(
      { name: 'Role', value: role.name, inline: true },
      { name: 'ID', value: role.id, inline: true }
    )
    .setTimestamp()
  );
});

client.on('roleUpdate', async (oldRole, newRole) => {
  const embeds = [];

  if (oldRole.name !== newRole.name) {
    embeds.push(new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('✏️ Role Name Updated')
      .addFields(
        { name: 'Role', value: `${newRole} (${newRole.name})`, inline: true },
        { name: 'ID', value: newRole.id, inline: true },
        { name: 'Previous Name', value: oldRole.name, inline: true }
      )
      .setTimestamp()
    );
  }

  if (oldRole.color !== newRole.color) {
    embeds.push(new EmbedBuilder()
      .setColor(newRole.color || 0x808080)
      .setTitle('🎨 Role Color Updated')
      .addFields(
        { name: 'Role', value: `${newRole} (${newRole.name})`, inline: true },
        { name: 'ID', value: newRole.id, inline: true },
        { name: 'New Color', value: `#${newRole.color.toString(16).padStart(6, '0')}`, inline: true },
        { name: 'Previous Color', value: `#${oldRole.color.toString(16).padStart(6, '0')}`, inline: true }
      )
      .setTimestamp()
    );
  }

  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    const added = newRole.permissions.missing(oldRole.permissions);
    const removed = oldRole.permissions.missing(newRole.permissions);
    embeds.push(new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔒 Role Permissions Updated')
      .addFields(
        { name: 'Role', value: `${newRole} (${newRole.name})`, inline: true },
        { name: 'ID', value: newRole.id, inline: true },
        ...(added.length ? [{ name: 'Added', value: added.join(', ') }] : []),
        ...(removed.length ? [{ name: 'Removed', value: removed.join(', ') }] : [])
      )
      .setTimestamp()
    );
  }

  for (const embed of embeds) sendModLog(newRole.guild, embed);
});

// =====================
// MEMBER ROLE UPDATE + ROLE PROTECTION
// =====================
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

  let roleChangeExecutor = 'Unknown';
  try {
    const fetchedLogs = await newMember.guild.fetchAuditLogs({ type: 25, limit: 6 });
    const roleLog = fetchedLogs.entries.find(entry =>
      entry?.target?.id === newMember.id && Date.now() - entry.createdTimestamp < 15000
    );
    if (roleLog?.executor) roleChangeExecutor = `${roleLog.executor.tag} (${roleLog.executor.id})`;
  } catch {
    roleChangeExecutor = 'Unknown';
  }

  if (added.size > 0) {
    sendModLog(newMember.guild, new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('👤 User Roles Added')
      .setThumbnail(newMember.user.displayAvatarURL())
      .addFields(
        { name: 'User', value: `${newMember} (${newMember.user.tag})`, inline: true },
        { name: 'Added', value: added.map(r => `${r}`).join(', '), inline: true },
        { name: 'By', value: roleChangeExecutor, inline: true }
      )
      .setTimestamp()
    );
  }

  if (removed.size > 0) {
    sendModLog(newMember.guild, new EmbedBuilder()
      .setColor(0xff5555)
      .setTitle('👤 User Roles Removed')
      .setThumbnail(newMember.user.displayAvatarURL())
      .addFields(
        { name: 'User', value: `${newMember} (${newMember.user.tag})`, inline: true },
        { name: 'Removed', value: removed.map(r => `${r}`).join(', '), inline: true },
        { name: 'By', value: roleChangeExecutor, inline: true }
      )
      .setTimestamp()
    );
  }

  // Role protection
  for (const role of added.values()) {
    if (!PROTECTED_ROLES.includes(normalizeRoleName(role.name))) continue;
    const auditLogs = await newMember.guild.fetchAuditLogs({ type: 25, limit: 1 });
    const log = auditLogs.entries.first();
    if (!log) return;
    const executor = await newMember.guild.members.fetch(log.executor.id);
    const isAllowed = executor.roles.cache.some(r => ALLOWED_ROLE_MANAGERS.includes(normalizeRoleName(r.name)));
    if (!isAllowed) await newMember.roles.remove(role);
  }
});

// =====================
// MESSAGE CREATE
// =====================
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // CENSORED WORD CHECK
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    const censored = await db.get(CENSOR_KEY) || [];
    for (const entry of censored) {
      if (message.content.toLowerCase().includes(entry.word.toLowerCase())) {
        await message.delete().catch(err => logError('censor:delete', err));
        await applyAutoDiscipline(message, `Censored word: ${entry.word}`);
        return;
      }
    }
  }

  // PIC / GIF / PERMS KEYWORD DETECTION
  const msgLower = message.content.toLowerCase();
  const mentionsPic   = msgLower.includes('pic');
  const mentionsGif   = msgLower.includes('gif');
  const mentionsPerms = msgLower.includes('perm');

  if (mentionsPic || mentionsGif || mentionsPerms) {
    // Don't respond if they already have pic perms or are Servus
    const hasPerms   = message.member.roles.cache.some(r => r.name === PIC_PERMS_ROLE);
    const isServus   = message.member.roles.cache.some(r => r.name === PIC_PERMS_EXEMPT);

    if (!hasPerms && !isServus) {
      const xpKey      = `xp_${message.guild.id}_${message.author.id}`;
      const currentXP  = await db.get(xpKey) || 0;
      const currentLvl = Math.floor(0.1 * Math.sqrt(currentXP));

      // Work out what they're asking about for the reply
      const topics = [];
      if (mentionsPic)  topics.push('pic');
      if (mentionsGif)  topics.push('gif');
      const topicStr = topics.length > 0 ? topics.join('/') + ' ' : '';

      let reply = '';
      if (currentLvl < 1) {
        reply = `Hey ${message.author}, to unlock **${topicStr}perms** you need to reach **Level 1** first — just chat a bit and you'll get there! 💀`;
      } else {
        const nextLvl    = currentLvl + 1;
        const nextLvlXP  = Math.pow(nextLvl / 0.1, 2);
        const xpNeeded   = Math.ceil(nextLvlXP - currentXP);
        reply = `Hey ${message.author}, you'll unlock **${topicStr}perms** when you hit **Level ${nextLvl}** — only **${xpNeeded} XP** away! Keep chatting 💀`;
      }

      await message.reply({ content: reply, allowedMentions: { repliedUser: true } });
    }
  }

  // XP GAIN
  const key = `xp_${message.guild.id}_${message.author.id}`;
  const nowTime = Date.now();
  let xp = await db.get(key) || 0;

  if (!levelCooldown.has(message.author.id) || nowTime - levelCooldown.get(message.author.id) >= COOLDOWN) {
    xp += XP_PER_MESSAGE;
    await db.set(key, xp);
    levelCooldown.set(message.author.id, nowTime);
  }

  let level = Math.floor(0.1 * Math.sqrt(xp));
  let lastLevel = await db.get(`lvl_${key}`) ?? 0;

  if (level > lastLevel && level > 0) {
    await db.set(`lvl_${key}`, level);
    const levelChannel = getChannelByName(message.guild, 'LEVEL');
    console.log(`🔍 Level up! Level: ${level}, Channel: ${levelChannel?.name || 'NOT FOUND'}`);
    if (levelChannel) levelChannel.send(`<@${message.author.id}> reached level **${level}**! 🎉`);

    // Grant pic perms role on first level-up (level 1+), skips if already has it or is Servus
    await grantPicPermsIfEligible(message.member);
  }

  // ANTI-SPAM
  const now = Date.now();
  const userId = message.author.id;
  if (!spamMap.has(userId)) spamMap.set(userId, []);
  const timestamps = spamMap.get(userId);
  while (timestamps.length && timestamps[0] <= now - SPAM_TIME) timestamps.shift();
  timestamps.push(now);

  if (timestamps.length >= SPAM_LIMIT) {
    spamMap.delete(userId);
    const fetched = await message.channel.messages.fetch({ limit: 20 });
    const spamMessages = fetched.filter(m => m.author.id === userId && (now - m.createdTimestamp) <= SPAM_TIME);
    await message.channel.bulkDelete(spamMessages, true).catch(err => logError('antispam:bulkDelete', err));
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await applyAutoDiscipline(message, `Spam (${spamMessages.size} messages in ${SPAM_TIME / 1000}s)`);
    }
    return;
  }

  // OPPONENT ACCEPTS BATTLE (!mog prefix command)
  const battle = battles.get(message.channel.id);
  if (battle && message.author.id === battle.opponent.id && message.attachments.first()) {
    battle.opponentImg = message.attachments.first().url;
    const battleId = `mog_${message.channel.id}_${Date.now()}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vote_left:${battleId}`).setLabel('⬅️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`vote_right:${battleId}`).setLabel('➡️').setStyle(ButtonStyle.Primary)
    );
    const embed = new EmbedBuilder()
      .setTitle(`${battle.challenger.username} VS ${battle.opponent.username}`)
      .setDescription('Vote below • ⬅️ 0 votes | 0 votes ➡️')
      .setImage(battle.challengerImg);

    const sent = await message.channel.send({ embeds: [embed], components: [row] });
    await message.channel.send(battle.opponentImg);
    voteSessions.set(battleId, { messageId: sent.id, channelId: message.channel.id, leftVotes: 0, rightVotes: 0, voted: new Set(), title: `${battle.challenger.username} VS ${battle.opponent.username}`, expires: Date.now() + VOTE_SESSION_TTL });
    setTimeout(() => voteSessions.delete(battleId), VOTE_SESSION_TTL);
    battles.delete(message.channel.id);
  }

  // PREFIX COMMANDS
  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "unban") {
    if (!message.member.permissions.has("BanMembers")) return message.reply("You don't have permission to use this.");
    const userId = args[0];
    if (!userId) return message.reply("Provide a user ID. Example: !unban 123456789");
    try {
      await message.guild.members.unban(userId);
      message.channel.send(`✅ Successfully unbanned user ID: ${userId}`);
      const logChannel = getChannelByName(message.guild, 'BAN_LEAVE_LOGS');
      if (logChannel) logChannel.send(`🔓 User Unbanned\nUser ID: ${userId}\nUnbanned By: ${message.author.tag}`).catch(err => logError('unban:log', err));
    } catch {
      message.reply("Failed to unban. Make sure the ID is correct and the user is banned.");
    }
    return;
  }

  if (command === "av" || command === "avatar") {
    const target = message.mentions.users.first() || message.author;
    const avatarURL = target.displayAvatarURL({ size: 1024, dynamic: true });
    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle(`${target.username}'s Avatar`)
      .setImage(avatarURL)
      .setDescription(`[Download Avatar](${avatarURL})`)
      .setFooter({ text: `Requested by ${message.author.tag}` })
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  if (command === 'mog') {
    const opponent = message.mentions.users.first();
    if (!opponent) return message.reply('Mention someone to battle.');
    if (opponent.bot || opponent.id === message.author.id) return message.reply('You cannot battle bots or yourself.');
    const attachment1 = message.attachments.first();
    if (!attachment1) return message.reply('Attach YOUR photo with the command.');
    battles.set(message.channel.id, {
      challenger: message.author,
      opponent,
      challengerImg: attachment1.url,
      opponentImg: null
    });
    return message.channel.send(`${opponent}, you have been challenged.\nReply with your photo to accept.`);
  }

  if (command === 'warnings') {
    const target = message.mentions.users.first() || message.author;
    if (target.id !== message.author.id && !message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.reply("You can only view your own warnings.");
    }
    const warnKey = `${AUTO_MOD_WARN_PREFIX}_${message.guild.id}_${target.id}`;
    const warnCount = await db.get(warnKey) || 0;
    const nextAction = warnCount <= 0 ? "Warn" : warnCount === 1 ? "Mute 5m" : warnCount === 2 ? "Mute 10m" : "Mute 2h";
    return message.reply(`${target} has **${warnCount}** warning(s). Next action: **${nextAction}**.`);
  }

  if (command === 'clearwarnings') {
    const target = message.mentions.users.first() || message.author;
    if (target.id !== message.author.id && !message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.reply("You need Moderate Members to clear someone else's warnings.");
    }
    const warnKey = `${AUTO_MOD_WARN_PREFIX}_${message.guild.id}_${target.id}`;
    await db.set(warnKey, 0);
    return message.reply(`Cleared warnings for ${target}.`);
  }

  if (command === 'leaderboard' || command === 'leaderboardlevel') {
    const entries = await getLeaderboardEntries(message.guild.id);
    if (!entries.length) return message.reply('No leaderboard data yet.');
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
    const requested = parseInt(args[0], 10);
    const page = Number.isFinite(requested) ? Math.max(0, Math.min(totalPages - 1, requested - 1)) : 0;
    const sessionId = message.id + '_' + Date.now();
    leaderboardSessions.set(sessionId, { entries, requesterId: message.author.id });
    setTimeout(() => leaderboardSessions.delete(sessionId), 10 * 60 * 1000);
    const embed = await createLeaderboardEmbed(entries, page, pageSize, message.guild.name);
    const row = createLeaderboardRow(sessionId, page, totalPages);
    return message.channel.send({ embeds: [embed], components: [row] });
  }

  if (command === 'ping') return message.reply('Pong');

  if (command === 'chart') {
    const rows = await getWeeklyJoinLeaveStats(message.guild.id);
    const totalJoins = rows.reduce((sum, d) => sum + d.joins, 0);
    const totalLeaves = rows.reduce((sum, d) => sum + d.leaves, 0);
    const chartBuffer = renderJoinLeaveChart(message.guild.name, rows);
    const file = new AttachmentBuilder(chartBuffer, { name: 'join-leave-weekly.png' });
    const embed = new EmbedBuilder()
      .setColor(0x111827)
      .setTitle('Server Activity (Last 7 Days)')
      .setDescription(`Joins: **${totalJoins}** | Leaves: **${totalLeaves}**`)
      .setImage('attachment://join-leave-weekly.png')
      .setTimestamp();
    return message.channel.send({ embeds: [embed], files: [file] });
  }

  if (command === 'purge') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ No permission.');
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return message.reply('❌ 1–100 only.');
    const fetched = await message.channel.messages.fetch({ limit: amount + 1 });
    const sorted = fetched.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const logText = sorted.map(m =>
      `[${new Date(m.createdTimestamp).toLocaleString()}] ${m.author.tag} (ID: ${m.author.id})\n${m.content || '[no text content]'}${m.attachments.size > 0 ? '\n[had attachment]' : ''}`
    ).join('\n\n---\n\n');
    await message.channel.bulkDelete(sorted, true);
      const logChannel = getChannelByName(message.guild, 'MODERATION_LOGS');
    if (logChannel) {
      const fileName = `PrimeLooks_DeletedMessages_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      const file = new AttachmentBuilder(Buffer.from(logText, 'utf-8'), { name: fileName });
      await logChannel.send({
        embeds: [new EmbedBuilder()
          .setColor(0x808080)
          .setTitle('🧹 Messages Purged')
          .addFields(
            { name: 'Channel', value: message.channel.toString(), inline: true },
            { name: 'Amount', value: amount.toString(), inline: true },
            { name: 'Moderator', value: message.author.tag, inline: true }
          )
          .setTimestamp()
        ],
        files: [file]
      });
    }
    return;
  }

  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) return message.reply('❌ No kick permission.');
    const member = message.mentions.members.first();
    if (!member || !member.kickable) return message.reply('❌ Cannot kick this user.');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    await member.kick(reason);
    await addModCase(message.guild.id, { type: 'kick', userId: member.id, userTag: member.user.tag, modId: message.author.id, modTag: message.author.tag, reason });
    sendModLog(message.guild, new EmbedBuilder()
      .setColor(0xff8800)
      .setTitle('👢 User Kicked')
      .addFields({ name: 'User', value: member.user.tag, inline: true }, { name: 'Moderator', value: message.author.tag, inline: true }, { name: 'Reason', value: reason })
      .setTimestamp()
    );
    return;
  }

  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return message.reply('❌ No ban permission.');
    const member = message.mentions.members.first();
    if (!member || !member.bannable) return message.reply('Banned.');
    const banReason = args.slice(1).join(' ') || `Banned by ${message.author.tag}`;
    await member.ban({ reason: banReason });
    await addModCase(message.guild.id, { type: 'ban', userId: member.id, userTag: member.user.tag, modId: message.author.id, modTag: message.author.tag, reason: banReason });
    sendModLog(message.guild, new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🔨 User Banned')
      .addFields({ name: 'User', value: member.user.tag, inline: true }, { name: 'Moderator', value: message.author.tag, inline: true }, { name: 'Reason', value: banReason.slice(0, 200), inline: false })
      .setTimestamp()
    );
    return;
  }

  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply('❌ No mute permission.');
    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Mention a user.');
    const timeArg = args[1];
    if (!timeArg) return message.reply('❌ Provide time.');
    let duration = timeArg.endsWith('m') ? parseInt(timeArg) * 60000 : timeArg.endsWith('h') ? parseInt(timeArg) * 3600000 : null;
    if (!duration) return message.reply('❌ Use m or h.');
    await member.timeout(duration);
    const muteReason = args.slice(2).join(' ') || 'No reason provided';
    const muteMins = Math.round(duration / 60000);
    await addModCase(message.guild.id, { type: 'mute', userId: member.id, userTag: member.user.tag, modId: message.author.id, modTag: message.author.tag, reason: muteReason, duration: muteMins });
    sendModLog(message.guild, new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('🔇 User Muted')
      .addFields({ name: 'User', value: member.user.tag, inline: true }, { name: 'Moderator', value: message.author.tag, inline: true }, { name: 'Duration', value: timeArg, inline: true }, { name: 'Reason', value: muteReason.slice(0, 200), inline: false })
      .setTimestamp()
    );
    return;
  }

  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply('❌ No unmute permission.');
    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Mention a user.');
    await member.timeout(null);
    sendModLog(message.guild, new EmbedBuilder()
      .setColor(0x00ffff)
      .setTitle('🔊 User Unmuted')
      .addFields({ name: 'User', value: member.user.tag, inline: true }, { name: 'Moderator', value: message.author.tag, inline: true })
      .setTimestamp()
    );
  }
});

// =====================
// INTERACTIONS (buttons + slash)
// =====================
client.on('interactionCreate', async interaction => {

  // ROLE BUTTONS
  if (interaction.isButton() && interaction.customId.startsWith('role_')) {
    const parts = interaction.customId.split('_');
    const categoryIndex = parseInt(parts[1]);
    const roleIndex = parseInt(parts[2]);

    const category = ROLE_CATEGORIES[categoryIndex];
    const chosenRole = category.roles[roleIndex];
    const member = interaction.member;
    const guild = interaction.guild;

    const allCategoryRoles = category.roles.map(r =>
      guild.roles.cache.find(gr => gr.name === r.roleName)
    ).filter(Boolean);

    const targetRole = guild.roles.cache.find(r => r.name === chosenRole.roleName);

    if (!targetRole) {
      return interaction.reply({
        content: `❌ Role **${chosenRole.roleName}** not found. Please tell an admin to check the role names.`,
        ephemeral: true
      });
    }

    for (const role of allCategoryRoles) {
      if (role.id !== targetRole.id && member.roles.cache.has(role.id)) {
        await member.roles.remove(role).catch(err => logError('role:remove', err));
      }
    }

    if (member.roles.cache.has(targetRole.id)) {
      await member.roles.remove(targetRole).catch(err => logError('role:remove', err));
      return interaction.reply({ content: `✅ Removed the **${chosenRole.label}** role.`, ephemeral: true });
    } else {
      await member.roles.add(targetRole).catch(err => logError('role:add', err));
      return interaction.reply({ content: `✅ You now have the **${chosenRole.label}** role!`, ephemeral: true });
    }
  }

  // LEADERBOARD + VOTE BUTTONS
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('lb_prev:') || interaction.customId.startsWith('lb_next:')) {
      const [action, sessionId] = interaction.customId.split(':');
      const session = leaderboardSessions.get(sessionId);
      if (!session) return interaction.reply({ content: 'This leaderboard session expired.', ephemeral: true });
      if (interaction.user.id !== session.requesterId) {
        return interaction.reply({ content: 'Only the command user can flip pages.', ephemeral: true });
      }
      const currentTitle = interaction.message.embeds?.[0]?.title || 'XP Leaderboard (Page 1/1)';
      const match = currentTitle.match(/Page\s+(\d+)\/(\d+)/i);
      const currentPage = match ? Math.max(0, parseInt(match[1], 10) - 1) : 0;
      const totalPages = match ? Math.max(1, parseInt(match[2], 10)) : Math.max(1, Math.ceil(session.entries.length / 10));
      const nextPage = action === 'lb_prev'
        ? Math.max(0, currentPage - 1)
        : Math.min(totalPages - 1, currentPage + 1);
      const embed = await createLeaderboardEmbed(session.entries, nextPage, 10, interaction.guild?.name || 'Leaderboard');
      const row = createLeaderboardRow(sessionId, nextPage, totalPages);
      return interaction.update({ embeds: [embed], components: [row] });
    }

    // Vote buttons (format: vote_left:battleId or vote_right:battleId)
    if (interaction.customId.startsWith('vote_left:') || interaction.customId.startsWith('vote_right:')) {
      const [, battleId] = interaction.customId.split(':');
      const session = voteSessions.get(battleId);
      if (!session) return interaction.reply({ content: 'This battle has ended.', ephemeral: true });
      if (session.voted.has(interaction.user.id)) return interaction.reply({ content: "You've already voted!", ephemeral: true });
      session.voted.add(interaction.user.id);
      const isLeft = interaction.customId.startsWith('vote_left');
      if (isLeft) session.leftVotes++; else session.rightVotes++;
      try {
        const channel = await client.channels.fetch(session.channelId);
        const msg = await channel.messages.fetch(session.messageId);
        const newDesc = `Vote below • ⬅️ ${session.leftVotes} votes | ${session.rightVotes} votes ➡️`;
        const newEmbed = EmbedBuilder.from(msg.embeds[0]).setDescription(newDesc);
        await msg.edit({ embeds: [newEmbed] });
      } catch (err) { logError('vote:update', err); }
      return interaction.reply({ content: isLeft ? '⬅️ Vote for left counted!' : '➡️ Vote for right counted!', ephemeral: true });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // /looksmax
  if (interaction.commandName === 'looksmax') {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('💀 Looksmax System')
      .setDescription('PrimeLooks mogging system is **online**.\n\n• XP & Levels\n• Mog/Fog Battles\n• Skullboard\n• Auto Moderation')
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // /rate
  if (interaction.commandName === 'rate') {
    const user = interaction.options.getUser('user');
    const rating = Math.floor(Math.random() * 10) + 1;
    const emoji = rating >= 9 ? '🔥' : rating >= 7 ? '✨' : rating >= 5 ? '👍' : '💀';
    return interaction.reply(`${user} gets a **${rating}/10** ${emoji}`);
  }

  // /ping
  if (interaction.commandName === 'ping') {
    const latency = Date.now() - interaction.createdTimestamp;
    return interaction.reply(`Pong! Latency: **${latency}ms**`);
  }

  // /mogbattle
  if (interaction.commandName === 'mogbattle') {
    await interaction.deferReply({ ephemeral: true });

    const title         = interaction.options.getString('title');
    const img1          = interaction.options.getAttachment('image1');
    const img2          = interaction.options.getAttachment('image2');
    const channelChoice = interaction.options.getString('channel');
    const pingText      = interaction.options.getString('ping') || '';
    const extraText     = interaction.options.getString('text') || '';

    const targetChannel = channelChoice === 'mog'
      ? getChannelByName(interaction.guild, 'MOG_BATTLE')
      : getChannelByName(interaction.guild, 'FOG_BATTLE');

    if (!targetChannel) {
      return interaction.editReply({ content: `❌ Could not find the ${channelChoice === 'mog' ? 'MogBattles' : 'FogBattles'} channel.` });
    }

    try {
      const leftImg  = await loadImage(img1.url);
      const rightImg = await loadImage(img2.url);

      const panelW = 450;
      const panelH = 500;
      const gap    = 10;
      const canvas = createCanvas(panelW * 2 + gap, panelH);
      const ctx    = canvas.getContext('2d');

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      drawCover(ctx, leftImg,  0,           0, panelW, panelH);
      drawCover(ctx, rightImg, panelW + gap, 0, panelW, panelH);

      const battleImage = new AttachmentBuilder(canvas.toBuffer(), { name: 'battle.png' });

      const battleId = `mog_${targetChannel.id}_${Date.now()}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vote_left:${battleId}`).setLabel('⬅️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vote_right:${battleId}`).setLabel('➡️').setStyle(ButtonStyle.Primary)
      );

      let content = '';
      if (pingText)  content += `${pingText}\n`;
      if (extraText) content += `${extraText}\n`;
      content += `**${title}**`;

      const voteEmbed = new EmbedBuilder().setColor(0x2b2d31).setDescription('Vote below • ⬅️ 0 votes | 0 votes ➡️');
      const sent = await targetChannel.send({ content, files: [battleImage], embeds: [voteEmbed], components: [row] });
      voteSessions.set(battleId, { messageId: sent.id, channelId: targetChannel.id, leftVotes: 0, rightVotes: 0, voted: new Set(), title, expires: Date.now() + VOTE_SESSION_TTL });
      setTimeout(() => voteSessions.delete(battleId), VOTE_SESSION_TTL);
      return interaction.editReply({ content: `✅ Battle posted in ${targetChannel}!` });

    } catch (err) {
      console.error('mogbattle error:', err);
      return interaction.editReply({ content: '❌ Something went wrong. Make sure both images are jpg, png, or webp.' });
    }
  }

  // /rolesend
  if (interaction.commandName === 'rolesend') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    }
    const rolesChannel = getChannelByName(interaction.guild, 'ROLES');
    if (!rolesChannel) {
      return interaction.reply({ content: '❌ Could not find the roles channel.', ephemeral: true });
    }
    for (let i = 0; i < ROLE_CATEGORIES.length; i++) {
      const category = ROLE_CATEGORIES[i];
      const roleList = category.roles.map(r => `${r.emoji}  @${r.label}`).join('\n');
      const embed = new EmbedBuilder()
        .setColor(category.color)
        .setTitle(category.title)
        .setDescription(roleList);
      const row = new ActionRowBuilder();
      for (let j = 0; j < category.roles.length; j++) {
        const roleOption = category.roles[j];
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`role_${i}_${j}`)
            .setLabel(roleOption.label)
            .setEmoji(roleOption.emoji)
            .setStyle(ButtonStyle.Secondary)
        );
      }
      await rolesChannel.send({ embeds: [embed], components: [row] });
    }
    return interaction.reply({ content: '✅ Role messages sent!', ephemeral: true });
  }

  // /level
  if (interaction.commandName === "level") {
    const userKey = `xp_${interaction.guild.id}_${interaction.user.id}`;
    const xp = await db.get(userKey) || 0;
    const level = Math.floor(0.1 * Math.sqrt(xp));
    const xpNeeded = Math.pow((level + 1) / 0.1, 2);
    const prevLevelXP = Math.pow(level / 0.1, 2);
    const progressXP = xp - prevLevelXP;
    const neededXP = xpNeeded - prevLevelXP;
    const percent = progressXP / neededXP;

    const all = await db.all();
    const filtered = all.filter(data => data.id.startsWith(`xp_${interaction.guild.id}_`)).sort((a, b) => b.value - a.value);
    const rank = filtered.findIndex(d => d.id === userKey) + 1;

    const canvas = createCanvas(900, 300);
    const ctx = canvas.getContext("2d");
    try {
      const background = await loadImage(config.LEVEL_CARD_BG);
      ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
    } catch {
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const avatar = await loadImage(interaction.user.displayAvatarURL({ extension: "png", size: 256 }));
    ctx.save();
    ctx.beginPath();
    ctx.arc(150, 150, 90, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 60, 60, 180, 180);
    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText(`@${interaction.user.username}`, 280, 100);
    ctx.font = "26px sans-serif";
    ctx.fillStyle = "#d4af37";
    ctx.fillText(`Level: ${level}`, 280, 145);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`XP: ${xp} / ${Math.floor(xpNeeded)}`, 280, 180);
    ctx.fillText(`Rank: #${rank}`, 280, 215);

    const barX = 280, barY = 240, barWidth = 500, barHeight = 30;
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 4;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = "#000000";
    ctx.fillRect(barX + 4, barY + 4, barWidth - 8, barHeight - 8);
    const progressWidth = percent * (barWidth - 8);
    const goldGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    goldGradient.addColorStop(0, "#b8860b");
    goldGradient.addColorStop(1, "#ffd700");
    ctx.fillStyle = goldGradient;
    ctx.fillRect(barX + 4, barY + 4, progressWidth, barHeight - 8);

    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: "prime-level.png" });
    return interaction.reply({ files: [attachment] });
  }

  // /unban
  if (interaction.commandName === "unban") {
    if (!interaction.member.permissions.has("BanMembers")) return interaction.reply({ content: "You don't have permission to unban members.", ephemeral: true });
    const userId = interaction.options.getString("userid");
    try {
      await interaction.guild.members.unban(userId);
      return interaction.reply({ content: `Successfully unbanned user with ID: ${userId}`, ephemeral: false });
    } catch {
      return interaction.reply({ content: "Failed to unban user. Make sure the ID is correct and the user is banned.", ephemeral: true });
    }
  }

  // /givexp
  if (interaction.commandName === "givexp") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const user = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const targetKey = `xp_${interaction.guild.id}_${user.id}`;
    const levelKey = `lvl_${targetKey}`;
    const currentXP = await db.get(targetKey) || 0;
    const newXP = currentXP + amount;
    await db.set(targetKey, newXP);
    const newLevel = Math.floor(0.1 * Math.sqrt(newXP));
    const lastLevel = await db.get(levelKey) ?? 0;
    if (newLevel > lastLevel && newLevel > 0) {
      await db.set(levelKey, newLevel);
      const levelChannel = getChannelByName(interaction.guild, 'LEVEL');
      if (levelChannel) levelChannel.send(`<@${user.id}> reached level **${newLevel}**! 🎉`);

      // Grant pic perms role on level-up via givexp too
      const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      await grantPicPermsIfEligible(targetMember);
    }
    return interaction.reply(`✅ Gave ${amount} XP to ${user.tag}`);
  }

  // /takexp
  if (interaction.commandName === "takexp") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const user = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const targetKey = `xp_${interaction.guild.id}_${user.id}`;
    const levelKey = `lvl_${targetKey}`;
    const currentXP = await db.get(targetKey) || 0;
    const newXP = Math.max(0, currentXP - amount);
    await db.set(targetKey, newXP);
    const newLevel = Math.floor(0.1 * Math.sqrt(newXP));
    await db.set(levelKey, newLevel);
    return interaction.reply(`✅ Removed ${amount} XP from ${user.tag}\nNew XP: ${newXP}`);
  }

  // /leaderboardlevel
  if (interaction.commandName === "leaderboardlevel") {
    const entries = await getLeaderboardEntries(interaction.guild.id);
    if (!entries.length) return interaction.reply("No leaderboard data yet.");
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
    const sessionId = interaction.id + '_' + Date.now();
    leaderboardSessions.set(sessionId, { entries, requesterId: interaction.user.id });
    setTimeout(() => leaderboardSessions.delete(sessionId), 10 * 60 * 1000);
    const embed = await createLeaderboardEmbed(entries, 0, pageSize, interaction.guild.name);
    const row = createLeaderboardRow(sessionId, 0, totalPages);
    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // /censored
  if (interaction.commandName === "censored") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return interaction.reply({ content: "❌ Mods only.", ephemeral: true });
    const sub = interaction.options.getSubcommand();
    let censored = await db.get(CENSOR_KEY) || [];

    if (sub === "add") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
      const word = interaction.options.getString("word");
      const action = interaction.options.getString("action");
      const durationInput = interaction.options.getInteger("duration");
      const duration = durationInput ? durationInput * 60000 : null;
      censored.push({ word, action, duration: action === "mute" ? duration : null });
      await db.set(CENSOR_KEY, censored);
      return interaction.reply(`✅ Added "${word}" → ${action}`);
    }
    if (sub === "remove") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
      const word = interaction.options.getString("word");
      censored = censored.filter(w => w.word !== word);
      await db.set(CENSOR_KEY, censored);
      return interaction.reply(`🗑 Removed "${word}"`);
    }
    if (sub === "list") {
      if (!censored.length) return interaction.reply("No censored words set.");
      const list = censored.map(w => `• ${w.word} → ${w.action}`).join("\n");
      return interaction.reply({ content: `🚫 Censored Words:\n\n${list}`, ephemeral: true });
    }
  }
});

// =====================
// LOGIN
// =====================
client.login(process.env.TOKEN)
  .then(() => console.log("✅ Login successful"))
  .catch(err => console.error("❌ Login failed:", err));

process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);