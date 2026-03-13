/**
 * PrimeLooks Bot Configuration
 * Edit these values to customize channel names, roles, and behavior.
 */

module.exports = {
  // Command prefix for text commands
  PREFIX: '!',

  // Database key prefixes
  CENSOR_KEY: 'censored_words',
  AUTO_MOD_WARN_PREFIX: 'auto_mod_warn',
  JOIN_LEAVE_STATS_PREFIX: 'join_leave_stats',
  SKULL_BOARD_KEY: 'skullboard_posted',
  VOTE_BATTLE_PREFIX: 'vote_battle',
  MOD_CASES_PREFIX: 'mod_cases',

  // Auto moderation escalation - Discord username to ping when warn count >= 4
  ESCALATION_ALERT_USERNAME: 'returningchad',

  // Anti-spam
  SPAM_LIMIT: 5,
  SPAM_TIME: 5000,        // ms
  SPAM_MUTE: 10 * 60 * 1000,  // 10 min

  // XP & Levels
  XP_PER_MESSAGE: 10,
  COOLDOWN: 5000,
  LEVEL_ROLES: [
    { level: 5, role: 'Level 5' }, { level: 10, role: 'Level 10' }, { level: 20, role: 'Level 20' },
    { level: 30, role: 'Level 30' }, { level: 40, role: 'Level 40' }, { level: 50, role: 'Level 50' },
    { level: 60, role: 'Level 60' }, { level: 70, role: 'Level 70' }, { level: 80, role: 'Level 80' },
    { level: 90, role: 'Level 90' }, { level: 100, role: 'Level 100' }
  ],

  // Role protection - roles that can only be assigned by allowed managers
  PROTECTED_ROLES: ['actarius', 'senator', 'consul'],
  ALLOWED_ROLE_MANAGERS: ['centurio', 'censor', 'senator'],

  // Skullboard
  SKULL_EMOJI: '💀',
  SKULL_THRESHOLD: 5,
  SKULL_CHANNEL_NAME: 'skullboard',

  // Pic perms - role granted at level 1, exempt role never gets it
  PIC_PERMS_ROLE: '𝑷𝒍𝒆𝒃𝒆𝒊𝒖𝒔',
  PIC_PERMS_EXEMPT: '𝑺𝒆𝒓𝒗𝒖𝒔',

  // Channel names (bot finds channels by name)
  CHANNELS: {
    MODERATION_LOGS: 'moderation-logs',
    BAN_LEAVE_LOGS: 'ban-leave-logs',
    WELCOME: 'welcome',
    SKULLBOARD: 'skullboard',
    LEVEL: 'level',
    ROLES: 'role',
    MOG_BATTLE: 'mogbattle',
    FOG_BATTLE: 'fogbattle',
  },

  // Level card background (fallback if file missing)
  LEVEL_CARD_BG: './pl-bg.png',

  // Role categories for self-assign
  ROLE_CATEGORIES: [
    {
      title: 'How old are you? 🎂',
      description: 'Pick the role that matches your age.',
      color: 0xD3D3D3,
      roles: [
        { label: '13-15', emoji: '🟡', roleName: '13-15' },
        { label: '16-17', emoji: '🟠', roleName: '16-17' },
        { label: '18+', emoji: '🔴', roleName: '18+' }
      ]
    },
    {
      title: 'What is your purpose of stay? 😤',
      description: 'Pick what you\'re here for.',
      color: 0xD3D3D3,
      roles: [
        { label: 'Health', emoji: '❤️', roleName: 'Health' },
        { label: 'Improvement', emoji: '📈', roleName: 'Improvement' },
        { label: 'Fashion', emoji: '👕', roleName: 'Fashion' },
        { label: 'Gym', emoji: '🏋️', roleName: 'Gym' },
        { label: 'Socialization', emoji: '🧑', roleName: 'Socialization' }
      ]
    }
  ],

  // Dashboard (Express)
  DASHBOARD_PORT: process.env.DASHBOARD_PORT || 3000,
  DASHBOARD_SECRET: process.env.DASHBOARD_SECRET || 'change-me-in-production',
};
