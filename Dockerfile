ARG MATTER_NODE_IMAGE=node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
FROM ${MATTER_NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${MATTER_NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production MATTER_LAB_DEV=0 MATTER_LAB_HOST=0.0.0.0 MATTER_LAB_PORT=4310 MATTER_LAB_DATA_DIR=/data
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY *.mjs ./
COPY src ./src
COPY scripts ./scripts
COPY dist ./dist
USER node
EXPOSE 4310
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4310/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
