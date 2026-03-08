#!/usr/bin/env node
/**
 * Gmail IMAP Tool for NanoClaw agents.
 * Reads/searches Gmail via IMAP using App Passwords.
 *
 * Usage:
 *   gmail-tool search <account> <query> [--limit N]
 *   gmail-tool read <account> <uid>
 *   gmail-tool list <account> [--limit N]
 *   gmail-tool accounts
 *
 * Account credentials are read from environment variables:
 *   GMAIL_<ACCOUNT>_EMAIL, GMAIL_<ACCOUNT>_APP_PASSWORD
 *
 * Examples:
 *   gmail-tool accounts
 *   gmail-tool list flixr --limit 20
 *   gmail-tool search flixr "from:accountant subject:invoice" --limit 5
 *   gmail-tool read flixr 12345
 */

import { ImapFlow } from 'imapflow';

const ACCOUNTS = {};

// Discover accounts from env vars: GMAIL_<NAME>_EMAIL + GMAIL_<NAME>_APP_PASSWORD
for (const [key, value] of Object.entries(process.env)) {
  const match = key.match(/^GMAIL_([A-Z0-9_]+)_EMAIL$/);
  if (match && value) {
    const name = match[1].toLowerCase().replace(/_/g, '-');
    const pwKey = `GMAIL_${match[1]}_APP_PASSWORD`;
    const password = process.env[pwKey];
    if (password) {
      ACCOUNTS[name] = { email: value, password };
    }
  }
}

function getAccount(name) {
  const normalized = name.toLowerCase().replace(/_/g, '-');
  const account = ACCOUNTS[normalized];
  if (!account) {
    console.error(`Unknown account: ${name}`);
    console.error(`Available accounts: ${Object.keys(ACCOUNTS).join(', ') || 'none'}`);
    process.exit(1);
  }
  return account;
}

async function connect(account) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: account.email, pass: account.password },
    logger: false,
  });
  await client.connect();
  return client;
}

async function fetchMessages(client, uids) {
  const messages = [];
  for (const uid of uids) {
    try {
      const msg = await client.fetchOne(uid, {
        envelope: true,
        flags: true,
      });
      if (msg?.envelope) {
        messages.push({
          uid,
          subject: msg.envelope.subject || '(no subject)',
          from: msg.envelope.from?.map(a => `${a.name || ''} <${a.address}>`).join(', ') || 'unknown',
          to: msg.envelope.to?.map(a => `${a.name || ''} <${a.address}>`).join(', ') || '',
          date: msg.envelope.date?.toISOString() || '',
          flags: [...(msg.flags || [])],
        });
      }
    } catch (err) {
      // Skip messages that can't be fetched
    }
  }
  return messages;
}

/**
 * List recent emails (no search filter — just the latest N from INBOX).
 */
