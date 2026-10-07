# check=skip=FromPlatformFlagConstDisallowed

FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL="/api"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

FROM --platform=linux/amd64 nginxinc/nginx-unprivileged:1.27-alpine AS runtime

ENV API_PROXY_TARGET="https://recruiterai-backend-610993990979.us-east4.run.app"
ENV PORT=8080
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

RUN sed -i 's|application/javascript  *js;|application/javascript                           js mjs;|' \
      /etc/nginx/mime.types \
 && grep -q 'js mjs;' /etc/nginx/mime.types

COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/api-proxy.conf /etc/nginx/snippets/api-proxy.conf
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=build /app/dist /usr/share/nginx/html  

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/" || exit 1
