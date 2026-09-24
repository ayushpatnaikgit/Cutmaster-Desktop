#!/usr/bin/env bash
# Start a long command detached so the terminal returns immediately.
# Usage: ./scripts/run-long.sh <name> <command...>
# The command itself records its exit code in logs/<name>.done when it ends
# (no helper process that could be lost), in its own session so it survives
# whatever started it.
set -e
name="$1"; shift
mkdir -p logs
: > "logs/$name.log"
rm -f "logs/$name.done"
setsid nohup bash -lc "$*; echo \$? > 'logs/$name.done'" > "logs/$name.log" 2>&1 < /dev/null &
pid=$!
echo "$pid" > "logs/$name.pid"
echo "started '$name' as pid $pid — poll with ./scripts/check-long.sh $name"
