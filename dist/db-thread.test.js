import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase, storeChatMetadata, storeMessage, getMessagesSince, } from './db.js';
describe('thread_ts storage', () => {
    beforeEach(() => {
        _initTestDatabase();
        storeChatMetadata('slack:C123', '2026-03-09T00:00:00Z');
    });
    it('stores and retrieves thread_ts on messages', () => {
        storeMessage({
            id: 'msg1',
            chat_jid: 'slack:C123',
            sender: 'U001',
            sender_name: 'alice',
            content: 'hello',
            timestamp: '2026-03-09T00:00:00Z',
            thread_ts: '1234567890.123456',
        });
        const msgs = getMessagesSince('slack:C123', '', 'Bot');
        expect(msgs).toHaveLength(1);
        expect(msgs[0].thread_ts).toBe('1234567890.123456');
    });
    it('returns undefined thread_ts for messages without one', () => {
        storeMessage({
            id: 'msg2',
            chat_jid: 'slack:C123',
            sender: 'U001',
            sender_name: 'alice',
            content: 'top-level',
            timestamp: '2026-03-09T00:00:01Z',
        });
        const msgs = getMessagesSince('slack:C123', '', 'Bot');
        expect(msgs).toHaveLength(1);
        expect(msgs[0].thread_ts).toBeUndefined();
    });
});
//# sourceMappingURL=db-thread.test.js.map