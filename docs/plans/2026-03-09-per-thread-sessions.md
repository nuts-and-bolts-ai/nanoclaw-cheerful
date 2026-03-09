# Per-Thread Session Management

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep session context within Slack threads — same thread resumes session, new thread starts fresh — preventing unbounded context growth that slows agent responses.

**Architecture:** Thread identity flows from Slack channel → message DB → host piping path → IPC file → agent-runner. The agent-runner tracks the current thread and clears session state when the thread changes. The host stops passing stored sessionIds to new containers (always fresh on container start). The Slack channel's existing `threadTargets` map provides the thread_ts for each outgoing message.

**Tech Stack:** TypeScript, SQLite (messages table), Claude Agent SDK (`query()` with `resume`/`resumeSessionAt`)

---

### Task 1: Add thread_ts to NewMessage type and DB schema

**Files:**
- Modify: `src/types.ts:45-54` (NewMessage interface)
- Modify: `src/db.ts:26-37` (messages table schema + migration)

**Step 1: Write the failing test**

The existing test suite doesn't test thread_ts storage directly, but we need a test that verifies thread_ts round-trips through the DB.

Create: `src/db-thread.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, storeMessage, getMessagesSince } from './db.js';

describe('thread_ts storage', () => {
  beforeEach(() => {
    initDatabase(':memory:');
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db-thread.test.ts`
Expected: FAIL — `thread_ts` doesn't exist on NewMessage type

**Step 3: Add thread_ts to NewMessage type**

In `src/types.ts`, add `thread_ts` to the `NewMessage` interface:

```typescript
export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  thread_ts?: string; // Slack thread parent timestamp (undefined = top-level message)
}
```

**Step 4: Add thread_ts column to DB and update storeMessage/getMessagesSince**

In `src/db.ts`, add a migration to add the column (after the existing migrations, around line 130):

```typescript
    // Add thread_ts column for per-thread session tracking
    const hasThreadTs = db
      .prepare(`PRAGMA table_info(messages)`)
      .all()
      .some((col: { name: string }) => col.name === 'thread_ts');
    if (!hasThreadTs) {
      db.exec(`ALTER TABLE messages ADD COLUMN thread_ts TEXT`);
    }
```

Update `storeMessage` to include thread_ts in the INSERT (find the existing INSERT statement and add the column):

The INSERT currently looks like:
```sql
INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```

Change to:
```sql
INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, thread_ts)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
```

And add `msg.thread_ts ?? null` as the 9th bind parameter.

Update `getMessagesSince` to include `thread_ts` in the SELECT and map it onto the returned objects. The SELECT currently reads columns positionally — add `thread_ts` to the select list and include it in the mapping:

```typescript
thread_ts: row.thread_ts || undefined,
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/db-thread.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types.ts src/db.ts src/db-thread.test.ts
git commit -m "feat: add thread_ts to message storage for per-thread sessions"
```

---

### Task 2: Pass thread_ts from Slack channel to stored messages

**Files:**
- Modify: `src/channels/slack.ts:86-196` (event handler)
- Modify: `src/channels/slack.test.ts` (add thread_ts test cases)

**Step 1: Write the failing test**

Add to `src/channels/slack.test.ts`, in the message handling describe block:

```typescript
it('passes thread_ts to onMessage for thread replies', async () => {
  const channel = new SlackChannel(opts);
  await channel.connect();

  await simulateMessage({
    text: `<@${BOT_USER_ID}> help`,
    user: 'U_SENDER',
    channel: 'C0123456789',
    ts: '1111.2222',
    thread_ts: '1111.0000',
    channel_type: 'channel',
  });

  expect(onMessage).toHaveBeenCalledWith(
    'slack:C0123456789',
    expect.objectContaining({
      thread_ts: '1111.0000',
    }),
  );
});

it('passes message ts as thread_ts for top-level @mentions (thread starter)', async () => {
  const channel = new SlackChannel(opts);
  await channel.connect();

  await simulateMessage({
    text: `<@${BOT_USER_ID}> help`,
    user: 'U_SENDER',
    channel: 'C0123456789',
    ts: '2222.3333',
    channel_type: 'channel',
  });

  expect(onMessage).toHaveBeenCalledWith(
    'slack:C0123456789',
    expect.objectContaining({
      thread_ts: '2222.3333',
    }),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/channels/slack.test.ts -t "thread_ts"`
Expected: FAIL — thread_ts not in the onMessage call

**Step 3: Update Slack channel to pass thread_ts**

