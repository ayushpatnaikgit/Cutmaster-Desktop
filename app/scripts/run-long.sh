#!/usr/bin/env bash
# Start a long command detached so the terminal returns immediately.
# Usage: ./scripts/run-long.sh <name> <command...>
set -e
name="$1"; shift
mkdir -p logs
: > "logs/$name.log"
rm -f "logs/$name.done"
nohup bash -lc "$*" > "logs/$name.log" 2>&1 &
pid=$!
echo "$pid" > "logs/$name.pid"
( wait $pid 2>/dev/null; echo $? > "logs/$name.done" ) &
echo "started '$name' as pid $pid — poll with ./scripts/check-long.sh $name"
