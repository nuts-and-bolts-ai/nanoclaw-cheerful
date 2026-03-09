export function escapeXml(s) {
    if (!s)
        return '';
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
export function formatMessages(messages, triggerPattern) {
    const lines = messages.map((m) => {
        const tag = triggerPattern && triggerPattern.test(m.content.trim())
            ? 'trigger'
            : 'message';
        const threadAttr = m.thread_ts ? ` thread="${escapeXml(m.thread_ts)}"` : '';
        return `<${tag} sender="${escapeXml(m.sender_name)}" time="${m.timestamp}"${threadAttr}>${escapeXml(m.content)}</${tag}>`;
    });
    return `<messages>\n${lines.join('\n')}\n</messages>`;
}
export function stripInternalTags(text) {
    return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}
/**
 * Convert markdown tables to Slack-friendly code blocks with aligned columns.
 * Slack doesn't render markdown tables, so we format them as monospace text.
 */
function convertMarkdownTables(text) {
    // Match consecutive lines that look like table rows (start/end with |)
    const lines = text.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
        // Check if this line starts a table (contains | delimiters)
        if (/^\s*\|/.test(lines[i]) && lines[i].includes('|')) {
            // Collect all consecutive table lines
            const tableLines = [];
            while (i < lines.length && /^\s*\|/.test(lines[i])) {
                // Skip separator rows (|---|---|)
                if (!/^\s*\|[\s\-:|]+\|\s*$/.test(lines[i])) {
                    tableLines.push(lines[i]);
                }
                i++;
            }
            if (tableLines.length > 0) {
                // Parse cells from each row
                const rows = tableLines.map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
                // Calculate max width per column
                const colCount = Math.max(...rows.map(r => r.length));
                const colWidths = Array(colCount).fill(0);
                for (const row of rows) {
                    for (let c = 0; c < row.length; c++) {
                        colWidths[c] = Math.max(colWidths[c], (row[c] || '').length);
                    }
                }
                // Format as aligned text in a code block
                const formatted = rows.map(row => row.map((cell, c) => (cell || '').padEnd(colWidths[c])).join('  '));
                result.push('```');
                result.push(...formatted);
                result.push('```');
            }
        }
        else {
            result.push(lines[i]);
            i++;
        }
    }
    return result.join('\n');
}
export function formatOutbound(rawText) {
    let text = stripInternalTags(rawText);
    if (!text)
        return '';
    text = convertMarkdownTables(text);
    return text;
}
export function routeOutbound(channels, jid, text) {
    const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
    if (!channel)
        throw new Error(`No channel for JID: ${jid}`);
    return channel.sendMessage(jid, text);
}
export function findChannel(channels, jid) {
    return channels.find((c) => c.ownsJid(jid));
}
//# sourceMappingURL=router.js.map