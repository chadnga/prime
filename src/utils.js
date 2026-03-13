/**
 * Utility functions for PrimeLooks bot
 */
const config = require('../config');

function drawCover(ctx, img, x, y, w, h) {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let sx, sy, sw, sh;
  if (imgRatio > boxRatio) {
    sh = img.height;
    sw = sh * boxRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / boxRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function normalizeRoleName(name) {
  return (name || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function getDateKey(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(dateKey) {
  const [, month, day] = dateKey.split('-');
  return `${month}/${day}`;
}

function getChannelByName(guild, nameKey) {
  const name = config.CHANNELS?.[nameKey];
  if (!name) return null;
  return guild.channels.cache.find(ch =>
    (ch.name || '').normalize('NFKD').toLowerCase().includes(name.toLowerCase())
  );
}

function logError(context, err) {
  console.error(`[${context}]`, err);
}

module.exports = {
  drawCover,
  normalizeRoleName,
  getDateKey,
  formatDateLabel,
  getChannelByName,
  logError,
};
