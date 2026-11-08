# The frontend on Railway: a static build served by Caddy. Railway passes a service's variables to a
# Dockerfile build only through ARG, and Vite reads VITE_ variables only at build time, so a changed
# value needs a new build. Only values safe in a browser belong here: never a secret key.
FROM node:24-bookworm-slim AS build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_PROCESSOR_URL
# Without these the app would build and then show its "not configured" page.
RUN test -n "$VITE_SUPABASE_URL" || { echo "VITE_SUPABASE_URL is missing or empty" >&2; exit 1; }; \
    test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" || { echo "VITE_SUPABASE_PUBLISHABLE_KEY is missing or empty" >&2; exit 1; }; \
    test -n "$VITE_PROCESSOR_URL" || { echo "VITE_PROCESSOR_URL is missing or empty" >&2; exit 1; }
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# vite alone: lint, typecheck and tests run before a push, not in the image.
RUN npx vite build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
