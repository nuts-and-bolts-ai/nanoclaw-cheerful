export interface ChannelRoute {
    match: string;
    folder: string;
    exact?: boolean;
}
export interface ChannelRoutingConfig {
    routes: ChannelRoute[];
    defaultFolderPrefix: string;
}
export declare function loadChannelRouting(pathOverride?: string): ChannelRoutingConfig;
export declare function resolveChannelFolder(channelName: string): string;
//# sourceMappingURL=channel-routing.d.ts.map