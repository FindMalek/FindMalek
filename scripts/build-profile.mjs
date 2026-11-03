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
const { github, projects, profile, theme: c, motion, effects, layout } = config;
const W = layout.width;
const speed = Math.max(0.05, motion.speed || 1);
const seconds = (value) => `${(value / speed).toFixed(2)}s`;

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const clamp = (value = '', max) => String(value).length > max ? `${String(value).slice(0, max - 1)}…` : String(value);
const compact = (n = 0) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const date = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(new Date(value));
const featuredOption = (entry) => typeof entry === 'string'
  ? { repo: entry, solidButton: false, ctaLabel: 'View source', ctaArrow: '↗', showRepoPath: true, projectUrl: '', showBanner: true, autoOgImage: true, ogSourceUrl: '', bannerUrl: '' }
  : entry;
const repoKey = (entry) => typeof entry === 'string' ? entry : entry.repo;

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

async function githubJson(endpoint) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'animated-profile-readme' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${endpoint}`, { headers });
  if (!response.ok) throw Object.assign(new Error(`GitHub API ${response.status}: ${endpoint}`), { status: response.status });
  return response.json();
}

const prevCache = await readFile(CACHE, 'utf8').then(JSON.parse).catch(() => ({}));
const safely = async (label, load, fallback) => {
  try { return await load(); } catch (error) {
    console.warn(`${label} unavailable, using cached value: ${error.message}`);
    return fallback ?? null;
  }
};

async function fetchRank() {
  const response = await fetch(`https://gitista.com/data/${config.rank.country.toLowerCase()}.json`, { headers: { 'User-Agent': 'animated-profile-readme' } });
  if (!response.ok) throw new Error(`gitista HTTP ${response.status}`);
  const json = await response.json();
  const me = json.contributors?.find((entry) => entry.login.toLowerCase() === github.username.toLowerCase());
  if (!me) throw new Error('not listed on gitista');
  return { countryRank: me.countryRank, worldRank: me.worldRank, countryName: json.country.name, total: json.totalContributors };
}

async function fetchStreak() {
  const response = await fetch(`https://github.com/users/${github.username}/contributions`, { headers: { 'User-Agent': 'Mozilla/5.0 animated-profile-readme' } });
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
  if (days.length < 300) throw new Error('contribution calendar markup changed');
  days.sort((a, b) => a.day.localeCompare(b.day));
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
    levels: days.map((entry) => entry.level),
  };
}

