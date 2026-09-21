#!/bin/sh
set -eu

: "${XEOKIT_CONNECT_SRC:?Exact API origins are required}"
: "${XEOKIT_FRAME_ANCESTORS:?Exact parent origins are required}"
# Only substitute reviewed origin variables, never Nginx request variables.
envsubst '${XEOKIT_CONNECT_SRC} ${XEOKIT_FRAME_ANCESTORS}' \
    < /etc/nginx/templates/default.conf.template > /tmp/viewer-default.conf
nginx -t
exec "$@"
