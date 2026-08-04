FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
WORKDIR /src
ARG SOURCE_REVISION=0000000000000000000000000000000000000000
ARG SOURCE_URL=https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/0000000000000000000000000000000000000000
ARG RELEASE_VERSION=0.2.0-dev
ARG ALLOW_CANDIDATE_REVISION=false
RUN node -e "const [r,u,v,a]=process.argv.slice(1); if(!/^[0-9a-f]{40}$/.test(r)||u!=='https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/'+r||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)||(r==='0'.repeat(40)&&a!=='true')) process.exit(1)" "$SOURCE_REVISION" "$SOURCE_URL" "$RELEASE_VERSION" "$ALLOW_CANDIDATE_REVISION"
LABEL org.opencontainers.image.title="INGENIA xeokit Converter" \
      org.opencontainers.image.source="$SOURCE_URL" \
      org.opencontainers.image.revision="$SOURCE_REVISION" \
      org.opencontainers.image.version="$RELEASE_VERSION" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY package.json package-lock.json ./
COPY packages/converter/package.json packages/converter/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/viewer/package.json packages/viewer/package.json
RUN npm ci --ignore-scripts --omit=dev
COPY packages/converter packages/converter
RUN npm run converter:prepare && npm run converter:version
COPY LICENSE NOTICE THIRD_PARTY_NOTICES SOURCE_OFFER.md SBOM.md sbom.spdx.json /licenses/
USER node
ENTRYPOINT ["node", "/src/packages/converter/bin/ingenia-xeokit-convert.mjs"]
