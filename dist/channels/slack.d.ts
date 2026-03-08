import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';
export interface SlackChannelOpts {
    onMessage: OnInboundMessage;
    onChatMetadata: OnChatMetadata;
    registeredGroups: () => Record<string, RegisteredGroup>;
    onRegisterGroup?: (jid: string, group: RegisteredGroup) => void;
}
export declare class SlackChannel implements Channel {
    name: string;
    private app;
    private botUserId;
    private connected;
    private outgoingQueue;
    private flushing;
    private userNameCache;
    private threadTargets;
    private opts;
    constructor(opts: SlackChannelOpts);
    private setupEventHandlers;
    connect(): Promise<void>;
    sendMessage(jid: string, text: string): Promise<void>;
    isConnected(): boolean;
    ownsJid(jid: string): boolean;
    disconnect(): Promise<void>;
    setTyping(_jid: string, _isTyping: boolean): Promise<void>;
    /**
     * Sync channel metadata from Slack.
     * Fetches channels the bot is a member of and stores their names in the DB.
     */
    syncChannelMetadata(): Promise<void>;
    private resolveChannelName;
    private resolveUserName;
    private flushOutgoingQueue;
}
//# sourceMappingURL=slack.d.ts.map