async function fetchStats() {
  const name = github.username;
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await githubJson(`/users/${name}/repos?per_page=100&type=owner&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const own = repos.filter((repo) => !repo.fork);
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

async function loadGithubData() {
  const names = [...new Set([...github.featuredRepos.map(repoKey), ...github.moreRepos.map(repoKey)])];
  const missingFrom = (repos) => github.featuredRepos.map(repoKey).filter((key) => !repos?.[key]);
  try {
    const rawUser = await githubJson(`/users/${github.username}`);
    const user = { login: rawUser.login, public_repos: rawUser.public_repos, followers: rawUser.followers, following: rawUser.following };
    const repos = {};
    await Promise.all(names.map(async (entry) => {
      const [owner, name] = entry.includes('/') ? entry.split('/') : [github.username, entry];
      try {
        const repo = await githubJson(`/repos/${owner}/${name}`);
        repos[entry] = {
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          description: repo.description,
          language: repo.language,
          stargazers_count: repo.stargazers_count,
          forks_count: repo.forks_count,
          updated_at: repo.updated_at,
          topics: repo.topics || [],
        };
      } catch (error) {
        if (error.status === 404) return console.warn(`${entry} not found, dropping it`);
        if (!prevCache.repos?.[entry]) throw error;
        console.warn(`${entry} fetch failed, using cached copy: ${error.message}`);
        repos[entry] = prevCache.repos[entry];
      }
    }));
    const missing = missingFrom(repos);
    if (missing.length) throw new Error(`featured repositories unavailable: ${missing.join(', ')}`);
    const rank = config.rank?.enabled ? await safely('gitista rank', fetchRank, prevCache.rank) : null;
    const streak = await safely('contribution calendar', fetchStreak, prevCache.streak);
    const stats = await safely('profile stats', fetchStats, prevCache.stats);
    const result = { user, repos, rank, streak, stats };
    await mkdir(path.dirname(CACHE), { recursive: true });
    await writeFile(CACHE, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    if (!prevCache.user || missingFrom(prevCache.repos).length) throw error;
    console.warn(`GitHub fetch failed; using cached repository data: ${error.message}`);
    return prevCache;
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
    .title{font-size:24px;letter-spacing:-.025em}.display{font-size:56px;letter-spacing:-.04em}
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
function auroraFrame(phase, width = W, height = 252) {
  const cell = effects.ditherScale;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const pixels = new Uint8Array(cols * rows);
  const time = 11 + phase;
  const aspect = cols / rows;
  const signedNoise = (x, y, seed) => valueNoise(x, y, seed) * 2 - 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u = (col + .5) / cols;
      const py = 1 - (row + .5) / rows;
      const x = (u - .5) * aspect + time * .25 * .04;
      let light = 0;
      for (let i = 0; i < 4; i++) {
        const depth = i / 3;
        const edge = .38 + i * .06
          + 1.4 * .11 * signedNoise(x * .55 + i * 3.1, time * .035 + i * 1.7, 41)
          + .8 * .05 * signedNoise(x * 2.1 - i * 1.3, time * .07 + i, 73);
        const above = py - edge;
        const curtain = above > 0
          ? Math.exp(-Math.abs(above) * 4.12 * (1 + i * .4))
          : Math.exp(-Math.abs(above) * 48);
        const rayX = (x + signedNoise(x * .8, time * .03 + i, 101) * .74) * 12;
        let ray = .2 + .8 * smooth01(.25, .75, fbm(rayX + i * 9, time * .045 + i, 131 + i * 11));
        ray *= .75 + .25 * valueNoise(rayX * 3.2, i * 4 + time * .02, 173 + i * 7);
        const patch = .3 + .7 * smooth01(.25, .7, fbm(x * .45 + i * 5, time * .02 + i * 2, 211 + i * 13));
        const rim = Math.exp(-Math.abs(above) * 34) * 1.1;
        const haze = above > 0 ? Math.exp(-Math.abs(above) * 5) * .09 : Math.exp(-Math.abs(above) * 14) * .05;
        light += (curtain * ray + rim * (.5 + .5 * ray) + haze) * patch * (1 - .5 * depth);
      }
      let tone = (1 - Math.exp(-light * 1.25)) * effects.ditherStrength;
      tone = smooth01(.035, .96, tone);
      if (tone < .025) {
        pixels[row * cols + col] = 0;
        continue;
      }
      const scaled = tone * (c.auroraPalette.length - 1);
      const base = Math.floor(scaled);
      const threshold = BAYER[row % 4][col % 4] / 16;
      pixels[row * cols + col] = Math.min(c.auroraPalette.length - 1, base + (scaled - base > threshold ? 1 : 0));
    }
  }
  return { pixels, data: palettePng(pixels, cols, rows, c.auroraPalette), cols, rows };
}

function aurora(width = W, height = 252) {
  if (!effects.dither) return `<rect width="${width}" height="${height}" fill="${c.selected}"/>`;
  const targetSteps = Math.max(2, Math.round(motion.auroraDuration * motion.auroraFps));
  const count = effects.animatedAurora && motion.enabled ? Math.floor(targetSteps / 2) + 1 : 1;
  const phaseSpan = 7.6;
  const frames = Array.from({ length: count }, (_, index) => auroraFrame(count === 1 ? 0 : index * phaseSpan / (count - 1), width, height));
  const image = (data, extra = '') => `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="data:image/png;base64,${data}" ${extra}/>`;
  if (count === 1) return image(frames[0].data);
  const order = [...Array(count).keys(), ...Array.from({ length: count - 2 }, (_, i) => count - 2 - i)];
  const animated = animatedPalettePng(frames, order, frames[0].cols, frames[0].rows, c.auroraPalette, motion.auroraFps * speed);
  return image(animated, 'class="motion"') + image(frames[0].data, 'class="reduced" style="display:none"');
}

function headerSvg() {
  const H = 490;
  const sceneY = 38;
  const sceneH = 252;
  const split = 535;
  const user = data.user;
  const rank = data.rank;
  const lowerY = sceneY + sceneH + 100;
  const lowerH = H - lowerY;
  const rankCell = rank
    ? statCell(split, lowerY, 172, lowerH, 'Open source rank', `#${rank.countryRank} ${rank.countryName}`, false, 'accent', `#${rank.worldRank} worldwide`)
    : statCell(split, lowerY, 172, lowerH, 'Status', profile.state, false, 'ok');
  const body = `${panelHead(W, profile.name, `github.com/${github.username}`, 'building')}
    <g transform="translate(0 ${sceneY})">${aurora(W, sceneH)}</g><line x1="0" x2="${W}" y1="${sceneY + sceneH + .5}" y2="${sceneY + sceneH + .5}" stroke="${c.line}"/>
    <line x1="${split + .5}" x2="${split + .5}" y1="${sceneY + sceneH}" y2="${H}" stroke="${c.line}"/>
    <text x="26" y="354" class="sans display t1">${esc(clamp(profile.name, 16))}</text>
    <text x="26" y="381" class="sans body t2">${esc(clamp(profile.intro, 68))}</text>
    <text x="26" y="424" class="micro t3">Now</text><text x="86" y="424" class="code t1">${esc(clamp(profile.status, 52))}</text>
    <text x="26" y="452" class="micro t3">Handle</text><text x="86" y="452" class="code t1">${esc(clamp(profile.handle, 28))}</text>
    ${statCell(split, sceneY + sceneH, 172, 100, 'Repositories', compact(user.public_repos))}
    ${statCell(split + 172, sceneY + sceneH, W - split - 172, 100, 'Followers', compact(user.followers), true)}
    ${rankCell}
    ${statCell(split + 172, sceneY + sceneH + 100, W - split - 172, H - sceneY - sceneH - 100, 'Focus', profile.focus, true)}`;
  return shell(W, H, `${profile.name}: ${profile.intro}${rank ? ` #${rank.countryRank} open source contributor in ${rank.countryName}, #${rank.worldRank} worldwide.` : ''}`, body);
}

function statCell(x, y, width, height, label, value, rightEdge = false, valueClass = 't1', sub = '') {
  return `<g><line x1="${x}" x2="${x + width}" y1="${y + height + .5}" y2="${y + height + .5}" stroke="${c.line}"/><line x1="${x + width + .5}" x2="${x + width + .5}" y1="${y}" y2="${y + height}" stroke="${rightEdge ? 'none' : c.line}"/><text x="${x + 16}" y="${y + 27}" class="micro t3">${esc(label)}</text><text x="${x + 16}" y="${y + 62}" class="code ${valueClass}" font-size="24">${esc(clamp(value, 14))}</text>${sub ? `<text x="${x + 16}" y="${y + 84}" class="code-sm t3">${esc(clamp(sub, 24))}</text>` : ''}</g>`;
}

function projectSvg(repo) {
  const width = layout.projectColumns === 2 ? W / 2 : W;
  const banner = repo.__banner;
  const bannerHeight = banner ? projects.bannerHeight : 0;
  const offset = bannerHeight;
  const ctaLabel = repo.__options.ctaLabel;
  const showFooter = repo.__options.showRepoPath || ctaLabel != null;
  const H = (showFooter ? 240 : 198) + offset;
  const lines = wrap(repo.description, width < 600 ? 47 : 94, 2);
  const col = width / 3;
  const primary = Boolean(repo.__options.solidButton);
  const ctaText = ctaLabel == null ? '' : `${ctaLabel}${repo.__options.ctaArrow == null ? '' : ` ${repo.__options.ctaArrow}`}`;
  const ctaButtonText = clamp(ctaText, 18);
  const ctaButtonWidth = Math.min(width - 24, Math.max(150, Math.ceil(ctaButtonText.length * 7.3 + 64)));
  const ctaButtonX = width - 12 - ctaButtonWidth;
  const bannerVisual = banner?.kind === 'image'
    ? `<rect x="0" y="38" width="${width}" height="${bannerHeight}" fill="${c.well}"/><image x="0" y="38" width="${width}" height="${bannerHeight}" preserveAspectRatio="xMidYMid ${projects.bannerFit === 'cover' ? 'slice' : 'meet'}" href="data:${banner.mime};base64,${banner.data}"/>`
    : banner ? generatedProjectBanner(repo, width, bannerHeight) : '';
  const bannerMarkup = banner ? `${bannerVisual}<line x1="0" x2="${width}" y1="${38 + bannerHeight + .5}" y2="${38 + bannerHeight + .5}" stroke="${c.line}"/>` : '';
  const body = `${panelHead(width, repo.name, layout.showUpdatedAt ? `updated ${date(repo.updated_at)}` : '')}${bannerMarkup}
    <text x="20" y="${78 + offset}" class="sans title t1">${esc(clamp(repo.name, 28))}</text>
    <text x="20" y="${108 + offset}" class="sans body t2">${esc(lines[0] || '')}</text><text x="20" y="${128 + offset}" class="sans body t2">${esc(lines[1] || '')}</text>
    <line x1="0" x2="${width}" y1="${139.5 + offset}" y2="${139.5 + offset}" stroke="${c.line}"/>
    ${metaCell(0, 140 + offset, col, 'Language', repo.language || 'mixed')}${metaCell(col, 140 + offset, col, 'Stars', compact(repo.stargazers_count))}${metaCell(col * 2, 140 + offset, width - col * 2, 'Updated', date(repo.updated_at), true)}
    ${showFooter ? `<line x1="0" x2="${width}" y1="${197.5 + offset}" y2="${197.5 + offset}" stroke="${c.line}"/>${repo.__options.showRepoPath ? `<text x="12" y="${224 + offset}" class="code-sm t3">${esc(repo.full_name)}</text>` : ''}${ctaLabel == null ? '' : primary ? `<rect x="${ctaButtonX}" y="${204 + offset}" width="${ctaButtonWidth}" height="30" fill="${c.accent}" stroke="${c.buttonBorder || c.accent}"/><text x="${ctaButtonX + ctaButtonWidth / 2}" y="${224 + offset}" text-anchor="middle" class="label" fill="${c.buttonText || '#ffffff'}">${esc(ctaButtonText)}</text>` : `<text x="${width - 12}" y="${224 + offset}" text-anchor="end" class="label t2">${esc(clamp(ctaText, 20))}</text>`}` : ''}`;
  return shell(width, H, `${repo.full_name}: ${repo.description || 'GitHub repository'}`, body);
}

function generatedProjectBanner(repo, width, height) {
  const owner = repo.full_name.split('/')[0];
  const marks = Array.from({ length: Math.ceil(width / 12) }, (_, index) => `<rect x="${index * 12}" y="${height - 10 - (index % 5) * 7}" width="4" height="4" fill="${index % 3 ? c.selected : c.accent}"/>`).join('');
  return `<g transform="translate(0 38)"><rect width="${width}" height="${height}" fill="${c.well}"/><text x="18" y="34" class="micro t3">${esc(owner)}</text><text x="18" y="74" class="sans title t1">${esc(clamp(repo.name, 26))}</text><text x="18" y="101" class="code-sm t2">${esc(repo.language || 'repository')}</text>${marks}</g>`;
}

function metaCell(x, y, width, label, value, last = false) {
  return `<g>${last ? '' : `<line x1="${x + width + .5}" x2="${x + width + .5}" y1="${y}" y2="${y + 58}" stroke="${c.line}"/>`}<text x="${x + 14}" y="${y + 21}" class="micro t3">${esc(label)}</text><text x="${x + 14}" y="${y + 43}" class="code t1">${esc(clamp(value, 16))}</text></g>`;
}

function reposSvg(repos) {
  const headerH = 38;
  const headingsH = 32;
  const rowH = 52;
  const H = headerH + headingsH + repos.length * rowH;
  const rows = repos.map((repo, index) => {
    const y = headerH + headingsH + index * rowH;
    return `<line x1="0" x2="${W}" y1="${y + rowH + .5}" y2="${y + rowH + .5}" stroke="${c.lineFaint}"/><text x="12" y="${y + 31}" class="code t1">${esc(clamp(repo.name, 22))}</text><text x="225" y="${y + 31}" class="sans" font-size="13" fill="${c.text2}">${esc(clamp(repo.description || 'No description yet.', 48))}</text><text x="610" y="${y + 31}" class="code-sm t1">${esc(repo.language || 'mixed')}</text><text x="790" y="${y + 31}" class="code-sm t1">★ ${compact(repo.stargazers_count)}</text>`;
  }).join('');
  const headings = `<text x="12" y="59" class="micro t3">Repository</text><text x="225" y="59" class="micro t3">Description</text><text x="610" y="59" class="micro t3">Language</text><text x="790" y="59" class="micro t3">Stars</text>`;
  return shell(W, H, `More repositories by ${github.username}`, `${panelHead(W, 'more repositories', `${repos.length} selected`)}${headings}${rows}`);
}

function streakSvg(streak) {
  const top = 38;
  const rowH = 100;
  const cell = W / 3;
  const pitch = 15;
  const size = 11;
  const fills = [c.well, c.auroraPalette[1], c.auroraPalette[2], c.auroraPalette[4], c.auroraPalette[5]];
  const offset = new Date(`${streak.from}T00:00:00Z`).getUTCDay();
  const columns = Math.ceil((streak.levels.length + offset) / 7);
  const gridX = Math.round((W - columns * pitch + (pitch - size)) / 2);
  const gridY = top + rowH + 24;
  const H = gridY + 7 * pitch + 12;
  const squares = streak.levels.map((level, index) => {
    const slot = index + offset;
    return `<rect x="${gridX + Math.floor(slot / 7) * pitch}" y="${gridY + (slot % 7) * pitch}" width="${size}" height="${size}" fill="${fills[Math.min(level, 4)]}"/>`;
  }).join('');
  const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const span = (entry) => entry.length ? `${date(entry.start)} - ${date(entry.end)}` : 'no active streak';
  const body = `${panelHead(W, 'contribution streak', `${streak.from} to ${streak.to}`)}
    ${statCell(0, top, cell, rowH, 'Contributions', streak.total.toLocaleString('en'), false, 't1', 'last 12 months')}
    ${statCell(cell, top, cell, rowH, 'Current streak', days(streak.current.length), false, streak.current.length ? 'accent' : 't1', span(streak.current))}
    ${statCell(cell * 2, top, W - cell * 2, rowH, 'Longest streak', days(streak.longest.length), true, 't1', span(streak.longest))}
    ${squares}`;
  return shell(W, H, `${github.username} contribution streak: ${streak.total} contributions, current streak ${days(streak.current.length)}, longest ${days(streak.longest.length)}`, body);
}

function statsSvg(stats) {
  const top = 38;
  const rowH = 90;
  const cell = W / 4;
  const items = [['Stars earned', stats.stars], ['Commits', stats.commits], ['Pull requests', stats.pulls], ['Issues', stats.issues]];
  const cells = items.map(([label, value], index) => statCell(index * cell, top, cell, rowH, label, compact(value), index === items.length - 1)).join('');
  const y0 = top + rowH;
  const barX = 16;
  const barW = W - 32;
  const shades = [c.accent, c.auroraPalette[4], c.auroraPalette[3], c.auroraPalette[2], c.text3];
  let used = 0;
  let acc = 0;
  const segments = stats.languages.map((language, index) => {
    acc += language.share;
    const x = barX + used;
    const width = (index === stats.languages.length - 1 ? barW : Math.round(acc * barW)) - used;
    used += width;
    return `<rect x="${x}" y="${y0 + 40}" width="${width}" height="10" fill="${shades[index]}"/>`;
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

function readme(featured, more, links) {
  const reposAlt = `Selected repositories by ${github.username}: ${more.map((repo) => `${repo.name} (${repo.language || 'mixed'}, ${repo.stargazers_count} stars) ${repo.description || ''}`.trim()).join('; ')}`;
  const headerAlt = `${profile.name}, ${profile.role}. ${data.user.public_repos} repositories, ${data.user.followers} followers${data.rank ? `, #${data.rank.countryRank} open source contributor in ${data.rank.countryName}` : ''}`;
  const extras = [data.streak && 'streak', data.stats && 'stats'].filter(Boolean)
    .map((name) => `<a href="https://github.com/${github.username}"><img src="./profile/generated/${name}.svg?v=${assetVersion}" width="100%" alt="${esc(name === 'streak' ? `Contribution streak: ${data.streak.total} contributions in the past year, current streak ${data.streak.current.length} days, longest ${data.streak.longest.length} days` : `Stats: ${data.stats.stars} stars, ${data.stats.commits} commits, ${data.stats.pulls} pull requests, ${data.stats.issues} issues`)}"></a>\n\n`).join('');
  const cardWidth = layout.projectColumns === 2 ? '50%' : '100%';
  const separator = layout.projectColumns === 2 ? '' : '\n';
  const projects = featured.map((repo, index) => `<a href="${repo.__options.projectUrl?.trim() || repo.html_url}"><img src="./profile/generated/project-${String(index + 1).padStart(2, '0')}.svg?v=${assetVersion}" width="${cardWidth}" alt="${esc(repo.name)}: ${esc(repo.description || 'GitHub repository')}"></a>`).join(separator);
  const linkWidth = `${100 / links.length}%`;
  const linkCells = links.map((link, index) => `<a href="${link.url}"><img src="./profile/generated/link-${String(index + 1).padStart(2, '0')}.svg?v=${assetVersion}" width="${linkWidth}" alt="${esc(link.label)}"></a>`).join('');
  return `<!-- Generated by scripts/build-profile.mjs. Edit profile.config.json, not this file. -->
<p align="center"><img src="./profile/generated/header.svg?v=${assetVersion}" width="100%" alt="${esc(headerAlt)}"></p>

${projects}

<a href="https://github.com/${github.username}?tab=repositories"><img src="./profile/generated/repos.svg?v=${assetVersion}" width="100%" alt="${esc(reposAlt)}"></a>

${extras}<p align="center">${linkCells}</p>
`;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
async function fetchBannerImage(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 animated-profile-readme' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > 5_000_000) throw new Error('image exceeds 5 MB');
  const mime = (response.headers.get('content-type') || 'image/png').split(';')[0];
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) throw new Error(`unsupported content type ${mime}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000) throw new Error('image exceeds 5 MB');
  return { kind: 'image', mime, data: bytes.toString('base64') };
}

async function discoverOgImage(pageUrl) {
  const response = await fetch(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 animated-profile-readme' } });
  if (!response.ok) throw new Error(`repository page HTTP ${response.status}`);
  const html = await response.text();
  const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!match) throw new Error('og:image metadata not found');
  return new URL(match[1].replaceAll('&amp;', '&'), pageUrl).href;
}

async function loadBanner(option, repo) {
  if (!projects.bannersEnabled || !option.showBanner) return null;
  const custom = option.bannerUrl?.trim();
  const auto = projects.autoOgImages && option.autoOgImage;
  if (!custom && !auto) return { kind: 'generated' };
  try {
    const sourcePage = option.ogSourceUrl?.trim() || repo.html_url;
    const url = custom || await discoverOgImage(sourcePage);
    return await fetchBannerImage(url);
  } catch (error) {
    console.warn(`Using generated banner for ${repo.full_name}: ${error.message}`);
    return { kind: 'generated' };
  }
}

const featured = (await Promise.all(github.featuredRepos.map(async (entry) => {
  const option = featuredOption(entry);
  const repo = data.repos[option.repo];
  if (!repo) return null;
  return { ...repo, __options: option, __banner: await loadBanner(option, repo) };
}))).filter(Boolean);
const more = github.moreRepos.map((entry) => data.repos[repoKey(entry)]).filter(Boolean);
const links = profile.links.slice(0, 6);
assetVersion = createHash('sha256')
  .update(JSON.stringify(config))
  .update(JSON.stringify(data))
  .update(generatorSource)
  .update(monoFont)
  .update(featured.map((repo) => repo.__banner?.data || '').join(''))
  .digest('hex')
  .slice(0, 10);
await writeFile(path.join(OUT, 'header.svg'), headerSvg());
await Promise.all(featured.map((repo, index) => writeFile(path.join(OUT, `project-${String(index + 1).padStart(2, '0')}.svg`), projectSvg(repo))));
await writeFile(path.join(OUT, 'repos.svg'), reposSvg(more));
if (data.streak) await writeFile(path.join(OUT, 'streak.svg'), streakSvg(data.streak));
if (data.stats) await writeFile(path.join(OUT, 'stats.svg'), statsSvg(data.stats));
await Promise.all(links.map((link, index) => writeFile(path.join(OUT, `link-${String(index + 1).padStart(2, '0')}.svg`), linkSvg(link.label, W / links.length))));
await writeFile(path.join(ROOT, 'README.md'), readme(featured, more, links));
console.log(`Built Sodium profile for @${github.username}: ${featured.length} featured + ${more.length} more repositories.`);
