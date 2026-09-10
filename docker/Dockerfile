FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /src
ARG SOURCE_REVISION=0000000000000000000000000000000000000000
ARG SOURCE_URL=https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/0000000000000000000000000000000000000000
ARG RELEASE_VERSION=0.2.0-dev
ARG ALLOW_CANDIDATE_REVISION=false
ARG VITE_ALLOWED_PARENT_ORIGINS=https://ingenia.vn,https://staging.ingenia.vn
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
RUN npm run build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
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
COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /src/packages/viewer/dist /usr/share/nginx/html
COPY LICENSE NOTICE THIRD_PARTY_NOTICES sbom.spdx.json /usr/share/nginx/html/legal/
RUN printf '{"source":"%s","revision":"%s","version":"%s","license":"AGPL-3.0-only"}\n' \
      "$SOURCE_URL" "$SOURCE_REVISION" "$RELEASE_VERSION" \
      > /usr/share/nginx/html/source.json
EXPOSE 8080
