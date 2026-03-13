// PrimeLooks Dashboard - Client
const API_BASE = '';

let currentGuildId = null;
let apiKey = localStorage.getItem('dashboard_key') || '';
let modSubPage = null;

function setStatus(online) {
  const el = document.getElementById('statusIndicator');
  if (!el) return;
  el.className = 'status-indicator ' + (online ? 'online' : 'offline');
  const span = el.querySelector('span:last-child');
  if (span) span.textContent = online ? 'Online' : 'Offline';
}

async function api(path, options = {}) {
  const url = API_BASE + path + (apiKey ? (path.includes('?') ? '&' : '?') + `key=${encodeURIComponent(apiKey)}` : '');
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

function showPage(page, subPage) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (nav) nav.classList.add('active');
  const titles = { overview: 'Overview', features: 'Features', moderation: 'Moderation', xp: 'XP & Leaderboard', settings: 'Settings' };
  document.getElementById('pageTitle').textContent = subPage ? `${titles[page]} / ${subPage}` : titles[page];
  document.getElementById('loading').style.display = 'none';
  document.getElementById('pageContent').style.display = 'block';
  document.getElementById('pageContent').innerHTML = '';
  return document.getElementById('pageContent');
}

function escapeHtml(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// ===================== MODERATION PAGE =====================

const MOD_FEATURES = [
  { id: 'cases', icon: '&#128203;', title: 'Cases', desc: 'Manage all ban, kick, mute and warn cases.', action: 'View cases' },
  { id: 'userreports', icon: '&#128226;', title: 'User reports', desc: "Update this server's user report config.", action: 'Set up' },
  { id: 'appeals', icon: '&#128221;', title: 'Appeals', desc: 'Create custom forms for users to appeal punishments.', action: 'Configure', badge: 'NEW' },
  { id: 'messagehistories', icon: '&#128172;', title: 'Message Histories', desc: 'View and share generated message histories of users.', action: 'View' },
  { id: 'punishsettings', icon: '&#9881;', title: 'Punish settings', desc: 'Edit ban, kick, mute and warn actions, default values and more.', action: 'Configure' },
  { id: 'censored', icon: '&#128683;', title: 'Censored Words', desc: 'Auto-moderate messages containing specific words.', action: 'Manage' },
  { id: 'immuneroles', icon: '&#128737;', title: 'Immune roles', desc: 'Set roles that are immune to moderation actions.', action: 'Configure' },
  { id: 'usernotifications', icon: '&#128276;', title: 'User notifications', desc: 'Toggle direct messages on punishments.', action: 'Configure' },
  { id: 'predefinedreasons', icon: '&#128204;', title: 'Predefined reasons', desc: 'Define reason aliases for punishments.', action: 'Configure' },
  { id: 'channellocking', icon: '&#128274;', title: 'Channel locking', desc: 'Lock channels to prevent sending messages or joining voice.', action: 'Configure' },
  { id: 'privacy', icon: '&#128065;', title: 'Privacy', desc: 'Decide what case information is shown to users.', action: 'Configure' },
];

const FEATURE_SECTIONS = [
  {
    title: 'For Members',
    desc: 'Everyday commands and interactions most users will touch.',
    items: [
      { icon: '&#11088;', title: 'Leveling & XP', desc: 'Earn XP by chatting. Check your level or rank anytime.', tags: ['/level', '/leaderboardlevel', '!leaderboard'] },
      { icon: '&#128247;', title: 'Avatar Viewer', desc: 'Grab any member avatar in full size.', tags: ['!avatar', '!av'] },
      { icon: '&#128248;', title: 'Pic and Gif Unlocks', desc: 'Pic perms unlock automatically after you level up.', tags: ['Level 1+'] },
      { icon: '&#128221;', title: 'Role Selector', desc: 'Pick age and purpose roles from the buttons in the roles channel.', tags: ['Role buttons'] }
    ]
  },
  {
    title: 'Community & Events',
    desc: 'Fun social features that keep the server active.',
    items: [
      { icon: '&#128128;', title: 'Skullboard', desc: 'Messages with 5 skulls get featured in #skullboard.', tags: ['React with &#128128;'] },
      { icon: '&#128081;', title: 'Mog Battles', desc: 'Optional photo battles with voting reactions.', tags: ['!mog @user + image', '/mogbattle'] }
    ]
  },
  {
    title: 'Safety & Logs',
    desc: 'Built-in protections and logging visible to the staff team.',
    items: [
      { icon: '&#128161;', title: 'Auto-Mod', desc: 'Censored words, spam control, and escalating timeouts.', tags: ['Auto warn/mute'] },
      { icon: '&#128221;', title: 'Message & Media Logs', desc: 'Edits, deletions, and deleted media are logged.', tags: ['moderation-logs'] },
      { icon: '&#128101;', title: 'Join/Leave Tracking', desc: 'Welcome messages and weekly join/leave stats.', tags: ['!chart'] }
    ]
  },
  {
    title: 'Moderation Tools',
    desc: 'Staff-only commands and controls.',
    items: [
      { icon: '&#128296;', title: 'Core Mod Actions', desc: 'Kick, ban, mute, unmute, purge, and unban.', tags: ['!kick', '!ban', '!mute', '!unmute', '!purge', '!unban'] },
      { icon: '&#9881;', title: 'Warnings & Censored List', desc: 'Check warnings and manage censored words.', tags: ['!warnings', '!clearwarnings', '/censored'] },
      { icon: '&#128200;', title: 'XP Admin Tools', desc: 'Grant or remove XP for members.', tags: ['/givexp', '/takexp'] }
    ]
  }
];

async function loadModeration(sub) {
  const content = showPage('moderation', sub || null);
  modSubPage = sub;

  if (!currentGuildId) {
    content.innerHTML = '<div class="empty-state"><p>Select a server first (Overview page)</p></div>';
    return;
  }

  if (sub) {
    await loadModSubPage(content, sub);
    return;
  }

  content.innerHTML = `
    <div class="mod-grid">
      ${MOD_FEATURES.map(f => `
        <div class="mod-card" data-mod="${f.id}">
          <div class="mod-card-icon">${f.icon}</div>
          <div class="mod-card-body">
            <div class="mod-card-title">${escapeHtml(f.title)}${f.badge ? ' <span class="tag-badge" style="font-size:0.7rem;margin-left:0.25rem">' + f.badge + '</span>' : ''}</div>
            <div class="mod-card-desc">${escapeHtml(f.desc)}</div>
            <div class="mod-card-action">${escapeHtml(f.action)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  content.querySelectorAll('.mod-card').forEach(card => {
    card.addEventListener('click', () => loadModeration(card.dataset.mod));
  });
}

async function loadModSubPage(content, sub) {
  content.innerHTML = `<a href="#" class="back-btn" data-back><- Back to Moderation</a>`;
  content.querySelector('[data-back]').addEventListener('click', (e) => { e.preventDefault(); loadModeration(); });

  try {
    if (sub === 'cases') await renderCases(content);
    else if (sub === 'censored') await renderCensored(content);
    else if (sub === 'immuneroles') await renderImmuneRoles(content);
    else if (sub === 'predefinedreasons') await renderPredefinedReasons(content);
    else if (sub === 'usernotifications') await renderUserNotifications(content);
    else if (sub === 'punishsettings') await renderPunishSettings(content);
    else if (sub === 'privacy') await renderPrivacy(content);
    else await renderPlaceholder(content, sub);
  } catch (e) {
    content.innerHTML += `<div class="empty-state"><p>Error: ${escapeHtml(e.message)}</p></div>`;
  }
}

async function renderCases(content) {
  const cases = await api(`/api/guild/${currentGuildId}/moderation/cases`);
  const rows = cases.slice(0, 100).map(c => `
    <tr>
      <td><span class="case-type ${c.type}">${escapeHtml(c.type)}</span></td>
      <td>#${c.id}</td>
      <td>${escapeHtml(c.userTag || c.userId)}</td>
      <td>${escapeHtml(c.modTag || c.modId)}</td>
      <td>${escapeHtml((c.reason || '-').slice(0, 50))}</td>
      <td>${c.duration ? c.duration + 'm' : '-'}</td>
      <td>${new Date(c.createdAt).toLocaleDateString()}</td>
    </tr>
  `).join('');

  content.innerHTML += `
    <div class="card">
      <div class="card-title">Moderation Cases</div>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">${cases.length} total cases</p>
      <div style="overflow-x: auto;">
        <table class="leaderboard-table">
          <thead><tr><th>Type</th><th>Case #</th><th>User</th><th>Moderator</th><th>Reason</th><th>Duration</th><th>Date</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No cases yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderCensored(content) {
  const censored = await api(`/api/guild/${currentGuildId}/censored`);
  content.innerHTML += `
    <div class="card">
      <div class="card-title">Censored Words</div>
      ${censored.length ? `
        <ul class="censored-list">
          ${censored.map(w => `
            <li class="censored-item">
              <span class="censored-word">${escapeHtml(w.word)}</span>
              <span class="censored-action">${escapeHtml(w.action)}</span>
              <button class="btn btn-danger btn-sm btn-remove" data-word="${escapeHtml(w.word)}">Remove</button>
            </li>
          `).join('')}
        </ul>
      ` : '<p class="empty-state">No censored words. Add one below.</p>'}
      <div style="margin-top: 1.5rem;">
        <form id="addCensoredForm" class="form-row">
          <div class="form-group">
            <label>Word</label>
            <input type="text" name="word" placeholder="word" required>
          </div>
          <div class="form-group">
            <label>Action</label>
            <select name="action">
              <option value="warn">Warn</option>
              <option value="mute">Mute</option>
            </select>
          </div>
          <div class="form-group">
            <button type="submit" class="btn btn-primary">Add</button>
          </div>
        </form>
      </div>
    </div>
  `;
  content.querySelector('#addCensoredForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/guild/${currentGuildId}/censored/add`, { method: 'POST', body: JSON.stringify({ word: fd.get('word'), action: fd.get('action') }) });
    loadModeration('censored');
  });
  content.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/guild/${currentGuildId}/censored/remove`, { method: 'POST', body: JSON.stringify({ word: btn.dataset.word }) });
      loadModeration('censored');
    });
  });
}

async function renderImmuneRoles(content) {
  const [config, roles] = await Promise.all([
    api(`/api/guild/${currentGuildId}/moderation/config`),
    api(`/api/guild/${currentGuildId}/roles`),
  ]);
  const immune = config.immuneRoles || [];

  content.innerHTML += `
    <div class="card">
      <div class="card-title">Immune Roles</div>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">Users with these roles cannot be moderated.</p>
      <div id="immuneTags">${immune.map(rId => {
        const r = roles.find(x => x.id === rId);
        return `<span class="tag-badge">${escapeHtml(r?.name || rId)} <span class="tag-remove" data-id="${rId}">x</span></span>`;
      }).join('')}</div>
      <div class="form-row" style="margin-top: 1rem;">
        <div class="form-group">
          <label>Add role</label>
          <select id="immuneSelect">
            <option value="">Select a role...</option>
            ${roles.filter(r => !immune.includes(r.id)).map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="addImmune">Add</button>
      </div>
    </div>
  `;

  const saveImmune = async (list) => {
    await api(`/api/guild/${currentGuildId}/moderation/config`, { method: 'PUT', body: JSON.stringify({ immuneRoles: list }) });
    loadModeration('immuneroles');
  };

  content.querySelector('#addImmune').addEventListener('click', () => {
    const sel = content.querySelector('#immuneSelect');
    if (!sel.value) return;
    saveImmune([...immune, sel.value]);
  });
  content.querySelectorAll('.tag-remove').forEach(el => {
    el.addEventListener('click', () => saveImmune(immune.filter(id => id !== el.dataset.id)));
  });
}

async function renderPredefinedReasons(content) {
  const config = await api(`/api/guild/${currentGuildId}/moderation/config`);
  const reasons = config.predefinedReasons || [];

  content.innerHTML += `
    <div class="card">
      <div class="card-title">Predefined Reasons</div>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">Quick reason aliases for punishments (e.g. "spam" -> "Repeated spam messages").</p>
      <div id="reasonList">${reasons.map((r, i) => `
        <div class="censored-item">
          <span><strong>${escapeHtml(r.alias || r)}</strong> -> ${escapeHtml(r.reason || r)}</span>
          <button class="btn btn-danger btn-sm btn-remove-reason" data-i="${i}">Remove</button>
        </div>
      `).join('') || '<p class="empty-state">No predefined reasons</p>'}</div>
      <form id="addReasonForm" class="form-row" style="margin-top: 1rem;">
        <div class="form-group">
          <label>Alias</label>
          <input type="text" name="alias" placeholder="e.g. spam" required>
        </div>
        <div class="form-group">
          <label>Reason</label>
          <input type="text" name="reason" placeholder="e.g. Repeated spam messages" required>
        </div>
        <button type="submit" class="btn btn-primary">Add</button>
      </form>
    </div>
  `;

  content.querySelector('#addReasonForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const newR = { alias: fd.get('alias'), reason: fd.get('reason') };
    await api(`/api/guild/${currentGuildId}/moderation/config`, { method: 'PUT', body: JSON.stringify({ predefinedReasons: [...reasons, newR] }) });
    loadModeration('predefinedreasons');
  });
  content.querySelectorAll('.btn-remove-reason').forEach(btn => {
    btn.addEventListener('click', async () => {
      const next = reasons.filter((_, i) => i !== parseInt(btn.dataset.i, 10));
      await api(`/api/guild/${currentGuildId}/moderation/config`, { method: 'PUT', body: JSON.stringify({ predefinedReasons: next }) });
      loadModeration('predefinedreasons');
    });
  });
}

async function renderUserNotifications(content) {
  const config = await api(`/api/guild/${currentGuildId}/moderation/config`);
  const dm = config.dmOnPunish !== false;

  content.innerHTML += `
    <div class="card">
      <div class="card-title">User Notifications</div>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">Send a DM to users when they are punished (ban, kick, mute, warn).</p>
      <div class="toggle" id="dmToggle">
        <div class="toggle-switch ${dm ? 'on' : ''}"></div>
        <span>Send DM on punishment</span>
      </div>
    </div>
  `;

  content.querySelector('#dmToggle').addEventListener('click', async () => {
    const next = !dm;
    await api(`/api/guild/${currentGuildId}/moderation/config`, { method: 'PUT', body: JSON.stringify({ dmOnPunish: next }) });
    content.querySelector('.toggle-switch').classList.toggle('on', next);
  });
}

async function renderPunishSettings(content) {
  const config = await api(`/api/guild/${currentGuildId}/moderation/config`);
  const ps = config.punishSettings || {};
  const ban = ps.ban || {};
  const kick = ps.kick || {};
  const mute = ps.mute || {};
  const warn = ps.warn || {};

  const toggleRow = (id, label, value, tooltip) => `
    <div class="punish-toggle-row">
      <div class="toggle" data-ps-key="${id}">
        <div class="toggle-switch ${value ? 'on' : ''}"></div>
        <span>${escapeHtml(label)}</span>
        ${tooltip ? `<span class="tooltip-icon" title="${escapeHtml(tooltip)}">?</span>` : ''}
      </div>
    </div>
  `;

  content.innerHTML += `
    <div class="card">
      <div class="card-title">Punish Settings</div>
      <p style="color: var(--text-muted); margin-bottom: 1.5rem;">Configure default behavior for ban, kick, mute, and warn actions.</p>

      <div class="punish-section">
        <h4 class="punish-section-title">Ban</h4>
        <p class="punish-section-desc">Default reason and duration, actions and more</p>
        <div class="form-group">
          <label>Default reason</label>
          <input type="text" id="ps-ban-reason" placeholder="e.g. Violation of rules" value="${escapeHtml(ban.defaultReason || '')}" maxlength="200">
        </div>
      </div>

      <div class="punish-section">
        <h4 class="punish-section-title">Kick</h4>
        <p class="punish-section-desc">Default reason, actions and more</p>
        <div class="form-group">
          <label>Default reason</label>
          <input type="text" id="ps-kick-reason" placeholder="e.g. Temporary removal" value="${escapeHtml(kick.defaultReason || '')}" maxlength="200">
        </div>
      </div>

      <div class="punish-section">
        <h4 class="punish-section-title">Mute</h4>
        <p class="punish-section-desc">Default reason and duration, actions, link with timeouts and more</p>
        <div class="form-row">
          <div class="form-group">
            <label>Default reason</label>
            <input type="text" id="ps-mute-reason" placeholder="e.g. Disruption" value="${escapeHtml(mute.defaultReason || '')}" maxlength="200">
          </div>
          <div class="form-group">
            <label>Default duration</label>
            <input type="text" id="ps-mute-duration" placeholder="e.g. 10m, 1h" value="${escapeHtml(mute.defaultDuration || '10m')}">
          </div>
        </div>
        ${toggleRow('mute_linkWithTimeouts', 'Link mute with Discord timeouts', mute.linkWithTimeouts !== false, 'Use Discord\'s native timeout feature for mutes')}
      </div>

      <div class="punish-section">
        <h4 class="punish-section-title">Warn</h4>
        <p class="punish-section-desc">Default reason and duration, actions and more</p>
        <div class="form-group">
          <label>Default reason</label>
          <input type="text" id="ps-warn-reason" placeholder="e.g. First warning" value="${escapeHtml(warn.defaultReason || '')}" maxlength="200">
        </div>
      </div>

      <div class="punish-section">
        <h4 class="punish-section-title">General</h4>
        ${toggleRow('replyToMessageToPunish', 'Reply to message to punish', ps.replyToMessageToPunish, 'Reply to the offending message when punishing')}
        ${toggleRow('confirmWhenRecentCaseExists', 'Confirm punishment when recent case exists', ps.confirmWhenRecentCaseExists, 'Ask for confirmation before punishing if the user has a recent case')}
        <div class="form-group" style="margin-top: 1rem; margin-left: 52px;">
          <label>Confirm when created within the last (minutes)</label>
          <input type="number" id="ps-confirmWithinMinutes" min="1" max="60" value="${ps.confirmWhenCreatedWithinMinutes ?? 5}">
        </div>
        ${toggleRow('logExpiredPunishmentsIfNotInGuild', 'Log expired punishments if user is not in guild', ps.logExpiredPunishmentsIfNotInGuild, 'Log when a mute expires even if the user has left the server')}
        ${toggleRow('cacheDeletedMessages', 'Cache deleted messages', ps.cacheDeletedMessages, 'Store deleted messages for moderation context')}
      </div>

      <div style="margin-top: 1.5rem;">
        <button class="btn btn-primary" id="ps-save">Save Punish Settings</button>
      </div>
    </div>
  `;

  content.querySelectorAll('.punish-toggle-row .toggle').forEach(tog => {
    tog.addEventListener('click', () => tog.querySelector('.toggle-switch').classList.toggle('on'));
  });

  content.querySelector('#ps-save').addEventListener('click', async () => {
    const toggleVal = (key) => content.querySelector(`[data-ps-key="${key}"]`)?.querySelector('.toggle-switch')?.classList.contains('on') ?? false;

    const next = {
      ban: { defaultReason: content.querySelector('#ps-ban-reason')?.value || '' },
      kick: { defaultReason: content.querySelector('#ps-kick-reason')?.value || '' },
      mute: {
        defaultReason: content.querySelector('#ps-mute-reason')?.value || '',
        defaultDuration: content.querySelector('#ps-mute-duration')?.value || '10m',
        linkWithTimeouts: toggleVal('mute_linkWithTimeouts'),
      },
      warn: { defaultReason: content.querySelector('#ps-warn-reason')?.value || '' },
      replyToMessageToPunish: toggleVal('replyToMessageToPunish'),
      confirmWhenRecentCaseExists: toggleVal('confirmWhenRecentCaseExists'),
      confirmWhenCreatedWithinMinutes: Math.min(60, Math.max(1, parseInt(content.querySelector('#ps-confirmWithinMinutes')?.value || '5', 10))) || 5,
      logExpiredPunishmentsIfNotInGuild: toggleVal('logExpiredPunishmentsIfNotInGuild'),
      cacheDeletedMessages: toggleVal('cacheDeletedMessages'),
    };
    await api(`/api/guild/${currentGuildId}/moderation/config`, { method: 'PUT', body: JSON.stringify({ punishSettings: next }) });
    loadModeration('punishsettings');
  });
}

async function renderPrivacy(content) {
  const config = await api(`/api/guild/${currentGuildId}/moderation/config`);
  const priv = config.privacy || {};
  const showMod = priv.showModToUser !== false;

  content.innerHTML += `
    <div class="card">
      <div class="card-title">Privacy</div>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">Control what case information is shown to punished users.</p>
      <div class="toggle" id="showModToggle">
        <div class="toggle-switch ${showMod ? 'on' : ''}"></div>
        <span>Show moderator name to punished user</span>
      </div>
    </div>
  `;

  content.querySelector('#showModToggle').addEventListener('click', async () => {
    const next = !showMod;
    await api(`/api/guild/${currentGuildId}/moderation/config`, { method: 'PUT', body: JSON.stringify({ privacy: { ...priv, showModToUser: next } }) });
    content.querySelector('.toggle-switch').classList.toggle('on', next);
  });
}

async function renderPlaceholder(content, sub) {
  const title = MOD_FEATURES.find(f => f.id === sub)?.title || sub;
  content.innerHTML += `
    <div class="card">
      <div class="card-title">${escapeHtml(title)}</div>
      <p style="color: var(--text-muted);">This section is coming soon. Configuration will be available in a future update.</p>
    </div>
  `;
}

function loadFeatures() {
  const content = showPage('features');
  if (!currentGuildId) {
    content.innerHTML = '<div class="empty-state"><p>Select a server first (Overview page)</p></div>';
    return;
  }

  content.innerHTML = `
    <div class="card">
      <div class="card-title">Member-Facing Features</div>
      <p style="color: var(--text-muted);">This view focuses on what your average user actually uses day to day, plus optional community extras.</p>
    </div>
    ${FEATURE_SECTIONS.map(section => `
      <section class="feature-section">
        <div class="feature-section-head">
          <h3>${escapeHtml(section.title)}</h3>
          <p>${escapeHtml(section.desc)}</p>
        </div>
        <div class="feature-grid">
          ${section.items.map(item => `
            <div class="feature-card">
              <div class="feature-icon">${item.icon}</div>
              <div class="feature-body">
                <div class="feature-title">${escapeHtml(item.title)}</div>
                <div class="feature-desc">${escapeHtml(item.desc)}</div>
                <div class="feature-tags">
                  ${item.tags.map(tag => `<span class="tag-badge">${tag}</span>`).join('')}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `).join('')}
  `;
}
// ===================== OVERVIEW =====================

async function loadOverview() {
  const content = showPage('overview');
  try {
    const status = await api('/api/status');
    setStatus(status.online);
    const guilds = await api('/api/guilds');
    const guildSelect = document.getElementById('guildSelect');
    guildSelect.innerHTML = '<option value="">Select server...</option>';
    guilds.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      guildSelect.appendChild(opt);
    });
    if (guilds.length === 1) {
      guildSelect.value = guilds[0].id;
      currentGuildId = guilds[0].id;
    }
    content.innerHTML = `
      <div class="card">
        <div class="card-title">Bot Status</div>
        <div class="card-grid">
          <div class="stat-box">
            <div class="stat-value">${status.online ? 'Online' : 'Offline'}</div>
            <div class="stat-label">Status</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${status.guildCount || 0}</div>
            <div class="stat-label">Servers</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${status.botUser || '-'}</div>
            <div class="stat-label">Bot</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Quick Actions</div>
        <p style="color: var(--text-muted);">Select a server above, then go to Moderation to manage cases, censored words, immune roles, and more.</p>
      </div>
    `;
  } catch (e) {
    setStatus(false);
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">!</div><p>Could not connect. Is the bot running?${e.message ? '<br><small>' + escapeHtml(e.message) + '</small>' : ''}</p></div>`;
  }
}

