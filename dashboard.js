// =====================
// PRIMELOOKS DASHBOARD SERVER
// =====================
// Run separately from your bot: node dashboard.js
// Make sure this file is in the SAME folder as index.js
// Add to your .env: CLIENT_ID, CLIENT_SECRET, DASHBOARD_SECRET, DASHBOARD_PORT (optional)

const express     = require('express');
const session     = require('express-session');
const axios       = require('axios');
const path        = require('path');
const { spawn }   = require('child_process');
require('dotenv').config();
const { QuickDB } = require('quick.db');
const db          = new QuickDB();
app.use(session({
  secret: process.env.DASHBOARD_SECRET || 'primelooks-dashboard-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: true,
    sameSite: 'none'
  }
}));
// ── Start the bot as a child process ─────────────────────────────
function startBot() {
  console.log('🤖 Starting bot (index.js)...');
  const bot = spawn('node', ['index.js'], {
    stdio: 'inherit',
    env: process.env
  });
  bot.on('exit', (code) => {
    console.log(`⚠️ Bot exited (${code})`);
  });
}
startBot();

const app  = express();
const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3001;

// ── Discord OAuth2 ───────────────────────────────────────────────
const CLIENT_ID      = process.env.CLIENT_ID;      // your bot's application ID
const CLIENT_SECRET  = process.env.CLIENT_SECRET;  // from Discord Developer Portal
const REDIRECT_URI   = `https://prime-ed59.onrender.com/auth/callback`;
const DISCORD_API    = 'https://discord.com/api/v10';

// ── DB keys (must match index.js) ────────────────────────────────
const AUTO_MOD_WARN_PREFIX  = 'auto_mod_warn';
const JOIN_LEAVE_STATS_PREFIX = 'join_leave_stats';

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json());
// Force no caching so Render always serves fresh files
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.set('trust proxy', 1);
app.use(session({
  secret: process.env.DASHBOARD_SECRET || 'primelooks-dashboard-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: true,
    sameSite: 'none'
  }
}));

// ── Auth guard middleware ────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── OAuth2 login ─────────────────────────────────────────────────
app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'identify guilds'
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    // Exchange code for token
    const tokenRes = await axios.post(`${DISCORD_API}/oauth2/token`,
      new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenRes.data;

    // Get user info
    const userRes = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    // Get their guilds
    const guildsRes = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    req.session.user         = userRes.data;
    req.session.access_token = access_token;
    req.session.guilds       = guildsRes.data;

    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
      res.redirect('/dashboard.html');
    });
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/?error=oauth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── /api/me ──────────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user, guilds: req.session.guilds || [] });
});

// ══════════════════════════════════════════════════════════════════
// CENSORED WORDS
// ══════════════════════════════════════════════════════════════════
const CENSOR_KEY = (guildId) => `censored_words_${guildId}`;

app.get('/api/censored', requireAuth, async (req, res) => {
  const guildId = req.query.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  const words = await db.get(CENSOR_KEY(guildId)) || [];
  res.json(words);
});

app.post('/api/censored/add', requireAuth, async (req, res) => {
  const { word, action, duration, guildId } = req.body;
  if (!word || !action || !guildId) return res.status(400).json({ error: 'word, action and guildId required' });
  const words = await db.get(CENSOR_KEY(guildId)) || [];
  if (words.find(w => w.word.toLowerCase() === word.toLowerCase())) {
    return res.status(409).json({ error: 'Word already exists' });
  }
  words.push({ word, action, duration: action === 'mute' ? (duration * 60000 || null) : null });
  await db.set(CENSOR_KEY(guildId), words);
  res.json({ success: true, words });
});

