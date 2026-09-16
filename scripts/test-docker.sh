#!/usr/bin/env sh
# Run the test suite against a throwaway Postgres 16 container.
#   npm run test:docker
# Needs Docker. The container is removed when the tests finish, pass or fail.
set -eu

NAME="sustain-test-pg-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=test -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

PORT=$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')
for _ in $(seq 1 30); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
sleep 1 # pg_isready can return before the password auth is ready on first boot

TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:$PORT/postgres" npm test
