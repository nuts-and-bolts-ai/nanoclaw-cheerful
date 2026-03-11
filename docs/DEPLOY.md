# Deployment Guide — nanoclaw-cheerful

## Prerequisites

Before deploying, you need:
- New Hetzner VPS (CX22, Ubuntu 24.04) — separate from any existing nanoclaw instance
- Cheerful AI Slack bot tokens (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) — reuse the existing "Cheerful AI" Slack app
- Cheerful Supabase service role key — project `cgtgotrffwukyuxdqcml`
- Anthropic API key

## First-time VPS Setup

```bash
# SSH into new VPS
ssh root@<new-vps-ip>

# Create nanoclaw user
adduser --disabled-password --gecos "" nanoclaw
usermod -aG sudo nanoclaw
su - nanoclaw

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Install Docker
sudo apt-get install -y docker.io
sudo usermod -aG docker nanoclaw
newgrp docker

# Clone repo
git clone https://github.com/nuts-and-bolts-ai/nanoclaw-cheerful ~/nanoclaw-cheerful
cd ~/nanoclaw-cheerful

# Install dependencies and build
npm install
npm run build

# Build container image
./container/build.sh

# Create .env from template
cp .env.example .env
nano .env
# Fill in all values:
#   SLACK_BOT_TOKEN=xoxb-...
#   SLACK_APP_TOKEN=xapp-...
#   ASSISTANT_NAME=Cheerful AI
#   SUPABASE_URL=https://cgtgotrffwukyuxdqcml.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=...
#   CHEERFUL_BACKEND_URL=https://prd-cheerful.fly.dev
#   ANTHROPIC_API_KEY=sk-ant-...
```

## Set up systemd service

```bash
# Enable systemd user services to persist after logout
loginctl enable-linger nanoclaw

# Create service file
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/nanoclaw.service << 'EOF'
[Unit]
Description=NanoClaw Personal Assistant
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /home/nanoclaw/nanoclaw-cheerful/dist/index.js
WorkingDirectory=/home/nanoclaw/nanoclaw-cheerful
Restart=always
RestartSec=5
Environment=HOME=/home/nanoclaw
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/home/nanoclaw/.local/bin
EnvironmentFile=/home/nanoclaw/nanoclaw-cheerful/.env
StandardOutput=append:/home/nanoclaw/nanoclaw-cheerful/logs/nanoclaw.log
StandardError=append:/home/nanoclaw/nanoclaw-cheerful/logs/nanoclaw.error.log

[Install]
WantedBy=default.target
EOF

mkdir -p ~/nanoclaw-cheerful/logs
systemctl --user daemon-reload
systemctl --user enable nanoclaw
systemctl --user start nanoclaw
systemctl --user status nanoclaw
```

## Verify it's running

```bash
# Check service status
systemctl --user status nanoclaw

# Tail logs
tail -f ~/nanoclaw-cheerful/logs/nanoclaw.log
```

## Register the #cheerful-ai channel

After the service is running:
1. Invite the "Cheerful AI" bot to `#cheerful-ai` in Slack
2. Tag it: `@Cheerful AI hello`
3. The bot will auto-register the channel (uses `groups/cheerful-ai/CLAUDE.md` — already present in repo)

## Add a new client channel

1. Invite the bot to `#cheerful-<brand>` in Slack
2. In the `#cheerful-ai` channel, type: `@Cheerful AI setup <client-domain>`
   Example: `@Cheerful AI setup spacegoods.com`
3. The bot will:
   - Look up the client in Supabase
   - Create `groups/slack_cheerful-<brand>/CLAUDE.md` with the client's ID and scoping rules
   - Register the Slack channel
   - Post a welcome message with example commands

## Deploying updates (code changes only)

```bash
git push origin main
ssh nanoclaw@<vps-ip> "cd ~/nanoclaw-cheerful && git pull && npm run build && systemctl --user restart nanoclaw"
```

## Deploying updates (container/skills changed)

If you changed anything in `container/` (Dockerfile, agent-runner, or skills):

```bash
git push origin main
ssh nanoclaw@<vps-ip> "cd ~/nanoclaw-cheerful && git pull && ./container/build.sh && npm run build && systemctl --user restart nanoclaw"
```

## Troubleshooting

**Bot doesn't respond:**
- Check `tail -f ~/nanoclaw-cheerful/logs/nanoclaw.log` for errors
- Verify `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are set correctly in `.env`
- Ensure the bot is invited to the channel

**Setup command fails:**
- Check that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
- Verify the domain exists in the `client` table in Supabase
- The setup command should be run from `#cheerful-ai`, not a client channel

**Orders failing:**
- Check `CHEERFUL_BACKEND_URL` is set to `https://prd-cheerful.fly.dev`
- Ensure the creator has a completed workflow execution with `output_data`
- Verify `output_data.shipping_address` uses `country_code`/`province_code` (see `cheerful-api` skill)
