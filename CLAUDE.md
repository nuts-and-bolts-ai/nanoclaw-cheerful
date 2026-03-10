# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Deployment

NanoClaw runs on a **Hetzner VPS** (CX23, Ubuntu 24.04, eu-central):
- **IP:** 46.225.110.16
- **User:** `nanoclaw`
- **SSH:** `ssh nanoclaw@46.225.110.16`
- **Install path:** `~/nanoclaw`
- **Service:** `systemctl --user {start|stop|restart|status} nanoclaw`
- **Logs:** `~/nanoclaw/logs/nanoclaw.log`

The local repo on the laptop is for development only. To deploy changes:
```bash
git push origin main
ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw && git pull && npm run build && systemctl --user restart nanoclaw"
```

If the container image changed (Dockerfile, agent-runner, or skills that need rebuild):
```bash
ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw && git pull && ./container/build.sh && npm run build && systemctl --user restart nanoclaw"
```

**Always kill stale containers before restarting.** Old containers keep running with old code and can send duplicate/outdated responses.

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
ssh nanoclaw@46.225.110.16 "tail -50 ~/nanoclaw/logs/nanoclaw.log"
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

3. **Deploy with verification**
   ```bash
   git push origin main
   # If agent-runner changed:
   ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw && git pull && ./container/build.sh && npm run build && systemctl --user restart nanoclaw"
   # Otherwise:
   ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw && git pull && npm run build && systemctl --user restart nanoclaw"
   ```

4. **Kill stale containers and clear sessions** — critical for skill changes to take effect
   ```bash
   ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
   ssh nanoclaw@46.225.110.16 "sqlite3 ~/nanoclaw/store/messages.db 'DELETE FROM sessions'"
   ssh nanoclaw@46.225.110.16 "systemctl --user restart nanoclaw"
   ```
   The session-clear code in `container-runner.ts` handles this automatically on skill hash changes, but stale containers from before the restart can write old sessions back. Always kill containers first.

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
