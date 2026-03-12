import { execSync } from 'child_process';
import http from 'http';

import { DASHBOARD_PORT } from './config.js';
import { getAllTasks, getRecentMessages, deleteTask } from './db.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

interface DashboardDeps {
  queue: GroupQueue;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

function getMessageCount(containerName: string): number {
  try {
    const out = execSync(
      `docker logs ${containerName} 2>&1 | grep -c '\\[msg #'`,
      { timeout: 5000 },
    );
    return parseInt(out.toString().trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function getLastOutputTime(containerName: string): string | null {
  try {
    const out = execSync(
      `docker logs ${containerName} 2>&1 | grep 'OUTPUT_END' | tail -1`,
      { timeout: 5000 },
    );
    const line = out.toString().trim();
    return line ? new Date().toISOString() : null;
  } catch {
    return null;
  }
}

function killContainer(containerName: string): boolean {
  try {
    execSync(`docker kill ${containerName}`, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function getActiveTasksData(deps: DashboardDeps) {
  const containers = deps.queue.getRunningContainers();
  const groups = deps.registeredGroups();

  return containers.map((c) => {
    const group = groups[c.groupJid];
    const groupName = group?.name || c.groupFolder || c.groupJid;

    // Extract thread_ts from groupFolder if it's a thread session
    // Format: {folder}/threads/{threadTs}
    let threadTs: string | undefined;
    if (c.groupFolder?.includes('/threads/')) {
      threadTs = c.groupFolder.split('/threads/')[1];
    }

    const recentMsgs = getRecentMessages(c.groupJid, threadTs, 3);
    const triggerMessage =
      recentMsgs.length > 0
        ? recentMsgs
            .map((m) => `${m.sender_name}: ${m.content}`)
            .join(' | ')
        : c.isTaskContainer
          ? `[Scheduled task: ${c.runningTaskId || 'unknown'}]`
          : '[No trigger message found]';

    const messageCount = getMessageCount(c.containerName);

    return {
      groupName,
      containerName: c.containerName,
      triggerMessage:
        triggerMessage.length > 200
          ? triggerMessage.slice(0, 200) + '...'
          : triggerMessage,
      startedAt: c.startedAt,
      isTaskContainer: c.isTaskContainer,
      runningTaskId: c.runningTaskId,
      messageCount,
    };
  });
}

function getScheduledTasksData() {
  const tasks = getAllTasks();
  return tasks.map((t) => ({
    id: t.id,
    prompt:
      t.prompt.length > 100 ? t.prompt.slice(0, 100) + '...' : t.prompt,
    groupFolder: t.group_folder,
    scheduleType: t.schedule_type,
    scheduleValue: t.schedule_value,
    nextRun: t.next_run,
    lastRun: t.last_run,
    lastResult: t.last_result,
    status: t.status,
  }));
}

function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: DashboardDeps,
): boolean {
  const url = req.url || '/';

  if (url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getActiveTasksData(deps)));
    return true;
  }

  if (url === '/api/scheduled' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getScheduledTasksData()));
    return true;
  }

  // POST /api/tasks/{containerName}/kill
  const killMatch = url.match(/^\/api\/tasks\/(.+)\/kill$/);
  if (killMatch && req.method === 'POST') {
    const containerName = decodeURIComponent(killMatch[1]);
    const success = killContainer(containerName);
    res.writeHead(success ? 200 : 500, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ success }));
    return true;
  }

