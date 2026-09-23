#!/usr/bin/env bash
# Poll a detached command: waits up to ~60s, then reports progress or completion.
# Usage: ./scripts/check-long.sh <name> [seconds_to_wait]
name="$1"; wait_s="${2:-60}"
[ -f "logs/$name.log" ] || { echo "no such job: $name"; exit 1; }
for i in $(seq 1 "$wait_s"); do
  [ -f "logs/$name.done" ] && break
  sleep 1
done
echo "--- last lines of logs/$name.log ---"
tail -c 3000 "logs/$name.log" | tr '\r' '\n' | tail -15
if [ -f "logs/$name.done" ]; then
  echo "FINISHED exit_code=$(cat "logs/$name.done")"
else
  echo "STILL RUNNING (poll again)"
fi
