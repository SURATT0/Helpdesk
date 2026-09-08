# syntax=docker/dockerfile:1

# --- build stage: install deps + Next production build (standalone) ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Where this server forwards /api/v1/* to (see next.config.mjs). Baked into the
# build's routes-manifest, so it is an ARG rather than a runtime ENV — it names
# the API's address on the compose network, which does not vary with how a
# browser reaches the app.
ARG API_PROXY_TARGET=http://api:4000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
# The URL the BROWSER calls. Empty by default, which leaves the app on its
# same-origin `/api/v1` and through the proxy above — so pointing a phone or a
# tunnel at this stack needs no rebuild. Set it only to send the browser
# directly to an API elsewhere; NEXT_PUBLIC_* is inlined at build time, so that
# choice is baked and changing it does need `--build`.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# --- runtime stage: run the standalone server ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
