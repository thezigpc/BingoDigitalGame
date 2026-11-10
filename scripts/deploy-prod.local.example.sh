# Copy to scripts/deploy-prod.local.sh (git-ignored) and fill in.
DEPLOY_HOST="user@vm-hostname-or-ip"   # SSH target; needs the docker group and sudo
DEPLOY_KEY="$HOME/.ssh/id_ed25519"     # SSH key for that user
PUBLIC_URL="https://bingo.example.com" # health-checked after the deploy
REMOTE_DIR="bingo"                     # project dir under that user's home
VM_PORT="3004"                         # host port in docker-compose.yml