  // POST /api/scheduled/{id}/cancel
  const cancelMatch = url.match(/^\/api\/scheduled\/(.+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    const taskId = decodeURIComponent(cancelMatch[1]);
    try {
      deleteTask(taskId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: String(err),
        }),
      );
    }
    return true;
  }

  return false;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>NanoClaw Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; padding: 24px; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 24px; color: #fff; }
  h2 { font-size: 15px; font-weight: 600; margin: 24px 0 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta { font-size: 12px; color: #8b949e; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #21262d; }
  td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #21262d; vertical-align: top; }
  tr:hover td { background: #161b22; }
  .trigger { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c9d1d9; }
  .trigger:hover { white-space: normal; word-break: break-word; }
  .duration { font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
  .badge-active { background: #1f6feb33; color: #58a6ff; }
  .badge-paused { background: #d2992233; color: #d29922; }
  .badge-completed { background: #23863633; color: #3fb950; }
  .badge-task { background: #8b5cf633; color: #a78bfa; }
  .empty { color: #484f58; font-style: italic; padding: 20px; text-align: center; }
  button { padding: 4px 12px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #c9d1d9; font-size: 12px; cursor: pointer; }
  button:hover { background: #30363d; border-color: #8b949e; }
  button.danger { border-color: #f8514966; color: #f85149; }
  button.danger:hover { background: #f8514922; border-color: #f85149; }
  .refresh-bar { display: flex; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
<div class="refresh-bar">
  <h1>NanoClaw Dashboard</h1>
  <div class="meta">Auto-refreshes every 30s &mdash; <span id="last-refresh"></span></div>
</div>

<h2>Active Tasks</h2>
<div id="active-tasks"></div>

<h2>Scheduled Tasks</h2>
<div id="scheduled-tasks"></div>

<script>
function ago(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

let activeData = [];

function renderActive(data) {
  activeData = data;
  const el = document.getElementById('active-tasks');
  if (!data.length) {
    el.innerHTML = '<div class="empty">No active tasks</div>';
    return;
  }
  let html = '<table><tr><th>Group</th><th>Trigger</th><th>Started</th><th>Duration</th><th>Msgs</th><th>Type</th><th></th></tr>';
  for (const t of data) {
    const started = new Date(t.startedAt).toLocaleTimeString();
    const duration = ago(Date.now() - t.startedAt);
    const type = t.isTaskContainer ? '<span class="badge badge-task">Scheduled</span>' : '<span class="badge badge-active">Message</span>';
    html += '<tr>'
      + '<td>' + escapeHtml(t.groupName) + '</td>'
      + '<td class="trigger" title="' + escapeHtml(t.triggerMessage) + '">' + escapeHtml(t.triggerMessage) + '</td>'
      + '<td>' + started + '</td>'
      + '<td class="duration" data-started="' + t.startedAt + '">' + duration + '</td>'
      + '<td>' + t.messageCount + '</td>'
      + '<td>' + type + '</td>'
      + '<td><button class="danger" onclick="killTask(\\'' + escapeHtml(t.containerName) + '\\')">Kill</button></td>'
      + '</tr>';
  }
  html += '</table>';
  el.innerHTML = html;
}

function renderScheduled(data) {
  const el = document.getElementById('scheduled-tasks');
  if (!data.length) {
    el.innerHTML = '<div class="empty">No scheduled tasks</div>';
    return;
  }
  let html = '<table><tr><th>Prompt</th><th>Group</th><th>Schedule</th><th>Next Run</th><th>Status</th><th>Last Result</th><th></th></tr>';
  for (const t of data) {
    const schedule = t.scheduleType === 'cron' ? t.scheduleValue : t.scheduleType + ': ' + t.scheduleValue;
    const nextRun = t.nextRun ? new Date(t.nextRun).toLocaleString() : '-';
    const badgeClass = t.status === 'active' ? 'badge-active' : t.status === 'paused' ? 'badge-paused' : 'badge-completed';
    const lastResult = t.lastResult ? (t.lastResult.length > 60 ? t.lastResult.slice(0, 60) + '...' : t.lastResult) : '-';
    html += '<tr>'
      + '<td class="trigger" title="' + escapeHtml(t.prompt) + '">' + escapeHtml(t.prompt) + '</td>'
      + '<td>' + escapeHtml(t.groupFolder) + '</td>'
      + '<td>' + escapeHtml(schedule) + '</td>'
      + '<td>' + nextRun + '</td>'
      + '<td><span class="badge ' + badgeClass + '">' + t.status + '</span></td>'
      + '<td class="trigger" title="' + escapeHtml(lastResult) + '">' + escapeHtml(lastResult) + '</td>'
      + '<td><button class="danger" onclick="cancelTask(\\'' + t.id + '\\')">Cancel</button></td>'
      + '</tr>';
  }
  html += '</table>';
  el.innerHTML = html;
}

async function refresh() {
  try {
    const [active, scheduled] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/scheduled').then(r => r.json()),
    ]);
    renderActive(active);
    renderScheduled(scheduled);
    document.getElementById('last-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error('Refresh failed:', e);
  }
}

async function killTask(containerName) {
  if (!confirm('Kill container ' + containerName + '?')) return;
  await fetch('/api/tasks/' + encodeURIComponent(containerName) + '/kill', { method: 'POST' });
  setTimeout(refresh, 1000);
}

async function cancelTask(taskId) {
  if (!confirm('Cancel scheduled task ' + taskId + '?')) return;
  await fetch('/api/scheduled/' + encodeURIComponent(taskId) + '/cancel', { method: 'POST' });
  setTimeout(refresh, 1000);
}

// Update durations every second without re-fetching
setInterval(() => {
  document.querySelectorAll('.duration[data-started]').forEach(el => {
    const started = parseInt(el.dataset.started, 10);
    el.textContent = ago(Date.now() - started);
  });
}, 1000);

refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;

export function startDashboard(deps: DashboardDeps): void {
  const server = http.createServer((req, res) => {
    if (handleApi(req, res, deps)) return;

    // Serve dashboard HTML for any other GET
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD_HTML);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(DASHBOARD_PORT, '127.0.0.1', () => {
    logger.info(
      { port: DASHBOARD_PORT },
      `Dashboard running at http://127.0.0.1:${DASHBOARD_PORT}`,
    );
  });
}
