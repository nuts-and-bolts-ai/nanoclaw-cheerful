import fs from 'fs';

import { CHANNEL_ROUTING_PATH } from './config.js';
import { logger } from './logger.js';

export interface ChannelRoute {
  match: string;
  folder: string;
  exact?: boolean;
}

export interface ChannelRoutingConfig {
  routes: ChannelRoute[];
  defaultFolderPrefix: string;
}

const DEFAULT_CONFIG: ChannelRoutingConfig = {
  routes: [],
  defaultFolderPrefix: 'slack-',
};

export function loadChannelRouting(
  pathOverride?: string,
): ChannelRoutingConfig {
  const filePath = pathOverride ?? CHANNEL_ROUTING_PATH;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG;
    logger.warn({ err, path: filePath }, 'channel-routing: cannot read config');
    return DEFAULT_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ path: filePath }, 'channel-routing: invalid JSON');
    return DEFAULT_CONFIG;
  }

  const obj = parsed as Record<string, unknown>;
  const routes: ChannelRoute[] = [];

  if (Array.isArray(obj.routes)) {
    for (const r of obj.routes) {
      if (
        r &&
        typeof r === 'object' &&
        typeof r.match === 'string' &&
        typeof r.folder === 'string'
      ) {
        routes.push({
          match: r.match,
          folder: r.folder,
          exact: r.exact === true ? true : undefined,
        });
      }
    }
  }

  return {
    routes,
    defaultFolderPrefix:
      typeof obj.defaultFolderPrefix === 'string'
        ? obj.defaultFolderPrefix
        : 'slack-',
  };
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 64) || 'unknown';
}

export function resolveChannelFolder(channelName: string): string {
  const config = loadChannelRouting();

  for (const route of config.routes) {
    if (route.exact) {
      if (channelName === route.match) return route.folder;
    } else {
      if (channelName.includes(route.match)) return route.folder;
    }
  }

  return `${config.defaultFolderPrefix}${sanitizeFolderName(channelName)}`;
}
