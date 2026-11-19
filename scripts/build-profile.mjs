import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const GENERATOR_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(GENERATOR_FILE), '..');
const OUT = path.join(ROOT, 'profile', 'generated');
const CACHE = path.join(ROOT, 'profile', 'github-cache.json');
const config = JSON.parse(await readFile(path.join(ROOT, 'profile.config.json'), 'utf8'));
const monoFont = (await readFile(path.join(ROOT, 'fonts', 'CommitMono-Regular.woff2'))).toString('base64');
const fontLicense = (await readFile(path.join(ROOT, 'fonts', 'CommitMono-LICENSE'), 'utf8')).replaceAll('*/', '* /').trim();
const avatar = (await readFile(path.join(ROOT, 'profile', 'avatar.png'))).toString('base64');
const { github, blog, profile, theme: c, motion, effects, layout } = config;
const W = layout.width;
const speed = Math.max(0.05, motion.speed || 1);
const seconds = (value) => `${(value / speed).toFixed(2)}s`;

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const clamp = (value = '', max) => String(value).length > max ? `${String(value).slice(0, max - 1)}…` : String(value);
const compact = (n = 0) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const date = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(new Date(value));
const dateLong = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const monthYear = (value) => new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const mix = (a, b, t) => `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decodeHtml = (value) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
  .replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function wrap(text, max = 42, lines = 2) {
  const source = String(text || 'No description yet.');
  const words = source.split(/\s+/);
  const out = [];
  let line = '';
  for (const [index, word] of words.entries()) {
    if (`${line} ${word}`.trim().length > max && line) {
      out.push(line);
      line = word;
      if (out.length === lines - 1) {
        line = words.slice(index).join(' ');
        break;
      }
    } else line = `${line} ${word}`.trim();
  }
  if (out.length < lines && line) out.push(line);
  if (out.join(' ').length < source.length && out.length) out[out.length - 1] = clamp(out[out.length - 1], max - 1) + '…';
  return out.slice(0, lines);
}

const UA = 'monochrome-profile-readme';

async function githubJson(endpoint) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': UA };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${endpoint}`, { headers });
  if (!response.ok) throw Object.assign(new Error(`GitHub API ${response.status}: ${endpoint}`), { status: response.status });
  return response.json();
}

async function githubStats(endpoint) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': UA };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`https://api.github.com${endpoint}`, { headers });
    if (response.status === 202) {
      await sleep(2500);
      continue;
    }
    if (!response.ok) throw Object.assign(new Error(`GitHub API ${response.status}: ${endpoint}`), { status: response.status });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`GitHub is still computing ${endpoint}`);
}

const prevCache = await readFile(CACHE, 'utf8').then(JSON.parse).catch(() => ({}));
const safely = async (label, load, fallback) => {
  try { return await load(); } catch (error) {
    console.warn(`${label} unavailable, using cached value: ${error.message}`);
    return fallback ?? null;
  }
};

async function fetchRank() {
  const response = await fetch(`https://gitista.com/data/${config.rank.country.toLowerCase()}.json`, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`gitista HTTP ${response.status}`);
  const json = await response.json();
  const me = json.contributors?.find((entry) => entry.login.toLowerCase() === github.username.toLowerCase());
  if (!me) throw new Error('not listed on gitista');
  return { countryRank: me.countryRank, worldRank: me.worldRank, countryName: json.country.name, total: json.totalContributors };
}

