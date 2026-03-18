import { Channel, NewMessage } from './types.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  triggerPattern?: RegExp,
): string {
  const lines = messages.map((m) => {
    const tag =
      triggerPattern && triggerPattern.test(m.content.trim())
        ? 'trigger'
        : 'message';
    const threadAttr = m.thread_ts ? ` thread="${escapeXml(m.thread_ts)}"` : '';
    return `<${tag} sender="${escapeXml(m.sender_name)}" time="${m.timestamp}"${threadAttr}>${escapeXml(m.content)}</${tag}>`;
  });
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

/**
 * Convert markdown tables to Slack-friendly code blocks with aligned columns.
 * Slack doesn't render markdown tables, so we format them as monospace text.
 */
function convertMarkdownTables(text: string): string {
  // Match consecutive lines that look like table rows (start/end with |)
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check if this line starts a table (contains | delimiters)
    if (/^\s*\|/.test(lines[i]) && lines[i].includes('|')) {
      // Collect all consecutive table lines
      const tableLines: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        // Skip separator rows (|---|---|)
        if (!/^\s*\|[\s\-:|]+\|\s*$/.test(lines[i])) {
          tableLines.push(lines[i]);
        }
        i++;
      }

      if (tableLines.length > 0) {
        // Parse cells from each row
        const rows = tableLines.map(line =>
          line.split('|').slice(1, -1).map(cell => cell.trim().replace(/\*\*(.+?)\*\*/g, '$1'))
        );

        // Calculate max width per column
        const colCount = Math.max(...rows.map(r => r.length));
        const colWidths: number[] = Array(colCount).fill(0);
        for (const row of rows) {
          for (let c = 0; c < row.length; c++) {
            colWidths[c] = Math.max(colWidths[c], (row[c] || '').length);
          }
        }

        // Format as aligned text in a code block
        const formatted = rows.map(row =>
          row.map((cell, c) => (cell || '').padEnd(colWidths[c])).join('  ')
        );

        result.push('```');
        result.push(...formatted);
        result.push('```');
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Convert markdown formatting to Slack mrkdwn, skipping code blocks.
 * - **bold** → *bold*
 * - ### headings → *headings*
 * - --- horizontal rules → ───────
 */
function convertMarkdownToSlack(text: string): string {
  // Split by code blocks to avoid converting inside them
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    // Odd indices are code blocks — leave them alone
    if (i % 2 === 1) return part;

    // Convert **bold** to *bold* (Slack bold)
    part = part.replace(/\*\*(.+?)\*\*/g, '*$1*');

    // Convert ### headings to bold (any level)
    part = part.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

    // Convert --- horizontal rules to a unicode line
    part = part.replace(/^-{3,}$/gm, '───────────────────────────');

    return part;
  }).join('');
}

export function formatOutbound(rawText: string): string {
  let text = stripInternalTags(rawText);
  if (!text) return '';
  text = convertMarkdownTables(text);
  text = convertMarkdownToSlack(text);
  return text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
