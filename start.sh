#!/bin/sh
set -e
echo "Starting SignalDeck server..."
echo "PORT=$PORT"
echo "NODE_ENV=$NODE_ENV"
echo "SUPABASE_URL=$SUPABASE_URL"
exec node --import tsx/esm server.ts 2>&1