// ===================== XP =====================

async function loadXP() {
  const content = showPage('xp');
  if (!currentGuildId) {
    content.innerHTML = '<div class="empty-state"><p>Select a server first (Overview page)</p></div>';
    return;
  }
  try {
    const stats = await api(`/api/guild/${currentGuildId}/stats`);
    const rows = stats.topUsers.map(u => `<tr><td>#${u.rank}</td><td>${u.userId}</td><td>${u.level}</td><td>${u.xp}</td></tr>`).join('');
    const joinData = stats.joinLeaveWeek;
    const maxVal = Math.max(5, ...joinData.map(d => Math.max(d.joins, d.leaves)));
    content.innerHTML = `
      <div class="card">
        <div class="card-title">Server Stats</div>
        <div class="card-grid">
          <div class="stat-box"><div class="stat-value">${stats.memberCount}</div><div class="stat-label">Members</div></div>
          <div class="stat-box"><div class="stat-value">${stats.totalUsersWithXP}</div><div class="stat-label">Users with XP</div></div>
          <div class="stat-box"><div class="stat-value">${stats.totalXP.toLocaleString()}</div><div class="stat-label">Total XP</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Top 10 Leaderboard</div>
        <table class="leaderboard-table">
          <thead><tr><th>Rank</th><th>User ID</th><th>Level</th><th>XP</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No data yet</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-title">Joins vs Leaves (Last 7 Days)</div>
        <div class="chart-placeholder">
          ${joinData.map((d, i) => {
            const jH = (d.joins / maxVal) * 150;
            const lH = (d.leaves / maxVal) * 150;
            return `<div style="display:inline-block;margin:0 4px;vertical-align:bottom;">
              <div style="height:${jH}px;width:20px;background:var(--success);border-radius:4px 4px 0 0;margin-bottom:2px"></div>
              <div style="height:${lH}px;width:20px;background:var(--danger);border-radius:4px 4px 0 0"></div>
              <div style="font-size:0.7rem;color:var(--text-muted)">${d.dateKey.slice(5)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(e.message)}</p></div>`;
  }
}

// ===================== SETTINGS =====================

function loadSettings() {
  const content = showPage('settings');
  content.innerHTML = `
    <div class="card">
      <div class="card-title">API Key</div>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">If you set DASHBOARD_SECRET in .env, enter it here for API access.</p>
      <div class="form-row">
        <div class="form-group" style="max-width: 300px;">
          <input type="password" id="apiKeyInput" placeholder="API Key" value="${escapeHtml(apiKey)}">
        </div>
        <button class="btn btn-primary" id="saveKey">Save</button>
      </div>
    </div>
  `;
  document.getElementById('saveKey').addEventListener('click', () => {
    apiKey = document.getElementById('apiKeyInput').value;
    localStorage.setItem('dashboard_key', apiKey);
    alert('Saved');
  });
}

// ===================== INIT =====================

document.getElementById('guildSelect').addEventListener('change', (e) => {
  currentGuildId = e.target.value || null;
  const page = document.querySelector('.nav-item.active')?.dataset?.page;
  if (page === 'moderation') loadModeration(modSubPage || undefined);\n  else if (page === 'features') loadFeatures();\n  else if (page === 'xp') loadXP();
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const page = item.dataset.page;
    modSubPage = null;
    if (page === 'overview') loadOverview();\n    else if (page === 'features') loadFeatures();\n    else if (page === 'moderation') loadModeration();\n    else if (page === 'xp') loadXP();\n    else if (page === 'settings') loadSettings();
  });
});

loadOverview();








