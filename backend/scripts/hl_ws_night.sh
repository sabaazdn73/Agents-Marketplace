#!/bin/bash
# hl_ws_night.sh
#
# One overnight session of the WebSocket collector, on a laptop.
#
#   cd backend && nohup bash scripts/hl_ws_night.sh > /dev/null 2>&1 &
#
# Duration in seconds as the first argument, default 16 hours. The run stops
# itself at the deadline: this is one session to answer the persistence
# question, not a service, and a collector still holding ten sockets open
# tomorrow afternoon is a thing somebody has to remember to kill.
#
# WHAT THIS ADDS OVER RUNNING THE SCRIPT DIRECTLY
# -----------------------------------------------
# ws_collector.py already survives what happens to a socket: a drop, a refused
# subscription, a stall, a silent maker, all reconnect with jitter and carry on.
# What it cannot survive is the process itself ending, and an eight-hour
# unattended run is long enough for that to be worth covering. If python exits
# for any reason this restarts it with the REMAINING time, so a crash at 02:00
# costs a few seconds rather than the rest of the night, and a crash loop
# cannot extend the run past the deadline it was given.
#
# Each attempt re-picks its ten addresses from the REST collector's data, so a
# restart also gets a fresh selection rather than insisting on a set that may
# have gone quiet.
set -u

DURATION="${1:-57600}"
DEADLINE=$(( $(date +%s) + DURATION ))
LOG="${HL_WS_LOG:-/tmp/hl-ws-night.log}"

echo "[supervisor] start $(date -u +%FT%TZ), deadline $(date -u -r "$DEADLINE" +%FT%TZ)" >> "$LOG"

while :; do
  REMAIN=$(( DEADLINE - $(date +%s) ))
  # Below a flush interval there is no whole bucket left to collect, so the
  # last minute is not worth a reconnect.
  if [ "$REMAIN" -le 60 ]; then
    echo "[supervisor] deadline reached $(date -u +%FT%TZ)" >> "$LOG"
    break
  fi
  echo "[supervisor] launching with ${REMAIN}s remaining $(date -u +%FT%TZ)" >> "$LOG"
  HL_WS_SECONDS="$REMAIN" python3 scripts/hl_ws_collect.py >> "$LOG" 2>&1
  echo "[supervisor] collector exited $? at $(date -u +%FT%TZ)" >> "$LOG"
  sleep 10
done