In `src/channels/slack.ts`, in the `setupEventHandlers` method, update the `this.opts.onMessage` call (around line 186) to include `thread_ts`. The thread_ts for the stored message should be:
- For thread replies: the `thread_ts` from the Slack event (the parent message ts)
- For top-level @mentions that start a thread: the message's own `ts` (since this will become the thread parent)
- For other top-level messages: `undefined`

Find the `this.opts.onMessage(jid, {` call and update it:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/channels/slack.test.ts -t "thread_ts"`
Expected: PASS

**Step 5: Run full Slack test suite to check for regressions**

Run: `npx vitest run src/channels/slack.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/channels/slack.ts src/channels/slack.test.ts
git commit -m "feat: pass thread_ts from Slack events to message storage"
```

---

### Task 3: Include thread_ts in IPC messages and formatted prompts

**Files:**
- Modify: `src/group-queue.ts:203-221` (sendMessage method)
- Modify: `src/index.ts:409-437` (piping path in message loop)
- Modify: `src/router.ts:12-24` (formatMessages)

**Step 1: Write the failing test**

Add to a new file `src/thread-ipc.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatMessages } from './router.js';
import type { NewMessage } from './types.js';

describe('formatMessages with thread_ts', () => {
  it('includes thread_ts attribute on messages that have one', () => {
    const msgs: NewMessage[] = [
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
    const msgs: NewMessage[] = [
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/thread-ipc.test.ts`
Expected: FAIL — no thread attribute in output

**Step 3: Update formatMessages to include thread_ts**

In `src/router.ts`, update `formatMessages`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/thread-ipc.test.ts`
Expected: PASS

**Step 5: Update IPC sendMessage to include thread_ts metadata**

In `src/group-queue.ts`, update `sendMessage` to accept and pass thread_ts:

```typescript
  sendMessage(groupJid: string, text: string, threadTs?: string): boolean {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder || state.isTaskContainer)
      return false;
    state.idleWaiting = false;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text, threadTs }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch {
      return false;
    }
  }
```

**Step 6: Update piping path in index.ts to extract and pass thread_ts**

In `src/index.ts`, in the message loop piping path (around line 424), extract the thread_ts from the last trigger message and pass it to `queue.sendMessage`:

```typescript
          // Extract thread_ts from the trigger message for session tracking
          const triggerMsg = messagesToSend.find(
            (m) => TRIGGER_PATTERN.test(m.content.trim()),
          );
          const threadTs = triggerMsg?.thread_ts;

          if (queue.sendMessage(chatJid, formatted, threadTs)) {
```

**Step 7: Run all tests**

Run: `npx vitest run`
Expected: All pass

**Step 8: Commit**

```bash
git add src/router.ts src/group-queue.ts src/index.ts src/thread-ipc.test.ts
git commit -m "feat: include thread_ts in formatted messages and IPC"
```

---

### Task 4: Agent-runner tracks thread and clears session on thread change

**Files:**
- Modify: `container/agent-runner/src/index.ts:297-327` (drainIpcInput)
- Modify: `container/agent-runner/src/index.ts:530-590` (main query loop)

**Step 1: Update drainIpcInput to return thread metadata**

Currently `drainIpcInput()` returns `string[]`. Change it to return objects with text and optional threadTs:

```typescript
interface IpcMessage {
  text: string;
  threadTs?: string;
}

function drainIpcInput(): IpcMessage[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    const messages: IpcMessage[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push({ text: data.text, threadTs: data.threadTs });
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
```

**Step 2: Update waitForIpcMessage to return thread metadata**

```typescript
function waitForIpcMessage(): Promise<IpcMessage | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        // Combine multiple pending messages, use the threadTs from the last one
        const combined: IpcMessage = {
          text: messages.map(m => m.text).join('\n'),
          threadTs: messages[messages.length - 1].threadTs,
        };
        resolve(combined);
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}
```

**Step 3: Update MessageStream.push and IPC piping to handle IpcMessage**

The `pollIpcDuringQuery` callback and `MessageStream` need minor updates. `MessageStream.push` stays as `push(text: string)` since the SDK only takes text. The IPC polling during a query doesn't need thread tracking (it's for messages arriving while a query is already running for the same thread). Only the between-query loop needs thread logic.

Update `pollIpcDuringQuery` in `runQuery`:

```typescript
    const messages = drainIpcInput();
    for (const msg of messages) {
      log(`Piping IPC message into active query (${msg.text.length} chars)`);
      stream.push(msg.text);
    }
```

**Step 4: Update the main query loop to track thread and clear session on change**

In the `main()` function, update the query loop:

```typescript
  // Track current thread for session continuity.
  // Same thread = resume session. Different thread = fresh session.
  let currentThreadTs: string | undefined;

  // Extract thread_ts from the initial prompt's XML if present
  const initialThreadMatch = containerInput.prompt.match(/thread="([^"]+)"/);
  currentThreadTs = initialThreadMatch?.[1];

  // Query loop: run query → wait for IPC message → run new query → repeat
  let resumeAt: string | undefined;
  try {
    while (true) {
      log(`Starting query (session: ${sessionId || 'new'}, thread: ${currentThreadTs || 'none'}, resumeAt: ${resumeAt || 'latest'})...`);

      const queryResult = await runQuery(prompt, sessionId, mcpServerPath, containerInput, sdkEnv, resumeAt);
      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }

      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      // Check if thread changed — if so, start a fresh session
      const newThreadTs = nextMessage.threadTs;
      if (newThreadTs !== currentThreadTs) {
        log(`Thread changed (${currentThreadTs || 'none'} -> ${newThreadTs || 'none'}), starting fresh session`);
        sessionId = undefined;
        resumeAt = undefined;
        currentThreadTs = newThreadTs;
      } else {
        log(`Same thread (${currentThreadTs || 'none'}), resuming session`);
      }

      prompt = nextMessage.text;
    }
```

**Step 5: Build and verify**

Run: `cd container/agent-runner && npm run build && cd ../..`
Expected: Compiles without errors

**Step 6: Commit**

```bash
git add container/agent-runner/src/index.ts
git commit -m "feat: agent-runner tracks thread, clears session on thread change"
```

---

### Task 5: Host stops passing stored sessionId to new containers

**Files:**
- Modify: `src/index.ts:270-274` (runAgent sessionId)

**Step 1: Write the failing test — not needed**

This is a one-line change with clear behavior. The existing tests cover the flow.

**Step 2: Update runAgent to not pass stored sessionId**

In `src/index.ts`, in the `runAgent` function, change line 271 from:

```typescript
  const sessionId = sessions[group.folder];
```

to:

```typescript
  // Always start fresh sessions for new containers.
  // The SDK's auto-memory (MEMORY.md) handles cross-session continuity.
  // Per-thread resume is handled inside the agent-runner via IPC thread metadata.
  const sessionId = undefined;
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: new containers always start fresh sessions"
```

---

### Task 6: Add acknowledgment in the piping path

**Files:**
- Modify: `src/index.ts:424-437` (piping path)

This addresses the original observation that piped messages don't get an "On it" acknowledgment.

**Step 1: Add acknowledgment before piping**

In `src/index.ts`, in the piping path (after the `if (queue.sendMessage(...))` check), add the acknowledgment. Find:

```typescript
          if (queue.sendMessage(chatJid, formatted, threadTs)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
```

Add acknowledgment before the `queue.sendMessage` call:

```typescript
          // Send acknowledgment for piped messages (same as new container path)
          channel
            .sendMessage(chatJid, 'On it — give me a moment.')
            .catch((err) =>
              logger.warn({ chatJid, err }, 'Failed to send piped ack'),
            );

          if (queue.sendMessage(chatJid, formatted, threadTs)) {
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: send acknowledgment for piped messages too"
```

---

### Task 7: Deploy and verify

**Step 1: Push and deploy**

```bash
git push origin main
# Agent-runner changed, so rebuild container
ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw && git pull && ./container/build.sh && npm run build && systemctl --user restart nanoclaw"
```

**Step 2: Kill stale containers and clear sessions**

```bash
ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
ssh nanoclaw@46.225.110.16 "sqlite3 ~/nanoclaw/store/messages.db 'DELETE FROM sessions'"
ssh nanoclaw@46.225.110.16 "systemctl --user restart nanoclaw"
```

**Step 3: Verify service is running**

```bash
ssh nanoclaw@46.225.110.16 "systemctl --user status nanoclaw"
ssh nanoclaw@46.225.110.16 "tail -20 ~/nanoclaw/logs/nanoclaw.log"
```

**Step 4: Test — send @Cheerful message in cheerful-ai channel**

- Verify: acknowledgment message appears
- Verify: container logs show `session: new, thread: <ts>`
- Verify: response arrives faster than before (no 870KB context)

**Step 5: Test — reply in same thread**

- Verify: container logs show `Same thread (<ts>), resuming session`
- Verify: agent has context from the previous message

**Step 6: Test — send @Cheerful in a new thread**

- Verify: container logs show `Thread changed (...), starting fresh session`
- Verify: new session starts without prior thread's context