async function fetchCalendar(from, to) {
  const query = from ? `?from=${from}&to=${to}` : '';
  const response = await fetch(`https://github.com/users/${github.username}/contributions${query}`, { headers: { 'User-Agent': `Mozilla/5.0 ${UA}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const counts = new Map();
  for (const match of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>\s*(No|\d[\d,]*) contributions?\b/g)) {
    counts.set(match[1], match[2] === 'No' ? 0 : Number(match[2].replaceAll(',', '')));
  }
  const today = new Date().toISOString().slice(0, 10);
  const days = [];
  for (const [tag] of html.matchAll(/<td\b[^>]*data-date="[^"]*"[^>]*>/g)) {
    const attr = (name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    const id = attr('id');
    const day = attr('data-date');
    if (day && id && counts.has(id) && day <= today) days.push({ day, level: Number(attr('data-level') || 0), count: counts.get(id) });
  }
  if (!days.length) throw new Error('contribution calendar markup changed');
  return days.sort((a, b) => a.day.localeCompare(b.day));
}

async function fetchStreak() {
  const days = await fetchCalendar();
  if (days.length < 300) throw new Error('contribution calendar markup changed');
  let longest = { length: 0, start: '', end: '' };
  let run = null;
  for (const { day, count } of days) {
    if (count > 0) {
      run = run ? { ...run, length: run.length + 1, end: day } : { length: 1, start: day, end: day };
      if (run.length > longest.length) longest = run;
    } else run = null;
  }
  let current = { length: 0, start: '', end: '' };
  let index = days.length - 1;
  if (days[index].count === 0) index--;
  while (index >= 0 && days[index].count > 0) {
    current = { length: current.length + 1, start: days[index].day, end: current.end || days[index].day };
    index--;
  }
  return {
    total: days.reduce((sum, entry) => sum + entry.count, 0),
    current,
    longest,
    from: days[0].day,
    to: days.at(-1).day,
  };
}

async function fetchHistory(createdAt) {
  const byDay = new Map();
  for (let year = new Date(createdAt).getUTCFullYear(); year <= new Date().getUTCFullYear(); year++) {
    for (const entry of await fetchCalendar(`${year}-01-01`, `${year}-12-31`)) byDay.set(entry.day, entry.count);
  }
  const days = [...byDay].sort((a, b) => a[0].localeCompare(b[0]));
  const start = days.findIndex(([, count]) => count > 0);
  if (start < 0) throw new Error('no contributions found');
  const used = days.slice(start);
  const weeks = [];
  for (let index = 0; index < used.length; index += 7) weeks.push(used.slice(index, index + 7).reduce((sum, [, count]) => sum + count, 0));
  const [lastDay, lastCount] = used.at(-1);
  return { from: used[0][0], to: lastDay, total: used.reduce((sum, [, count]) => sum + count, 0), weeks, lastDay, lastCount };
}

async function fetchActivity(fullName) {
  const contributors = await githubStats(`/repos/${fullName}/stats/contributors`);
  const byWeek = new Map();
  for (const contributor of contributors || []) for (const week of contributor.weeks) byWeek.set(week.w, (byWeek.get(week.w) || 0) + week.c);
  const sorted = [...byWeek].sort((a, b) => a[0] - b[0]);
  const first = sorted.findIndex(([, count]) => count > 0);
  if (first < 0) return null;
  const weeks = sorted.slice(first).map(([, count]) => count);
  return {
    from: new Date(sorted[first][0] * 1000).toISOString().slice(0, 10),
    weeks,
    total: weeks.reduce((sum, count) => sum + count, 0),
    peak: Math.max(...weeks),
  };
}

async function fetchOwnRepos() {
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await githubJson(`/users/${github.username}/repos?per_page=100&type=owner&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((repo) => !repo.fork);
}

async function fetchStats(own) {
  const name = github.username;
  const sizes = {};
  for (const repo of own) if (repo.language) sizes[repo.language] = (sizes[repo.language] || 0) + 1;
  const top = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topTotal = top.reduce((sum, [, size]) => sum + size, 0) || 1;
  const count = async (endpoint) => (await githubJson(endpoint)).total_count;
  const [commits, pulls, issues] = await Promise.all([
    count(`/search/commits?q=author:${name}&per_page=1`),
    count(`/search/issues?q=author:${name}+type:pr&per_page=1`),
    count(`/search/issues?q=author:${name}+type:issue&per_page=1`),
  ]);
  return {
    stars: own.reduce((sum, repo) => sum + repo.stargazers_count, 0),
    commits,
    pulls,
    issues,
    languages: top.map(([language, size]) => ({ name: language, share: size / topTotal })),
  };
}

async function fetchBlog() {
  const response = await fetch(blog.url, { headers: { 'User-Agent': `Mozilla/5.0 ${UA}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const origin = new URL(blog.url).origin;
  const posts = [];
  for (const chunk of html.split('<li ').slice(1)) {
    const href = chunk.match(/href="(\/blog\/[^"#?]+)"/)?.[1];
    const title = chunk.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1];
    const published = chunk.match(/<time\b[^>]*dateTime="([^"]+)"/)?.[1];
    if (!href || !title || !published) continue;
    const minutes = chunk.match(/<span>(\d+)(?:<!-- -->)?\s*min read<\/span>/)?.[1];
    posts.push({ title: decodeHtml(title.replace(/<[^>]+>/g, '')).trim(), url: origin + href, published, minutes: minutes ? Number(minutes) : null });
  }
  if (!posts.length) throw new Error('blog markup changed');
  return posts.sort((a, b) => b.published.localeCompare(a.published));
}

const byPushed = (a, b) => b.pushed_at.localeCompare(a.pushed_at);
const slim = (repo) => ({
  name: repo.name,
  full_name: repo.full_name,
  html_url: repo.html_url,
  homepage: repo.homepage || '',
  description: repo.description,
  language: repo.language,
  stargazers_count: repo.stargazers_count,
  pushed_at: repo.pushed_at,
});

async function loadGithubData() {
  try {
    const rawUser = await githubJson(`/users/${github.username}`);
    const user = { login: rawUser.login, public_repos: rawUser.public_repos, followers: rawUser.followers, following: rawUser.following, created_at: rawUser.created_at };
    const own = await fetchOwnRepos();
    const excluded = new Set((github.exclude ?? []).map((name) => name.toLowerCase()));
    const visible = own.filter((repo) => !repo.archived && !excluded.has(repo.name.toLowerCase()));
    const featured = github.featured.map((name) => visible.find((repo) => repo.name.toLowerCase() === name.toLowerCase())).filter(Boolean);
    const rest = visible.filter((repo) => !featured.includes(repo)).sort(byPushed).slice(0, github.list);
    const repos = [...featured, ...rest].map(slim);
    if (!repos.length) throw new Error('no repositories found');
    const activity = {};
    await Promise.all(repos.slice(0, github.featured.length).map(async (repo) => {
      activity[repo.full_name] = await safely(`commit activity for ${repo.name}`, () => fetchActivity(repo.full_name), prevCache.activity?.[repo.full_name]);
    }));
    const rank = config.rank?.enabled ? await safely('gitista rank', fetchRank, prevCache.rank) : null;
    const streak = await safely('contribution streak', fetchStreak, prevCache.streak);
    const history = await safely('contribution history', () => fetchHistory(user.created_at), prevCache.history);
    const stats = await safely('profile stats', () => fetchStats(own), prevCache.stats);
    const posts = await safely('blog posts', fetchBlog, prevCache.posts);
    const result = { user, repos, activity, rank, streak, history, stats, posts };
    await mkdir(path.dirname(CACHE), { recursive: true });
    await writeFile(CACHE, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    if (!prevCache.user || !prevCache.repos?.length) throw error;
    console.warn(`GitHub fetch failed; using cached data: ${error.message}`);
    const excluded = new Set((github.exclude ?? []).map((name) => name.toLowerCase()));
    const cached = prevCache.repos.filter((repo) => !excluded.has(repo.name.toLowerCase()));
    const pinned = github.featured.map((name) => cached.find((repo) => repo.name.toLowerCase() === name.toLowerCase())).filter(Boolean);
    return { ...prevCache, repos: [...pinned, ...cached.filter((repo) => !pinned.includes(repo)).sort(byPushed)] };
  }
}

const data = await loadGithubData();
const generatorSource = await readFile(GENERATOR_FILE, 'utf8');
let assetVersion = '';

function style() {
  return `<style>
    /* CommitMono font license
${fontLicense}
*/
    @font-face{font-family:Commit;src:url(data:font/woff2;base64,${monoFont}) format('woff2');font-weight:400}
    text{font-family:Commit,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:400}image{image-rendering:pixelated}
    .sans{font-family:Inter,"Segoe UI",Arial,sans-serif}.t1{fill:${c.text1}}.t2{fill:${c.text2}}.t3{fill:${c.text3}}.accent{fill:${c.accent}}.ok{fill:${c.ok}}
    .body{font-size:14px}.code{font-size:13px}.code-sm{font-size:12px}.label{font-size:12px;letter-spacing:.06em;text-transform:uppercase}.micro{font-size:11px;letter-spacing:.06em;text-transform:uppercase}
    .title{font-size:24px;letter-spacing:-.025em}.display{font-size:56px;letter-spacing:-.04em}.cap{paint-order:stroke;stroke:${c.page};stroke-width:3px;stroke-linejoin:round}
    @media(prefers-reduced-motion:reduce){.motion{display:none!important}.reduced{display:block!important}}
  </style>`;
}

function shell(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">${esc(title)}</title>${style()}<rect width="${width}" height="${height}" fill="${c.page}"/>${body}<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" fill="none" stroke="${c.line}"/></svg>\n`;
}

function pendingMark(x, y) {
  if (!effects.pendingMark) return '';
  const cells = [[0,0],[5,0],[0,5],[5,5]];
  const still = cells.map(([dx, dy], index) => `<rect x="${x + dx}" y="${y + dy}" width="3" height="3" fill="${c.accent}" opacity="${index ? .28 : 1}"/>`).join('');
  if (!motion.enabled) return still;
  const animated = cells.map(([dx, dy], index) => `<rect x="${x + dx}" y="${y + dy}" width="3" height="3" fill="${c.accent}" opacity="${index ? .28 : 1}"><animate attributeName="opacity" values="${cells.map((_, step) => step === index ? 1 : .28).join(';')};${index === 0 ? 1 : .28}" dur="${seconds(motion.pendingDuration)}" calcMode="discrete" repeatCount="indefinite"/></rect>`).join('');
  return `<g class="motion">${animated}</g><g class="reduced" style="display:none">${still}</g>`;
}

function panelHead(width, name, meta = '', status = '') {
  const safeName = clamp(name, Math.max(12, Math.floor(width / 16)));
  const statusX = Math.min(width - 180, 28 + safeName.length * 8);
  const statusMarkup = status ? `${pendingMark(statusX, 14)}<text x="${statusX + 16}" y="24" class="label t1">${esc(status)}</text>` : '';
  return `<rect width="${width}" height="38" fill="${c.panel}"/><line x1="0" x2="${width}" y1="37.5" y2="37.5" stroke="${c.line}"/><text x="12" y="24" class="code t1">${esc(safeName)}</text>${statusMarkup}<text x="${width - 12}" y="24" text-anchor="end" class="code-sm t3">${esc(clamp(meta, Math.floor(width / 15)))}</text>`;
}

const BAYER = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function paletteHeader(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  return header;
}
function paletteBytes(palette) {
  return Buffer.from(palette.flatMap((hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))));
}
function indexedRows(index, width, height) {
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0;
    Buffer.from(index.buffer, index.byteOffset + y * width, width).copy(rows, y * (width + 1) + 1);
  }
  return rows;
}
function palettePng(index, width, height, palette) {
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', paletteHeader(width, height)),
    pngChunk('PLTE', paletteBytes(palette)),
    pngChunk('IDAT', deflateSync(indexedRows(index, width, height), { level: 9 })),
    pngChunk('IEND'),
  ]).toString('base64');
}
function animatedPalettePng(frames, order, width, height, palette, fps) {
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(order.length, 0);
  animation.writeUInt32BE(0, 4);
  const chunks = [
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', paletteHeader(width, height)),
    pngChunk('PLTE', paletteBytes(palette)),
    pngChunk('acTL', animation),
  ];
  let sequence = 0;
  const delayNumerator = 1000;
  const delayDenominator = Math.min(65535, Math.max(1, Math.round(fps * 1000)));
  order.forEach((frameIndex, index) => {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++, 0);
    control.writeUInt32BE(width, 4);
    control.writeUInt32BE(height, 8);
    control.writeUInt32BE(0, 12);
    control.writeUInt32BE(0, 16);
    control.writeUInt16BE(delayNumerator, 20);
    control.writeUInt16BE(delayDenominator, 22);
    control[24] = 0;
    control[25] = 0;
    chunks.push(pngChunk('fcTL', control));
    const compressed = deflateSync(indexedRows(frames[frameIndex].pixels, width, height), { level: 9 });
    if (index === 0) chunks.push(pngChunk('IDAT', compressed));
    else {
      const frameData = Buffer.alloc(compressed.length + 4);
      frameData.writeUInt32BE(sequence++, 0);
      compressed.copy(frameData, 4);
      chunks.push(pngChunk('fdAT', frameData));
    }
  });
  chunks.push(pngChunk('IEND'));
  return Buffer.concat(chunks).toString('base64');
}
const smooth01 = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const hashNoise = (x, y, seed) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};
function valueNoise(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hashNoise(x0, y0, seed);
  const b = hashNoise(x0 + 1, y0, seed);
  const d = hashNoise(x0, y0 + 1, seed);
  const e = hashNoise(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = d + (e - d) * sx;
  return top + (bottom - top) * sy;
}
function fbm(x, y, seed) {
  let total = 0;
  let amplitude = .5;
  let normalizer = 0;
  for (let octave = 0; octave < 4; octave++) {
    total += valueNoise(x, y, seed + octave * 17) * amplitude;
    normalizer += amplitude;
    x = x * 2.03 + 7.1;
    y = y * 2.03 - 3.7;
    amplitude *= .5;
  }
  return total / normalizer;
}
const LEVELS = c.ditherPalette.length;
const CELL = effects.ditherScale;
const shade = (tone, row, col) => {
  if (tone <= 0.02) return 0;
  const scaled = Math.min(1, tone) * (LEVELS - 1);
  const base = Math.floor(scaled);
  return Math.min(LEVELS - 1, base + (scaled - base > BAYER[row % 4][col % 4] / 16 ? 1 : 0));
};

function resample(values, cols, passes, power) {
  const n = values.length;
  let out = Array.from({ length: cols }, (_, index) => {
    const from = index * n / cols;
    const to = (index + 1) * n / cols;
    let sum = 0;
    let weight = 0;
    for (let k = Math.floor(from); k < Math.min(n, Math.ceil(to)); k++) {
      const overlap = Math.min(to, k + 1) - Math.max(from, k);
      if (overlap > 0) {
        sum += values[k] * overlap;
        weight += overlap;
      }
    }
    return weight ? sum / weight : 0;
  });
  for (let pass = 0; pass < passes; pass++) out = out.map((value, index) => (out[Math.max(0, index - 1)] + value * 2 + out[Math.min(cols - 1, index + 1)]) / 4);
  const peak = Math.log1p(Math.max(...out, 1e-9));
  return out.map((value) => Math.pow(Math.log1p(value) / peak, power));
}

const SCENE_H = 300;
const sceneCols = Math.ceil(W / CELL);
const sceneRows = Math.ceil(SCENE_H / CELL);
const axisRow = sceneRows * 0.52;
const sceneAmps = data.history ? resample(data.history.weeks, sceneCols, 4, 1.1) : Array(sceneCols).fill(0);
const halfHeight = (col) => 1.2 + (col / sceneCols) * 3.2 + sceneAmps[col] * sceneRows * 0.4;
const peakWeek = data.history ? data.history.weeks.indexOf(Math.max(...data.history.weeks)) : -1;
const nova = peakWeek < 0 ? null : { col: Math.min(sceneCols - 8, Math.max(8, Math.round((peakWeek + 0.5) / data.history.weeks.length * sceneCols))), row: axisRow };
const galaxies = [];
for (let seed = 0; galaxies.length < 7 && seed < 400; seed++) {
  const col = Math.floor(sceneCols * (0.12 + 0.84 * hashNoise(seed, 1, 91)));
  const radius = 5 + 4 * hashNoise(seed, 2, 92);
  const room = halfHeight(col) - radius - 2;
  if (room < 2 || (nova && Math.abs(col - nova.col) < 18) || galaxies.some((other) => Math.abs(other.col - col) < 19)) continue;
  galaxies.push({ col, row: axisRow + (hashNoise(seed, 3, 93) * 2 - 1) * room, radius, tilt: hashNoise(seed, 4, 94) * Math.PI, flat: 0.45 + 0.4 * hashNoise(seed, 5, 95), spin: hashNoise(seed, 6, 96) > 0.5 ? 1 : -1 });
}

function universeFrame(phase) {
  const tones = new Float32Array(sceneCols * sceneRows);
  const put = (col, row, tone) => {
    col = Math.round(col);
    row = Math.round(row);
    if (col >= 0 && col < sceneCols && row >= 0 && row < sceneRows) tones[row * sceneCols + col] = Math.max(tones[row * sceneCols + col], tone);
  };
  for (let row = 0; row < sceneRows; row++) {
    for (let col = 0; col < sceneCols; col++) {
      const hh = halfHeight(col);
      const dy = Math.abs(row - axisRow);
      const u = col / sceneCols;
      const v = row / sceneRows;
      let tone = 0;
      if (dy < hh) {
        const depth = dy / hh;
        const cloud = smooth01(0.38, 0.82, fbm(u * 11 + phase * 0.02, v * 6 + 4, 5));
        tone = (0.1 + 0.3 * cloud) * (1 - 0.55 * depth * depth) + 0.12 * Math.exp(-(1 - depth) * hh / 2.5);
        if (hashNoise(col, row, 7) < 0.06) {
          const b = hashNoise(col, row, 19);
          tone = Math.max(tone, (0.35 + 0.65 * b) * (0.65 + 0.35 * Math.sin(phase * (1.2 + 2.2 * b) + b * 60)));
        }
        if (hh - dy < 1) tone = 1;
      } else {
        tone = 0.2 * Math.exp(-(dy - hh) / 2.2);
        if (hashNoise(col, row, 11) < 0.006) tone = Math.max(tone, 0.25 + 0.35 * hashNoise(col, row, 13));
      }
      tones[row * sceneCols + col] = tone;
    }
  }
  for (let col = 0; col < 14; col++) for (let row = Math.floor(axisRow - 8); row <= Math.ceil(axisRow + 8); row++) put(col, row, Math.exp(-Math.hypot(col, row - axisRow) / 3.2) * (0.9 + 0.1 * Math.sin(phase * 2)));
  for (const galaxy of galaxies) {
    const reach = Math.ceil(galaxy.radius * 1.7);
    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const x = ox * Math.cos(galaxy.tilt) + oy * Math.sin(galaxy.tilt);
        const y = (-ox * Math.sin(galaxy.tilt) + oy * Math.cos(galaxy.tilt)) / galaxy.flat;
        const r = Math.hypot(x, y);
        if (r > galaxy.radius * 1.5) continue;
        const arm = 0.5 + 0.5 * Math.cos(2 * (Math.atan2(y, x) - Math.log(r + 1) * 2.1 * galaxy.spin - phase * 0.5 * galaxy.spin));
        const falloff = Math.exp(-r / (galaxy.radius * 0.7));
        put(galaxy.col + ox, galaxy.row + oy, Math.min(1, falloff * (0.45 + 1.1 * arm) + 0.95 * Math.exp(-r * r / 2.4)));
      }
    }
  }
  if (nova) {
    const pulse = 0.5 + 0.5 * Math.sin(phase);
    const ring = 5 + 9 * pulse;
    const reach = 22;
    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const r = Math.hypot(ox, oy * 1.15);
        const glow = 0.55 * Math.exp(-r / (4 + 3 * pulse));
        const shell = Math.exp(-(((r - ring) / 1.1) ** 2)) * (0.9 - 0.45 * pulse);
        const ray = (Math.abs(ox) < 1 || Math.abs(oy) < 1 || Math.abs(Math.abs(ox) - Math.abs(oy)) < 1) && r < 7 + 8 * pulse ? 0.85 * (1 - r / (8 + 8 * pulse)) : 0;
        put(nova.col + ox, nova.row + oy, Math.max(glow, shell, ray, r < 2 ? 1 : 0));
      }
    }
  }
  const pixels = new Uint8Array(sceneCols * sceneRows);
  for (let row = 0; row < sceneRows; row++) for (let col = 0; col < sceneCols; col++) pixels[row * sceneCols + col] = shade(tones[row * sceneCols + col], row, col);
  return { pixels, data: palettePng(pixels, sceneCols, sceneRows, c.ditherPalette) };
}

