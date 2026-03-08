# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Deployment

NanoClaw runs on a **Hetzner VPS** (CX22, Ubuntu 24.04):
- **IP:** 5.78.144.214
- **User:** `nanoclaw`
- **SSH:** `ssh nanoclaw@5.78.144.214`
- **Install path:** `~/nanoclaw`
- **Service:** `systemctl --user {start|stop|restart|status} nanoclaw`
- **Logs:** `~/nanoclaw/logs/nanoclaw.log`

The local repo on the laptop is for development only. To deploy changes:
```bash
git push origin main
ssh nanoclaw@5.78.144.214 "cd ~/nanoclaw && git pull && npm run build && systemctl --user restart nanoclaw"
```

If the container image changed (Dockerfile, agent-runner, or skills that need rebuild):
```bash
ssh nanoclaw@5.78.144.214 "cd ~/nanoclaw && git pull && ./container/build.sh && npm run build && systemctl --user restart nanoclaw"
```

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management (run on VPS via SSH):
```bash
ssh nanoclaw@5.78.144.214 "systemctl --user restart nanoclaw"
ssh nanoclaw@5.78.144.214 "systemctl --user status nanoclaw"
ssh nanoclaw@5.78.144.214 "tail -50 ~/nanoclaw/logs/nanoclaw.log"
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