app.post('/api/censored/remove', requireAuth, async (req, res) => {
  const { word, guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  let words = await db.get(CENSOR_KEY(guildId)) || [];
  words = words.filter(w => w.word.toLowerCase() !== word.toLowerCase());
  await db.set(CENSOR_KEY(guildId), words);
  res.json({ success: true, words });
});

// ══════════════════════════════════════════════════════════════════
// BOT SETTINGS (skull threshold, pic perms roles, etc.)
// ══════════════════════════════════════════════════════════════════
const SETTINGS_KEY = (guildId) => `dashboard_settings_${guildId}`;

const DEFAULT_SETTINGS = {
  skullThreshold:  5,
  picPermsRole:    '',
  picPermsExempt:  '',
  xpPerMessage:    10,
  cooldownMs:      5000,
  spamLimit:       5,
  escalationUser:  'returningchad'
};

app.get('/api/settings', requireAuth, async (req, res) => {
  const guildId = req.query.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  const saved = await db.get(SETTINGS_KEY(guildId)) || {};
  res.json({ ...DEFAULT_SETTINGS, ...saved });
});

app.post('/api/settings', requireAuth, async (req, res) => {
  const guildId = req.query.guildId || req.body.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  const current = await db.get(SETTINGS_KEY(guildId)) || {};
  const updated = { ...current, ...req.body };
  delete updated.guildId;
  await db.set(SETTINGS_KEY(guildId), updated);
  res.json({ success: true, settings: updated });
});

// ══════════════════════════════════════════════════════════════════
// LEADERBOARD
// ══════════════════════════════════════════════════════════════════
app.get('/api/leaderboard', requireAuth, async (req, res) => {
  const guildId = req.query.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });

  const all = await db.all();
  const entries = all
    .filter(d => d.id.startsWith(`xp_${guildId}_`))
    .sort((a, b) => b.value - a.value)
    .slice(0, 50)
    .map((d, i) => ({
      rank:   i + 1,
      userId: d.id.split('_')[2],
      xp:     d.value,
      level:  Math.floor(0.1 * Math.sqrt(d.value))
    }));

  res.json(entries);
});

// ══════════════════════════════════════════════════════════════════
// JOIN/LEAVE STATS
// ══════════════════════════════════════════════════════════════════
app.get('/api/stats', requireAuth, async (req, res) => {
  const guildId = req.query.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });

  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    const key = `${JOIN_LEAVE_STATS_PREFIX}_${guildId}_${dateKey}`;
    const data = await db.get(key) || { joins: 0, leaves: 0 };
    rows.push({ date: dateKey, joins: data.joins || 0, leaves: data.leaves || 0 });
  }
  res.json(rows);
});

// ══════════════════════════════════════════════════════════════════
// CHANNELS — fetch text channels from Discord API
// ══════════════════════════════════════════════════════════════════
app.get('/api/channels', requireAuth, async (req, res) => {
  const guildId = req.query.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    const r = await axios.get(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${process.env.TOKEN}` }
    });
    const channels = r.data
      .filter(c => c.type === 0) // text channels only
      .sort((a, b) => a.position - b.position)
      .map(c => ({ id: c.id, name: c.name, parent_id: c.parent_id }));
    res.json(channels);
  } catch (err) {
    console.error('channels fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// ══════════════════════════════════════════════════════════════════
// ROLES — fetch from Discord API using bot token
// ══════════════════════════════════════════════════════════════════
app.get('/api/roles', requireAuth, async (req, res) => {
  const guildId = req.query.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    const r = await axios.get(`${DISCORD_API}/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${process.env.TOKEN}` }
    });
    const roles = r.data
      .filter(role => role.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(role => ({
        id:       role.id,
        name:     role.name,
        color:    role.color ? `#${role.color.toString(16).padStart(6, '0')}` : null,
        position: role.position
      }));
    res.json(roles);
  } catch (err) {
    console.error('roles fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// ══════════════════════════════════════════════════════════════════
// AUTOMOD ROLE SETTINGS
// ══════════════════════════════════════════════════════════════════
app.get('/api/automod-roles', requireAuth, async (req, res) => {
  const guildId = req.query.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  const data = await db.get(`automod_roles_${guildId}`) || {};
  res.json(data);
});

app.post('/api/automod-roles', requireAuth, async (req, res) => {
  const { guildId, module, roles } = req.body;
  if (!guildId || !module) return res.status(400).json({ error: 'guildId and module required' });
  const key = `automod_roles_${guildId}`;
  const current = await db.get(key) || {};
  current[module] = roles || [];
  await db.set(key, current);
  res.json({ success: true, data: current });
});

// ══════════════════════════════════════════════════════════════════
// WARNINGS
// ══════════════════════════════════════════════════════════════════
app.get('/api/warnings', requireAuth, async (req, res) => {
  const guildId = req.query.guildId;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });

  const all = await db.all();
  const entries = all
    .filter(d => d.id.startsWith(`${AUTO_MOD_WARN_PREFIX}_${guildId}_`) && d.value > 0)
    .map(d => ({
      userId:   d.id.split('_').slice(3).join('_'),
      warnings: d.value
    }))
    .sort((a, b) => b.warnings - a.warnings);

  res.json(entries);
});

app.post('/api/warnings/clear', requireAuth, async (req, res) => {
  const { guildId, userId } = req.body;
  if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required' });
  await db.set(`${AUTO_MOD_WARN_PREFIX}_${guildId}_${userId}`, 0);
  res.json({ success: true });
});

// Catch-all → serve index.html
app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🖥️  PrimeLooks Dashboard running at http://localhost:${PORT}`);
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('⚠️  CLIENT_ID or CLIENT_SECRET missing from .env — OAuth login will not work');
  }
});

