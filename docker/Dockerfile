FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /src
ARG SOURCE_REVISION=0000000000000000000000000000000000000000
ARG SOURCE_URL=https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/0000000000000000000000000000000000000000
ARG RELEASE_VERSION=0.2.0-dev
ARG SOURCE_DATE_EPOCH=0
ARG ALLOW_CANDIDATE_REVISION=false
ARG VITE_ALLOWED_PARENT_ORIGINS=https://ingenia.vn
ARG VITE_BROWSER_CANARY=false
RUN node -e "const [r,u,v,a]=process.argv.slice(1); if(!/^[0-9a-f]{40}$/.test(r)||u!=='https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/'+r||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)||(r==='0'.repeat(40)&&a!=='true')) process.exit(1)" "$SOURCE_REVISION" "$SOURCE_URL" "$RELEASE_VERSION" "$ALLOW_CANDIDATE_REVISION"
ENV VITE_SOURCE_URL=$SOURCE_URL
ENV VITE_ALLOWED_PARENT_ORIGINS=$VITE_ALLOWED_PARENT_ORIGINS
ENV VITE_BROWSER_CANARY=$VITE_BROWSER_CANARY
COPY package.json package-lock.json ./
COPY packages/converter/package.json packages/converter/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/viewer/package.json packages/viewer/package.json
RUN npm ci --ignore-scripts --include=optional \
    --workspace @ingenia/xeokit-viewer \
    --workspace @ingenia/generic-bim-viewport-protocol \
    --include-workspace-root=false
COPY packages ./packages
COPY scripts/generate-release-sbom.mjs scripts/generate-release-sbom.mjs
RUN SBOM_SCOPE=viewer SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH RELEASE_VERSION=$RELEASE_VERSION \
    RELEASE_REVISION=$SOURCE_REVISION RELEASE_SOURCE_URL=$SOURCE_URL \
    ALLOW_CANDIDATE_REVISION=$ALLOW_CANDIDATE_REVISION npm run sbom:generate
RUN npm run build

FROM nginx:1.30.4-alpine3.24-slim@sha256:77da26c31397bf6694b4bf93275f5b40b0b120ba1b8f114264b603e592c561d6
ARG SOURCE_REVISION=0000000000000000000000000000000000000000
ARG SOURCE_URL=https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/0000000000000000000000000000000000000000
ARG RELEASE_VERSION=0.2.0-dev
ENV XEOKIT_CONNECT_SRC=https://ingenia.vn
ENV XEOKIT_FRAME_ANCESTORS=https://ingenia.vn
LABEL org.opencontainers.image.title="INGENIA xeokit Runtime" \
      org.opencontainers.image.source="$SOURCE_URL" \
      org.opencontainers.image.revision="$SOURCE_REVISION" \
      org.opencontainers.image.version="$RELEASE_VERSION" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --chmod=644 docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=644 docker/nginx-main.conf /etc/nginx/nginx.conf
COPY --chmod=644 docker/viewer-entrypoint.sh /opt/ingenia/viewer-entrypoint.sh
COPY --from=build /src/packages/viewer/dist /usr/share/nginx/html
COPY --chmod=644 LICENSE NOTICE THIRD_PARTY_NOTICES /usr/share/nginx/html/legal/
COPY --from=build --chmod=644 /src/sbom.viewer.spdx.json /usr/share/nginx/html/legal/sbom.spdx.json
RUN printf '{"source":"%s","revision":"%s","version":"%s","license":"AGPL-3.0-only"}\n' \
      "$SOURCE_URL" "$SOURCE_REVISION" "$RELEASE_VERSION" \
      > /usr/share/nginx/html/source.json \
    && chmod 755 /opt/ingenia /etc/nginx/templates \
    && find /usr/share/nginx/html -type d -exec chmod 755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 644 {} +
USER 101:101
ENTRYPOINT ["/bin/sh", "/opt/ingenia/viewer-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 8080