function universe() {
  const image = (data, extra = '') => `<image x="0" y="0" width="${W}" height="${SCENE_H}" preserveAspectRatio="none" href="data:image/png;base64,${data}" ${extra}/>`;
  if (!effects.dither) return `<rect width="${W}" height="${SCENE_H}" fill="${c.selected}"/>`;
  const steps = Math.max(2, Math.round(motion.sceneDuration * motion.sceneFps));
  const count = effects.animatedScene && motion.enabled ? Math.floor(steps / 2) + 1 : 1;
  const frames = Array.from({ length: count }, (_, index) => universeFrame(count === 1 ? Math.PI / 2 : index * Math.PI * 2 / (count - 1)));
  if (count === 1) return image(frames[0].data);
  const order = [...Array(count).keys(), ...Array.from({ length: count - 2 }, (_, i) => count - 2 - i)];
  const animated = animatedPalettePng(frames, order, sceneCols, sceneRows, c.ditherPalette, motion.sceneFps * speed);
  return image(animated, 'class="motion"') + image(frames[0].data, 'class="reduced" style="display:none"');
}

function headerSvg() {
  const sceneY = 38;
  const bandY = sceneY + SCENE_H;
  const bandH = 240;
  const H = bandY + bandH;
  const split = 535;
  const { user, rank, history } = data;
  const rankCell = rank
    ? statCell(split, bandY + bandH / 2, 172, bandH / 2, 'Open source rank', `#${rank.countryRank} ${rank.countryName}`, false, 'accent', `#${rank.worldRank} worldwide`)
    : statCell(split, bandY + bandH / 2, 172, bandH / 2, 'Status', profile.state, false, 'ok');
  const years = [];
  if (history) {
    const start = new Date(`${history.from}T00:00:00Z`).getTime();
    const weeks = history.weeks.length;
    for (let year = new Date(start).getUTCFullYear() + 1; year <= new Date().getUTCFullYear(); year++) {
      const x = Math.round(((Date.UTC(year, 0, 1) - start) / 604800000) / weeks * W);
      if (x > 24 && x < W - 40) years.push(`<line x1="${x + .5}" x2="${x + .5}" y1="${sceneY + 4}" y2="${sceneY + 24}" stroke="${c.line}"/><text x="${x + 8}" y="${sceneY + 19}" class="code-sm t3 cap">${year}</text>`);
    }
  }
  const today = history && history.lastDay === new Date().toISOString().slice(0, 10) && history.lastCount > 0;
  const tipY = sceneY + (axisRow - halfHeight(sceneCols - 1)) * CELL - 10;
  const peakCount = history ? history.weeks[peakWeek] : 0;
  const novaX = nova ? nova.col * CELL : 0;
  const novaRight = novaX < W - 330;
  const novaLabel = nova ? `<text x="${novaRight ? novaX + 66 : novaX - 66}" y="${sceneY + nova.row * CELL + 4}" text-anchor="${novaRight ? 'start' : 'end'}" class="code-sm t2 cap">supernova: peak week, ${peakCount} contributions</text>` : '';
  const caption = history
    ? `<text x="26" y="${bandY - 14}" class="code-sm t2 cap">${history.total.toLocaleString('en')} contributions since ${monthYear(history.from)}</text>${today ? `<text x="${W - 40}" y="${bandY - 14}" text-anchor="end" class="code-sm t2 cap">contributed today</text>${pendingMark(W - 30, bandY - 23)}${pendingMark(W - 14, tipY)}` : ''}`
    : '';
  const intro = wrap(profile.intro, 36, 3);
  const body = `${panelHead(W, `${github.username} / README.md`, `github.com/${github.username}`, 'building')}
    <g transform="translate(0 ${sceneY})">${universe()}</g>${years.join('')}${novaLabel}${caption}
    <line x1="0" x2="${W}" y1="${bandY + .5}" y2="${bandY + .5}" stroke="${c.line}"/>
    <line x1="${split + .5}" x2="${split + .5}" y1="${bandY}" y2="${H}" stroke="${c.line}"/>
    <image x="26" y="${bandY + 24}" width="192" height="192" href="data:image/png;base64,${avatar}"/><rect x="26.5" y="${bandY + 24.5}" width="191" height="191" fill="none" stroke="${c.line}"/>
    <text x="246" y="${bandY + 70}" class="sans display t1">${esc(clamp(profile.name, 12))}</text>
    <text x="248" y="${bandY + 94}" class="code-sm t3">${esc(clamp(profile.handle, 28))}</text>
    ${intro.map((line, index) => `<text x="248" y="${bandY + 126 + index * 20}" class="sans body t2">${esc(line)}</text>`).join('')}
    <text x="248" y="${bandY + 196}" class="micro t3">Now</text><text x="248" y="${bandY + 216}" class="code-sm t1">${esc(clamp(profile.status, 34))}</text>
    ${statCell(split, bandY, 172, bandH / 2, 'Repositories', compact(user.public_repos))}
    ${statCell(split + 172, bandY, W - split - 172, bandH / 2, 'Followers', compact(user.followers), true)}
    ${rankCell}
    ${statCell(split + 172, bandY + bandH / 2, W - split - 172, bandH / 2, 'Focus', profile.focus, true)}`;
  return shell(W, H, `${profile.name}, ${profile.role}. ${history ? `${history.total} contributions since ${monthYear(history.from)}, drawn as an expanding universe with a supernova at the busiest week.` : ''}${rank ? ` #${rank.countryRank} open source contributor in ${rank.countryName}, #${rank.worldRank} worldwide.` : ''}`, body);
}

function statCell(x, y, width, height, label, value, rightEdge = false, valueClass = 't1', sub = '') {
  return `<g><line x1="${x}" x2="${x + width}" y1="${y + height + .5}" y2="${y + height + .5}" stroke="${c.line}"/><line x1="${x + width + .5}" x2="${x + width + .5}" y1="${y}" y2="${y + height}" stroke="${rightEdge ? 'none' : c.line}"/><text x="${x + 16}" y="${y + 27}" class="micro t3">${esc(label)}</text><text x="${x + 16}" y="${y + 62}" class="code ${valueClass}" font-size="24">${esc(clamp(value, 14))}</text>${sub ? `<text x="${x + 16}" y="${y + 84}" class="code-sm t3">${esc(clamp(sub, 24))}</text>` : ''}</g>`;
}

const stars = (n) => `${n} ${n === 1 ? 'star' : 'stars'}`;
const repoMeta = (repo) => (repo.stargazers_count ? stars(repo.stargazers_count) : '');
const repoUrl = (repo) => repo.homepage?.trim() || repo.html_url;
const homepageHost = (repo) => repo.homepage?.trim() ? new URL(repo.homepage).host.replace(/^www\./, '') : repo.full_name.split('/')[0];

const COVER_W = W / 2;
const COVER_H = 230;

function coverImage(repo) {
  const file = path.join(ROOT, 'assets', 'covers', `${repo.name.toLowerCase()}.jpg`);
  return readFile(file).then((bytes) => bytes.toString('base64'), () => '');
}

function projectSvg(repo, cover) {
  const width = COVER_W;
  const activity = data.activity?.[repo.full_name];
  const lines = wrap(repo.description, 44, 2);
  const coverY = 38;
  const stripY = coverY + COVER_H;
  const y0 = stripY + 34;
  const visual = cover
    ? `<rect x="0" y="${coverY}" width="${width}" height="${COVER_H}" fill="${c.well}"/><image x="0" y="${coverY}" width="${width}" height="${COVER_H}" preserveAspectRatio="xMidYMin slice" style="image-rendering:auto" href="data:image/jpeg;base64,${cover}"/>`
    : `<rect x="0" y="${coverY}" width="${width}" height="${COVER_H}" fill="${c.well}"/><text x="${width / 2}" y="${coverY + COVER_H / 2 + 8}" text-anchor="middle" class="sans display t3" font-size="32">${esc(repo.name)}</text>`;
  const strip = activity
    ? `<text x="12" y="${stripY + 22}" class="code-sm t3">Commits per week, ${date(activity.from)} to today</text><text x="${width - 12}" y="${stripY + 22}" text-anchor="end" class="code-sm t2">${activity.total.toLocaleString('en')} total, peak ${activity.peak}</text>`
    : `<text x="12" y="${stripY + 22}" class="code-sm t3">No commit history yet</text>`;
  const body = `${panelHead(width, repo.name, homepageHost(repo))}${visual}
    <rect x="0" y="${stripY}" width="${width}" height="34" fill="${c.panel}"/><line x1="0" x2="${width}" y1="${stripY + .5}" y2="${stripY + .5}" stroke="${c.line}"/>${strip}
    <line x1="0" x2="${width}" y1="${y0 + .5}" y2="${y0 + .5}" stroke="${c.line}"/>
    <text x="20" y="${y0 + 36}" class="sans body t1">${esc(lines[0] || '')}</text><text x="20" y="${y0 + 57}" class="sans body t1">${esc(lines[1] || '')}</text>
    <text x="20" y="${y0 + 98}" class="code-sm t3">${esc(repo.language || 'mixed')}</text><text x="${width - 20}" y="${y0 + 98}" text-anchor="end" class="code-sm t3">${esc(repoMeta(repo))}</text>`;
  return shell(width, y0 + 120, `${repo.full_name}: ${repo.description || 'GitHub repository'}`, body);
}

function reposSvg(repos) {
  const headerH = 38;
  const rowH = 56;
  const H = headerH + repos.length * rowH;
  const rows = repos.map((repo, index) => {
    const y = headerH + index * rowH;
    return `${index ? `<line x1="0" x2="${W}" y1="${y + .5}" y2="${y + .5}" stroke="${c.lineFaint}"/>` : ''}<text x="16" y="${y + 33}" class="code t1">${esc(clamp(repo.name, 20))}</text><text x="200" y="${y + 33}" class="sans" font-size="14" fill="${c.text2}">${esc(clamp(repo.description || 'No description yet.', 58))}</text><text x="660" y="${y + 33}" class="code-sm t3">${esc(repo.language || 'mixed')}</text><text x="${W - 16}" y="${y + 33}" text-anchor="end" class="code-sm t3">${esc(repoMeta(repo))}</text>`;
  }).join('');
  return shell(W, H, `More repositories by ${github.username}, most recently pushed first`, `${panelHead(W, 'more repositories', 'latest 3 contributed to')}${rows}`);
}

function postsSvg(posts) {
  const headerH = 38;
  const rowH = 54;
  const rows = posts.map((post, index) => {
    const y = headerH + index * rowH;
    const meta = `${dateLong(post.published)}${post.minutes ? ` · ${post.minutes} min` : ''}`;
    return `${index ? `<line x1="0" x2="${W}" y1="${y + .5}" y2="${y + .5}" stroke="${c.lineFaint}"/>` : ''}<text x="16" y="${y + 32}" class="sans" font-size="15" fill="${c.text1}">${esc(clamp(post.title, 64))}</text><text x="${W - 16}" y="${y + 32}" text-anchor="end" class="code-sm t3">${esc(meta)}</text>`;
  }).join('');
  return shell(W, headerH + posts.length * rowH, `Latest writing on ${new URL(blog.url).host}: ${posts.map((post) => post.title).join('; ')}`, `${panelHead(W, 'writing', `${new URL(blog.url).host}/blog`)}${rows}`);
}

function statsSvg(stats, streak) {
  const top = 38;
  const rowH = 90;
  const items = [['Stars earned', stats.stars], ['Commits', stats.commits], ['Pull requests', stats.pulls], ['Issues', stats.issues]];
  if (streak) items.push(['Current streak', `${streak.current.length}d`], ['Longest streak', `${streak.longest.length}d`]);
  const cell = W / items.length;
  const cells = items.map(([label, value], index) => statCell(Math.round(index * cell), top, Math.round(cell), rowH, label, typeof value === 'number' ? compact(value) : value, index === items.length - 1)).join('');
  const y0 = top + rowH;
  const barX = 16;
  const barW = W - 32;
  const shades = [0, 0.25, 0.5, 0.68, 0.8].map((t) => mix(c.text1, c.page, t));
  let used = 0;
  let acc = 0;
  const segments = stats.languages.map((language, index) => {
    acc += language.share;
    const x = barX + used;
    const width = (index === stats.languages.length - 1 ? barW : Math.round(acc * barW)) - used;
    used += width;
    return `<rect x="${x}" y="${y0 + 40}" width="${Math.max(0, width - 2)}" height="10" fill="${shades[index]}"/>`;
  }).join('');
  const legend = stats.languages.map((language, index) => {
    const x = barX + index * (barW / 5);
    return `<rect x="${x}" y="${y0 + 69}" width="8" height="8" fill="${shades[index]}"/><text x="${x + 14}" y="${y0 + 77}" class="code-sm t2">${esc(clamp(language.name, 12))} ${Math.round(language.share * 100)}%</text>`;
  }).join('');
  const body = `${panelHead(W, 'stats', `github.com/${github.username}`)}${cells}
    <text x="${barX}" y="${y0 + 27}" class="micro t3">Top languages by repo</text>${segments}${legend}`;
  return shell(W, y0 + 100, `${github.username} stats: ${stats.stars} stars, ${stats.commits} commits, ${stats.pulls} pull requests, ${stats.issues} issues. Top languages: ${stats.languages.map((l) => l.name).join(', ')}`, body);
}

function linkSvg(label, width = W / 4) {
  return shell(width, 68, label, `<text x="12" y="41" class="label t1">${esc(label)} ↗</text>`);
}

function readme(featured, more, posts, links) {
  const img = (name, alt, width = '100%') => `<img src="./profile/generated/${name}.svg?v=${assetVersion}" width="${width}" alt="${esc(alt)}">`;
  const headerAlt = `${profile.name}, ${profile.role}. ${data.user.public_repos} repositories, ${data.user.followers} followers${data.rank ? `, #${data.rank.countryRank} open source contributor in ${data.rank.countryName}` : ''}`;
  const cards = featured.map((repo, index) => `<a href="${repoUrl(repo)}">${img(`project-${String(index + 1).padStart(2, '0')}`, `${repo.name}: ${repo.description || 'GitHub repository'}`, '50%')}</a>`).join('');
  const list = more.length ? `<a href="https://github.com/${github.username}?tab=repositories">${img('repos', `More repositories by ${github.username}: ${more.map((repo) => `${repo.name} (${repo.language || 'mixed'}, ${repo.stargazers_count} stars) ${repo.description || ''}`.trim()).join('; ')}`)}</a>\n\n` : '';
  const writing = posts.length ? `<a href="${blog.url}">${img('posts', `Latest writing: ${posts.map((post) => post.title).join('; ')}`)}</a>\n\n` : '';
  const stats = data.stats ? `<a href="https://github.com/${github.username}">${img('stats', `Stats: ${data.stats.stars} stars, ${data.stats.commits} commits, ${data.stats.pulls} pull requests, ${data.stats.issues} issues${data.streak ? `, current streak ${data.streak.current.length} days, longest ${data.streak.longest.length} days` : ''}`)}</a>\n\n` : '';
  const linkCells = links.map((link, index) => `<a href="${link.url}">${img(`link-${String(index + 1).padStart(2, '0')}`, link.label, `${100 / links.length}%`)}</a>`).join('');
  return `<!-- Generated by scripts/build-profile.mjs. Edit profile.config.json, not this file. -->
<p align="center"><a href="${github.username === 'FindMalek' ? 'https://www.findmalek.com' : `https://github.com/${github.username}`}">${img('header', headerAlt)}</a></p>

${cards}

${list}${writing}${stats}<p align="center">${linkCells}</p>
`;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const featured = data.repos.slice(0, github.featured.length);
const more = data.repos.slice(github.featured.length, github.featured.length + github.list);
const covers = await Promise.all(featured.map(coverImage));
const posts = (data.posts || []).slice(0, blog.limit);
const links = profile.links.slice(0, 6);
assetVersion = createHash('sha256')
  .update(JSON.stringify(config))
  .update(JSON.stringify(data))
  .update(generatorSource)
  .update(monoFont)
  .update(avatar)
  .update(covers.join(''))
  .digest('hex')
  .slice(0, 10);
await writeFile(path.join(OUT, 'header.svg'), headerSvg());
await Promise.all(featured.map((repo, index) => writeFile(path.join(OUT, `project-${String(index + 1).padStart(2, '0')}.svg`), projectSvg(repo, covers[index]))));
if (more.length) await writeFile(path.join(OUT, 'repos.svg'), reposSvg(more));
if (posts.length) await writeFile(path.join(OUT, 'posts.svg'), postsSvg(posts));
if (data.stats) await writeFile(path.join(OUT, 'stats.svg'), statsSvg(data.stats, data.streak));
await Promise.all(links.map((link, index) => writeFile(path.join(OUT, `link-${String(index + 1).padStart(2, '0')}.svg`), linkSvg(link.label, W / links.length))));
await writeFile(path.join(ROOT, 'README.md'), readme(featured, more, posts, links));
console.log(`Built profile for @${github.username}: ${featured.length} featured, ${more.length} listed, ${posts.length} posts.`);