async function listEmails(accountName, limit = 10) {
  const account = getAccount(accountName);
  const client = await connect(account);

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const totalMessages = client.mailbox.exists;
      if (totalMessages === 0) {
        console.log(JSON.stringify({ account: accountName, email: account.email, results: [], total: 0 }));
        return;
      }

      // Fetch the last N messages by sequence number range
      const startSeq = Math.max(1, totalMessages - limit + 1);
      const range = `${startSeq}:${totalMessages}`;

      const messages = [];
      for await (const msg of client.fetch(range, { envelope: true, flags: true })) {
        if (msg?.envelope) {
          messages.push({
            uid: msg.uid,
            subject: msg.envelope.subject || '(no subject)',
            from: msg.envelope.from?.map(a => `${a.name || ''} <${a.address}>`).join(', ') || 'unknown',
            to: msg.envelope.to?.map(a => `${a.name || ''} <${a.address}>`).join(', ') || '',
            date: msg.envelope.date?.toISOString() || '',
            flags: [...(msg.flags || [])],
          });
        }
      }

      // Most recent first
      messages.reverse();

      console.log(JSON.stringify({
        account: accountName,
        email: account.email,
        results: messages,
        total: totalMessages,
        showing: messages.length,
      }, null, 2));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/**
 * Parse a Gmail-style query into IMAP search criteria.
 * Supports: from:, to:, subject:, is:unread, is:read, has:attachment,
 * newer_than:Nd, older_than:Nd, after:YYYY/MM/DD, before:YYYY/MM/DD,
 * and bare text as body search.
 */
function parseQuery(query) {
  const criteria = {};
  const bodyTerms = [];

  // Tokenize respecting quotes
  const tokens = [];
  const re = /(\w+):("[^"]*"|\S+)|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(query)) !== null) {
    if (m[1]) {
      tokens.push({ key: m[1], value: m[2].replace(/^"|"$/g, '') });
    } else {
      bodyTerms.push(m[3] || m[4]);
    }
  }

  for (const { key, value } of tokens) {
    switch (key.toLowerCase()) {
      case 'from':
        criteria.from = value;
        break;
      case 'to':
        criteria.to = value;
        break;
      case 'subject':
        criteria.subject = value;
        break;
      case 'is':
        if (value === 'unread') criteria.seen = false;
        else if (value === 'read') criteria.seen = true;
        break;
      case 'has':
        if (value === 'attachment') criteria.hasAttachment = true;
        break;
      case 'newer_than': {
        const days = parseInt(value);
        if (!isNaN(days)) {
          const d = new Date();
          d.setDate(d.getDate() - days);
          criteria.since = d;
        }
        break;
      }
      case 'older_than': {
        const days = parseInt(value);
        if (!isNaN(days)) {
          const d = new Date();
          d.setDate(d.getDate() - days);
          criteria.before = d;
        }
        break;
      }
      case 'after': {
        const d = new Date(value.replace(/\//g, '-'));
        if (!isNaN(d.getTime())) criteria.since = d;
        break;
      }
      case 'before': {
        const d = new Date(value.replace(/\//g, '-'));
        if (!isNaN(d.getTime())) criteria.before = d;
        break;
      }
      default:
        bodyTerms.push(`${key}:${value}`);
    }
  }

  if (bodyTerms.length > 0) {
    criteria.body = bodyTerms.join(' ');
  }

  return criteria;
}

async function searchEmails(accountName, query, limit = 10) {
  const account = getAccount(accountName);
  const client = await connect(account);

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const searchCriteria = parseQuery(query);

      // If no criteria parsed, fall back to listing recent
      if (Object.keys(searchCriteria).length === 0) {
        lock.release();
        await client.logout();
        return listEmails(accountName, limit);
      }

      const rawResults = await client.search(searchCriteria);
      const results = Array.from(rawResults || []);

      if (results.length === 0) {
        console.log(JSON.stringify({
          account: accountName,
          email: account.email,
          query,
          parsedCriteria: searchCriteria,
          results: [],
          total: 0,
        }));
        return;
      }

      // Get the most recent N messages
      const uids = results.slice(-limit).reverse();
      const messages = await fetchMessages(client, uids);

      console.log(JSON.stringify({
        account: accountName,
        email: account.email,
        query,
        results: messages,
        total: results.length,
        showing: messages.length,
      }, null, 2));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function readEmail(accountName, uid) {
  const account = getAccount(accountName);
  const client = await connect(account);

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const msg = await client.fetchOne(parseInt(uid), {
        uid: true,
        envelope: true,
        source: true,
      });

      if (!msg) {
        console.error(`Message ${uid} not found`);
        process.exit(1);
      }

      // Parse the raw email to extract text body
      const raw = msg.source;
      const { simpleParser } = await import('mailparser');
      const parsed = await simpleParser(raw);

      console.log(JSON.stringify({
        account: accountName,
        email: account.email,
        uid: parseInt(uid),
        subject: parsed.subject || '(no subject)',
        from: parsed.from?.text || 'unknown',
        to: parsed.to?.text || '',
        cc: parsed.cc?.text || '',
        date: parsed.date?.toISOString() || '',
        text: parsed.text || '',
        html: parsed.html ? '(HTML content available - text version shown above)' : '',
        attachments: (parsed.attachments || []).map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
      }, null, 2));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

try {
  switch (command) {
    case 'accounts':
      console.log(JSON.stringify(
        Object.entries(ACCOUNTS).map(([name, acc]) => ({ name, email: acc.email })),
        null, 2
      ));
      break;

    case 'list': {
      const account = args[1];
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;
      if (!account) {
        console.error('Usage: gmail-tool list <account> [--limit N]');
        process.exit(1);
      }
      await listEmails(account, limit);
      break;
    }

    case 'search': {
      const account = args[1];
      const query = args[2];
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;
      if (!account || !query) {
        console.error('Usage: gmail-tool search <account> <query> [--limit N]');
        process.exit(1);
      }
      await searchEmails(account, query, limit);
      break;
    }

    case 'read': {
      const account = args[1];
      const uid = args[2];
      if (!account || !uid) {
        console.error('Usage: gmail-tool read <account> <uid>');
        process.exit(1);
      }
      await readEmail(account, uid);
      break;
    }

    default:
      console.error('Usage: gmail-tool <list|search|read|accounts> [args]');
      console.error('Commands:');
      console.error('  accounts                              List configured accounts');
      console.error('  list <account> [--limit N]            List recent emails');
      console.error('  search <account> <query> [--limit N]  Search emails');
      console.error('  read <account> <uid>                  Read full email by UID');
      process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
