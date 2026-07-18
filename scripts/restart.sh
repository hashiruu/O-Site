#!/bin/bash
fuser -k 3024/tcp || true
sleep 1
pkill -9 -f "next-server" || true
pkill -9 -f "next" || true
sleep 1
cd ~/mydrive/nas-app
rm -rf .next
npm rebuild better-sqlite3 2>/dev/null
nohup npm run dev -- -p 3024 > ui_dev.log 2>&1 &
echo "Next.js dev server has been forcefully restarted on port 3024."
