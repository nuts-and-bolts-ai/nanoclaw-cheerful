import { App, LogLevel } from '@slack/bolt';
import { resolveChannelFolder } from '../channel-routing.js';
import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { updateChatName } from '../db.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel } from './registry.js';
// Slack's chat.postMessage API limits text to ~4000 characters per call.
// Messages exceeding this are split into sequential chunks.
const MAX_MESSAGE_LENGTH = 4000;
export class SlackChannel {
    name = 'slack';
    app;
    botUserId;
    connected = false;
    outgoingQueue = [];
    flushing = false;
    userNameCache = new Map();
    threadTargets = new Map(); // jid -> ts to reply in thread
    activeThreads = new Map(); // jid -> set of thread parent ts where bot is active
    opts;
    constructor(opts) {
        this.opts = opts;
        // Read tokens from .env (not process.env — keeps secrets off the environment
        // so they don't leak to child processes, matching NanoClaw's security pattern)
        const env = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']);
        const botToken = env.SLACK_BOT_TOKEN;
        const appToken = env.SLACK_APP_TOKEN;
        if (!botToken || !appToken) {
            throw new Error('SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set in .env');
        }
        this.app = new App({
            token: botToken,
            appToken,
            socketMode: true,
            logLevel: LogLevel.ERROR,
        });
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        // Use app.event('message') instead of app.message() to capture all
        // message subtypes including bot_message (needed to track our own output)
        this.app.event('message', async ({ event }) => {
            // Bolt's event type is the full MessageEvent union (17+ subtypes).
            // We filter on subtype first, then narrow to the two types we handle.
            const subtype = event.subtype;
            if (subtype && subtype !== 'bot_message')
                return;
            // After filtering, event is either GenericMessageEvent or BotMessageEvent
            const msg = event;
            if (!msg.text)
                return;
            const jid = `slack:${msg.channel}`;
            const threadTs = msg.thread_ts;
            const isThreadReply = !!threadTs;
            const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
            const isGroup = msg.channel_type !== 'im';
            logger.info({ jid, text: msg.text?.slice(0, 50), channel: msg.channel }, 'Slack message received');
            // Always report metadata for group discovery
            this.opts.onChatMetadata(jid, timestamp, undefined, 'slack', isGroup);
            const isBotMessage = !!msg.bot_id || msg.user === this.botUserId;
            // Auto-register on @mention if unregistered
            const groups = this.opts.registeredGroups();
            if (!groups[jid]) {
                const isBotMentioned = this.botUserId &&
                    !isBotMessage &&
                    msg.text.includes(`<@${this.botUserId}>`);
                if (!isBotMentioned || !this.opts.onRegisterGroup) {
                    logger.debug({ jid }, 'Slack message from unregistered JID without bot mention, skipping');
                    return;
                }
                const channelName = await this.resolveChannelName(msg.channel);
                if (!channelName) {
                    logger.warn({ jid }, 'Could not resolve channel name for auto-registration');
                    return;
                }
                const folder = resolveChannelFolder(channelName);
                const newGroup = {
                    name: channelName,
                    folder,
                    trigger: `@${ASSISTANT_NAME}`,
                    added_at: new Date().toISOString(),
                    requiresTrigger: true,
                };
                logger.info({ jid, channelName, folder }, 'Auto-registering Slack channel on @mention');
                this.opts.onRegisterGroup(jid, newGroup);
            }
            let senderName;
            if (isBotMessage) {
                senderName = ASSISTANT_NAME;
            }
            else {
                senderName =
                    (msg.user ? await this.resolveUserName(msg.user) : undefined) ||
                        msg.user ||
                        'unknown';
            }
            // Translate Slack <@UBOTID> mentions into TRIGGER_PATTERN format.
            // Slack encodes @mentions as <@U12345>, which won't match TRIGGER_PATTERN
            // (e.g., ^@<ASSISTANT_NAME>\b), so we prepend the trigger when the bot is @mentioned.
            let content = msg.text;
            const isBotMentioned = !!(this.botUserId && !isBotMessage && msg.text.includes(`<@${this.botUserId}>`));
            if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
                content = `@${ASSISTANT_NAME} ${content}`;
            }
            // Thread tracking: @mention starts a thread, replies in active threads auto-trigger
            const group = groups[jid];
            if (group?.requiresTrigger && !isBotMessage && this.botUserId) {
                const jidThreads = this.activeThreads.get(jid);
                const isInActiveThread = isThreadReply && jidThreads?.has(threadTs);
                if (isBotMentioned) {
                    // Explicit @mention — track this thread as active
                    const threadParent = isThreadReply ? threadTs : msg.ts;
                    this.threadTargets.set(jid, threadParent);
                    if (!jidThreads) {
                        this.activeThreads.set(jid, new Set([threadParent]));
                    }
                    else {
                        jidThreads.add(threadParent);
                    }
                }
                else if (isInActiveThread) {
                    // Reply in an active bot thread — auto-trigger without @mention
                    this.threadTargets.set(jid, threadTs);
                    if (!TRIGGER_PATTERN.test(content)) {
                        content = `@${ASSISTANT_NAME} ${content}`;
                    }
                }
            }
            // Determine thread_ts for session tracking:
            // - Thread reply: use thread_ts (the parent message)
            // - Top-level @mention: use msg.ts (this message will be the thread parent)
            // - Other top-level: undefined
            const messageThreadTs = isThreadReply
                ? threadTs
                : isBotMentioned
                    ? msg.ts
                    : undefined;
            this.opts.onMessage(jid, {
                id: msg.ts,
                chat_jid: jid,
                sender: msg.user || msg.bot_id || '',
                sender_name: senderName,
                content,
                timestamp,
                is_from_me: isBotMessage,
                is_bot_message: isBotMessage,
                thread_ts: messageThreadTs,
            });
        });
    }
    async connect() {
        await this.app.start();
        // Get bot's own user ID for self-message detection.
        // Resolve this BEFORE setting connected=true so that messages arriving
        // during startup can correctly detect bot-sent messages.
        try {
            const auth = await this.app.client.auth.test();
            this.botUserId = auth.user_id;
            logger.info({ botUserId: this.botUserId }, 'Connected to Slack');
        }
        catch (err) {
            logger.warn({ err }, 'Connected to Slack but failed to get bot user ID');
        }
        this.connected = true;
        // Flush any messages queued before connection
        await this.flushOutgoingQueue();
        // Sync channel names on startup
        await this.syncChannelMetadata();
    }
    async sendMessage(jid, text) {
        const channelId = jid.replace(/^slack:/, '');
        if (!this.connected) {
            this.outgoingQueue.push({ jid, text });
            logger.info({ jid, queueSize: this.outgoingQueue.length }, 'Slack disconnected, message queued');
            return;
        }
        try {
            const thread_ts = this.threadTargets.get(jid);
            // Slack limits messages to ~4000 characters; split if needed
            if (text.length <= MAX_MESSAGE_LENGTH) {
                await this.app.client.chat.postMessage({
                    channel: channelId,
                    text,
                    thread_ts,
                });
            }
            else {
                for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
                    await this.app.client.chat.postMessage({
                        channel: channelId,
                        text: text.slice(i, i + MAX_MESSAGE_LENGTH),
                        thread_ts,
                    });
                }
            }
            // Thread target persists — replies in the same thread continue auto-triggering.
            // A new @mention in the channel starts a fresh thread.
            logger.info({ jid, length: text.length, threaded: !!thread_ts }, 'Slack message sent');
        }
        catch (err) {
            this.outgoingQueue.push({ jid, text });
            logger.warn({ jid, err, queueSize: this.outgoingQueue.length }, 'Failed to send Slack message, queued');
        }
    }
    isConnected() {
        return this.connected;
    }
    ownsJid(jid) {
        return jid.startsWith('slack:');
    }
    async disconnect() {
        this.connected = false;
        await this.app.stop();
    }
    // Slack does not expose a typing indicator API for bots.
    // This no-op satisfies the Channel interface so the orchestrator
    // doesn't need channel-specific branching.
    async setTyping(_jid, _isTyping) {
        // no-op: Slack Bot API has no typing indicator endpoint
    }
    /**
     * Sync channel metadata from Slack.
     * Fetches channels the bot is a member of and stores their names in the DB.
     */
    async syncChannelMetadata() {
        try {
            logger.info('Syncing channel metadata from Slack...');
            let cursor;
            let count = 0;
            do {
                const result = await this.app.client.conversations.list({
                    types: 'public_channel,private_channel',
                    exclude_archived: true,
                    limit: 200,
                    cursor,
                });
                for (const ch of result.channels || []) {
                    if (ch.id && ch.name && ch.is_member) {
                        updateChatName(`slack:${ch.id}`, ch.name);
                        count++;
                    }
                }
                cursor = result.response_metadata?.next_cursor || undefined;
            } while (cursor);
            logger.info({ count }, 'Slack channel metadata synced');
        }
        catch (err) {
            logger.error({ err }, 'Failed to sync Slack channel metadata');
        }
    }
    async resolveChannelName(channelId) {
        try {
            const result = await this.app.client.conversations.info({
                channel: channelId,
            });
            return result.channel?.name;
        }
        catch (err) {
            logger.warn({ channelId, err }, 'Failed to resolve channel name');
            return undefined;
        }
    }
    async resolveUserName(userId) {
        if (!userId)
            return undefined;
        const cached = this.userNameCache.get(userId);
        if (cached)
            return cached;
        try {
            const result = await this.app.client.users.info({ user: userId });
            const name = result.user?.real_name || result.user?.name;
            if (name)
                this.userNameCache.set(userId, name);
            return name;
        }
        catch (err) {
            logger.debug({ userId, err }, 'Failed to resolve Slack user name');
            return undefined;
        }
    }
    async flushOutgoingQueue() {
        if (this.flushing || this.outgoingQueue.length === 0)
            return;
        this.flushing = true;
        try {
            logger.info({ count: this.outgoingQueue.length }, 'Flushing Slack outgoing queue');
            while (this.outgoingQueue.length > 0) {
                const item = this.outgoingQueue.shift();
                const channelId = item.jid.replace(/^slack:/, '');
                await this.app.client.chat.postMessage({
                    channel: channelId,
                    text: item.text,
                });
                logger.info({ jid: item.jid, length: item.text.length }, 'Queued Slack message sent');
            }
        }
        finally {
            this.flushing = false;
        }
    }
}
registerChannel('slack', (opts) => {
    const envVars = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']);
    if (!envVars.SLACK_BOT_TOKEN || !envVars.SLACK_APP_TOKEN) {
        logger.warn('Slack: SLACK_BOT_TOKEN or SLACK_APP_TOKEN not set');
        return null;
    }
    return new SlackChannel(opts);
});
//# sourceMappingURL=slack.js.map