#!/usr/bin/env bash

set -euo pipefail

readonly retention="${DOCKER_CI_RETENTION:-168h}"
readonly volume_min_age_seconds="${DOCKER_CI_VOLUME_MIN_AGE_SECONDS:-86400}"
readonly now_epoch="$(date -u +%s)"

printf 'Docker CI cleanup started: retention=%s volume_min_age_seconds=%s\n' \
  "$retention" "$volume_min_age_seconds"

# GitHub Actions normally removes its containers, but retain this as a safety net
# for abandoned jobs. Docker refuses to prune running containers.
docker container prune --force --filter "until=$retention"

# Buildx and Dockerfile verification leave cache and unused images on the shared
# runner. Keep one week for warm builds, then reclaim it automatically.
docker builder prune --all --force --filter "until=$retention"
docker image prune --all --force --filter "until=$retention"

# GitHub Actions service containers based on Postgres and Redis declare anonymous
# volumes. The runner removes the containers but not those volumes. Delete only
# unattached volumes carrying Docker's anonymous-volume label, and only after the
# age guard. A race with a new container is safe because Docker refuses in-use
# volume removal.
while IFS= read -r volume_name; do
  [[ -n "$volume_name" ]] || continue

  created_at="$(docker volume inspect --format '{{.CreatedAt}}' "$volume_name")"
  if ! created_epoch="$(date -u -d "$created_at" +%s)"; then
    printf 'Skipping %s: cannot parse creation time %s\n' "$volume_name" "$created_at" >&2
    continue
  fi

  age_seconds=$((now_epoch - created_epoch))
  if ((age_seconds < volume_min_age_seconds)); then
    continue
  fi

  docker volume rm "$volume_name"
done < <(
  docker volume ls --quiet \
    --filter dangling=true \
    --filter label=com.docker.volume.anonymous
)

docker system df
printf 'Docker CI cleanup completed\n'
