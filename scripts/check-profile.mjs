import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'profile.config.json'), 'utf8'));
const requiredColors = ['page', 'panel', 'well', 'text1', 'text2', 'text3', 'line', 'lineFaint', 'accent', 'selected', 'ok', 'warn', 'fail', 'languageFallback'];
const missing = requiredColors.filter((key) => !config.theme?.[key]);
if (missing.length) throw new Error(`Missing theme colors: ${missing.join(', ')}`);
if (!Array.isArray(config.theme?.auroraPalette) || config.theme.auroraPalette.length < 2) throw new Error('theme.auroraPalette needs at least two colors');
if (!config.github?.username) throw new Error('github.username is required');
if (!Array.isArray(config.profile?.links) || config.profile.links.length < 1 || config.profile.links.length > 6) throw new Error('profile.links must contain between one and six links');
if (!Array.isArray(config.github.featuredRepos) || !config.github.featuredRepos.length) throw new Error('Choose at least one github.featuredRepos entry');
const featuredKeys = config.github.featuredRepos.map((entry) => typeof entry === 'string' ? entry : entry?.repo);
if (featuredKeys.some((key) => !key)) throw new Error('Every github.featuredRepos entry needs a repo');
if (new Set(featuredKeys).size !== featuredKeys.length) throw new Error('github.featuredRepos contains duplicates');
for (const entry of config.github.featuredRepos.filter((item) => typeof item === 'object')) {
  if (typeof entry.solidButton !== 'boolean' || typeof entry.showBanner !== 'boolean' || typeof entry.autoOgImage !== 'boolean') throw new Error(`Featured repo ${entry.repo} is missing a boolean option`);
  if (entry.ctaLabel !== null && (typeof entry.ctaLabel !== 'string' || !entry.ctaLabel.trim())) throw new Error(`Featured repo ${entry.repo} ctaLabel must be text or null`);
  if (entry.ctaArrow !== null && typeof entry.ctaArrow !== 'string') throw new Error(`Featured repo ${entry.repo} ctaArrow must be text or null`);
  if (typeof entry.showRepoPath !== 'boolean') throw new Error(`Featured repo ${entry.repo} showRepoPath must be boolean`);
  for (const field of ['projectUrl', 'ogSourceUrl', 'bannerUrl']) {
    if (entry[field] && !URL.canParse(entry[field])) throw new Error(`Featured repo ${entry.repo} has an invalid ${field}`);
  }
}
if (!config.projects || typeof config.projects.bannersEnabled !== 'boolean' || typeof config.projects.autoOgImages !== 'boolean') throw new Error('projects banner booleans are required');
if ((config.projects.bannerHeight || 0) < 112 || config.projects.bannerHeight > 320) throw new Error('projects.bannerHeight must be between 112 and 320');
if (!['contain', 'cover'].includes(config.projects.bannerFit)) throw new Error('projects.bannerFit must be contain or cover');
if ((config.motion?.speed || 0) <= 0) throw new Error('motion.speed must be greater than zero');
if ((config.motion?.auroraFps || 0) < 1 || config.motion.auroraFps > 60) throw new Error('motion.auroraFps must be between 1 and 60');
if (![1, 2].includes(config.layout?.projectColumns)) throw new Error('layout.projectColumns must be 1 or 2');
if (!Number.isInteger(config.layout?.width) || config.layout.width < 880 || config.layout.width > 1200) throw new Error('layout.width must be an integer from 880 to 1200');
if ((config.motion?.auroraDuration || 0) <= 0 || config.motion.auroraDuration > 30) throw new Error('motion.auroraDuration must be greater than zero and at most 30');
const hex = /^#[0-9a-fA-F]{6}$/;
if (!config.theme.auroraPalette.every((color) => typeof color === 'string' && hex.test(color))) throw new Error('theme.auroraPalette entries must be #RRGGBB colors');
const badTheme = Object.entries(config.theme).filter(([key, value]) => key !== 'auroraPalette' && typeof value !== 'string').map(([key]) => key);
if (badTheme.length) throw new Error(`theme colors must be strings: ${badTheme.join(', ')}`);
if (config.rank?.enabled && !/^[A-Za-z]{2}$/.test(config.rank.country || '')) throw new Error('rank.country must be a two-letter country code');
console.log('profile.config.json looks good.');
