# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Deployment

NanoClaw runs on a **Hetzner VPS** (CX23, Ubuntu 24.04, eu-central):
- **IP:** 46.225.110.16
- **User:** `nanoclaw`
- **SSH:** `ssh nanoclaw@46.225.110.16`
- **Install path:** `~/nanoclaw-cheerful`
- **Service:** `systemctl --user {start|stop|restart|status} nanoclaw`
- **Logs:** `~/nanoclaw-cheerful/logs/nanoclaw.log`

The local repo on the laptop is for development only. To deploy changes:
```bash
git push origin main
ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
ssh nanoclaw@46.225.110.16 "systemctl --user stop nanoclaw"
ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw-cheerful && git pull && npm run build"
ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw-cheerful && bash scripts/advance-cursors.sh"
ssh nanoclaw@46.225.110.16 "systemctl --user start nanoclaw"
```

If the container image changed (Dockerfile, agent-runner, or skills that need rebuild):
```bash
ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
ssh nanoclaw@46.225.110.16 "systemctl --user stop nanoclaw"
ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw-cheerful && git pull && ./container/build.sh && npm run build"
ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw-cheerful && bash scripts/advance-cursors.sh"
ssh nanoclaw@46.225.110.16 "systemctl --user start nanoclaw"
```

**Deploy order matters:** kill containers → stop service → build → advance cursors → start service. The service must be stopped before updating the DB (otherwise the DB is locked). There are TWO cursor systems: `last_timestamp` (polling loop) and `last_agent_timestamp` (per-session recovery via `recoverPendingMessages`). The `scripts/advance-cursors.sh` script advances both. The old inline approach silently failed because the 4KB JSON broke shell interpolation into SQL.

## Quick Context

Single Node.js process with skill-based channel system. Channels (Slack, Telegram, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

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
ssh nanoclaw@46.225.110.16 "systemctl --user restart nanoclaw"
ssh nanoclaw@46.225.110.16 "systemctl --user status nanoclaw"
ssh nanoclaw@46.225.110.16 "tail -50 ~/nanoclaw-cheerful/logs/nanoclaw.log"
```

## Adding or Updating Agent Skills

Skills live in `container/skills/{name}/SKILL.md`. When adding or changing skills, follow this checklist:

1. **Create/edit the skill** in `container/skills/{name}/SKILL.md`
   - Must have YAML frontmatter: `name` and `description` (see existing skills for format)
   - Description must be specific enough that the agent picks this skill over alternatives (scrapling, browser, etc.)
   - If the skill uses env vars via Bash/Python, those vars must be in `BASH_VISIBLE_SECRETS` in `container/agent-runner/src/index.ts`

2. **Determine what needs rebuilding**
   - Skills only (SKILL.md changes): no container rebuild needed — skills sync at runtime
   - Agent-runner changes (`container/agent-runner/`): container rebuild required (`./container/build.sh`)
   - Host code changes (`src/`): `npm run build` required

3. **Deploy** — follow the deploy order from the Deployment section above:
   ```bash
   git push origin main
   ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
   ssh nanoclaw@46.225.110.16 "systemctl --user stop nanoclaw"
   # If agent-runner changed, add: ./container/build.sh &&
   ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw-cheerful && git pull && npm run build"
   ssh nanoclaw@46.225.110.16 "sqlite3 ~/nanoclaw-cheerful/store/messages.db 'DELETE FROM sessions'"
   ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw-cheerful && bash scripts/advance-cursors.sh"
   ssh nanoclaw@46.225.110.16 "systemctl --user start nanoclaw"
   ```
   Session clear forces new sessions on skill changes. Cursor advance prevents phantom replies to old messages.

5. **Verify after deploy** — don't trust "it restarted" as proof
   ```bash
   # Trigger a test message, then:
   ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}} {{.Status}}' | grep nanoclaw"
   ssh nanoclaw@46.225.110.16 "docker logs <container-name> 2>&1 | head -20"  # Should show "session: new"
   # Wait for completion, then check it used the right approach:
   ssh nanoclaw@46.225.110.16 "docker logs <container-name> 2>&1 | tail -20"
   ```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
