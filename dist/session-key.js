const SESSION_KEY_SEPARATOR = '::';
export function buildSessionKey(chatJid, threadTs) {
    if (threadTs)
        return `${chatJid}${SESSION_KEY_SEPARATOR}${threadTs}`;
    return chatJid;
}
export function parseSessionKey(sessionKey) {
    const idx = sessionKey.indexOf(SESSION_KEY_SEPARATOR);
    if (idx === -1)
        return { chatJid: sessionKey, threadTs: undefined };
    return {
        chatJid: sessionKey.slice(0, idx),
        threadTs: sessionKey.slice(idx + SESSION_KEY_SEPARATOR.length),
    };
}
//# sourceMappingURL=session-key.js.map