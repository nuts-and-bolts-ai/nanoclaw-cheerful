import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        default: {
            ...actual,
            readFileSync: vi.fn(),
        },
    };
});
vi.mock('./config.js', () => ({
    CHANNEL_ROUTING_PATH: '/mock/channel-routing.json',
}));
vi.mock('./logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
import fs from 'fs';
import { loadChannelRouting, resolveChannelFolder } from './channel-routing.js';
describe('channel-routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    describe('loadChannelRouting', () => {
        it('returns default config when file does not exist', () => {
            vi.mocked(fs.readFileSync).mockImplementation(() => {
                const err = new Error('ENOENT');
                err.code = 'ENOENT';
                throw err;
            });
            const config = loadChannelRouting();
            expect(config.routes).toEqual([]);
            expect(config.defaultFolderPrefix).toBe('slack-');
        });
        it('parses valid config file', () => {
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                routes: [
                    { match: 'assistant', folder: 'main', exact: true },
                    { match: 'cheerful', folder: 'cheerful' },
                ],
                defaultFolderPrefix: 'sl-',
            }));
            const config = loadChannelRouting();
            expect(config.routes).toHaveLength(2);
            expect(config.defaultFolderPrefix).toBe('sl-');
        });
        it('returns default config on invalid JSON', () => {
            vi.mocked(fs.readFileSync).mockReturnValue('not json');
            const config = loadChannelRouting();
            expect(config.routes).toEqual([]);
        });
    });
    describe('resolveChannelFolder', () => {
        it('matches exact route', () => {
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                routes: [
                    { match: 'assistant', folder: 'main', exact: true },
                ],
                defaultFolderPrefix: 'slack-',
            }));
            expect(resolveChannelFolder('assistant')).toBe('main');
        });
        it('does not match exact route on substring', () => {
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                routes: [
                    { match: 'assistant', folder: 'main', exact: true },
                ],
                defaultFolderPrefix: 'slack-',
            }));
            expect(resolveChannelFolder('assistant-2')).toBe('slack-assistant-2');
        });
        it('matches substring route', () => {
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                routes: [
                    { match: 'cheerful', folder: 'cheerful' },
                ],
                defaultFolderPrefix: 'slack-',
            }));
            expect(resolveChannelFolder('cheerful-marketing')).toBe('cheerful');
            expect(resolveChannelFolder('team-cheerful-ops')).toBe('cheerful');
        });
        it('returns prefixed channel name when no route matches', () => {
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                routes: [],
                defaultFolderPrefix: 'slack-',
            }));
            expect(resolveChannelFolder('random')).toBe('slack-random');
        });
        it('first matching route wins', () => {
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                routes: [
                    { match: 'cheerful-sales', folder: 'sales' },
                    { match: 'cheerful', folder: 'cheerful' },
                ],
                defaultFolderPrefix: 'slack-',
            }));
            expect(resolveChannelFolder('cheerful-sales')).toBe('sales');
        });
        it('sanitizes channel name for folder (replaces invalid chars)', () => {
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                routes: [],
                defaultFolderPrefix: 'slack-',
            }));
            // Channel names with dots or special chars should be sanitized
            expect(resolveChannelFolder('my.channel')).toBe('slack-my-channel');
        });
    });
});
//# sourceMappingURL=channel-routing.test.js.map