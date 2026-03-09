import { describe, it, expect } from 'vitest';
import { formatMessages } from './router.js';
describe('formatMessages with thread_ts', () => {
    it('includes thread_ts attribute on messages that have one', () => {
        const msgs = [
            {
                id: '1',
                chat_jid: 'slack:C123',
                sender: 'U001',
                sender_name: 'alice',
                content: '@Bot help',
                timestamp: '2026-03-09T00:00:00Z',
                thread_ts: '1234567890.123456',
            },
        ];
        const result = formatMessages(msgs, /^@Bot\b/);
        expect(result).toContain('thread="1234567890.123456"');
    });
    it('omits thread attribute for top-level messages', () => {
        const msgs = [
            {
                id: '2',
                chat_jid: 'slack:C123',
                sender: 'U001',
                sender_name: 'alice',
                content: '@Bot help',
                timestamp: '2026-03-09T00:00:00Z',
            },
        ];
        const result = formatMessages(msgs, /^@Bot\b/);
        expect(result).not.toContain('thread=');
    });
});
//# sourceMappingURL=thread-ipc.test.js.map