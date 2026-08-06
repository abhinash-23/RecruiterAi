# check=skip=FromPlatformFlagConstDisallowed
#
# ^ Must be line 1. A BuildKit directive placed after any ordinary comment is
# read as a comment itself and silently does nothing.
#
# The check it skips warns that a constant `--platform` makes a Dockerfile
# non-portable, which is true and is the point: Cloud Run runs amd64, and an
# arm64 image built on an Apple Silicon laptop deploys cleanly and then fails to
# start. Pinning it means that can't happen however the image is built.

# ============================================================================
# RecruiterAI — production image (built for Cloud Run)
# ============================================================================
# A Vite SPA: there is no server-side rendering and no Node process at runtime.
# The build turns the source into static files and nginx serves them, which is
# why the runtime stage carries no toolchain and no `node_modules` at all.
#
#   gcloud run deploy recruiterai \
#     --source . \
#     --region=asia-south1 \
#     --allow-unauthenticated \
#     --set-env-vars API_PROXY_TARGET=https://your-backend.example.com \
#     --timeout=3600
#
# `--timeout=3600`, not the 300s default, and it is not about slow requests.
# **Cloud Run counts a WebSocket as one request and cuts it at the timeout.**
# Live interview viewing holds a socket open for the length of the sitting, and
# neither the viewer nor the publisher reconnects — so a 300s timeout drops
# every live view five minutes in, for the rest of a half-hour interview. An
# hour is the platform maximum and covers a full sitting.
#
# Locally it behaves the same way:
#
#   docker build -t recruiterai .
#   docker run -p 8080:8080 -e API_PROXY_TARGET=https://api.example.com recruiterai
#
# ----------------------------------------------------------------------------
# What Cloud Run requires, and where each one is handled
# ----------------------------------------------------------------------------
#  - **Listen on `$PORT`.** Cloud Run sets it and routes to it; a hard-coded
#    port is the usual reason a revision never becomes ready. Passed through to
#    the nginx template, which does `listen ${PORT}`.
#  - **linux/amd64.** Cloud Run runs amd64, so the runtime stage is pinned to
#    it. Without that, a build on an Apple Silicon machine produces an arm64
#    image that deploys and then fails to start.
#  - **Start quickly, and don't crash on a bad dependency.** nginx is instant,
#    and the API target is resolved per request rather than at boot — see the
#    note on `API_PROXY_TARGET` below.
#  - `HEALTHCHECK` and `EXPOSE` are **ignored by Cloud Run**, which uses its own
#    probes. They are kept because they are what makes the same image behave on
#    Compose, ECS and a laptop.
#
# ----------------------------------------------------------------------------
# Talking to the backend — two ways, and the default is the quiet one
# ----------------------------------------------------------------------------
# The app calls same-origin `/api/...` unless `VITE_API_BASE_URL` says
# otherwise, and nginx forwards that to `API_PROXY_TARGET`. Nothing is
# cross-origin, so **CORS never applies** and the backend needs no allow-list
# for the Cloud Run URL — which is worth having, because that URL changes when
# the service is recreated. `API_PROXY_TARGET` is read at container start, so
# one image serves staging and production.
#
# The alternative is to bake an absolute URL at build time:
#
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.com -t recruiterai .
#
# That makes the browser call the backend directly, which is a real
# cross-origin request — the backend must then allow this app's origin. It also
# fixes the target into the image, so staging and production need separate
# builds. Prefer the proxy unless something else already terminates it.
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1 — build
# ----------------------------------------------------------------------------
# `--platform=$BUILDPLATFORM` pins this stage to the *builder's* architecture
# while the runtime stage below stays amd64. The output is static files, which
# are architecture-free, so this avoids emulating an amd64 Node under QEMU on an
# arm64 machine — minutes of difference, and no change to what ships.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

# Dependencies first, and only the two files that decide them. Everything below
# this line changes on nearly every commit; these two rarely do, so the install
# layer is reused across builds instead of re-running for a one-line edit.
COPY package.json package-lock.json ./

# `npm ci` rather than `npm install`: it installs exactly the lockfile and fails
# if the two have drifted, so a build can't quietly resolve a different tree
# than the one that was tested.
RUN npm ci

COPY . .

# Read *after* the copy so a changed value doesn't invalidate the install layer.
#
# Defaulted to `/api` rather than left empty, and that matters: `ENV` always
# sets the variable, so an empty default handed Vite `VITE_API_BASE_URL=""`, and
# the app's `?? "/api"` fallback did not fire for an empty string. The whole
# expression compiled to `""` and every call went to `/auth/login` — which the
# SPA fallback answers with index.html and a 200, so it surfaced as "unexpected
# token '<'" rather than as a 404. The app now reads this with `||` too; this
# default is the second lock on the same door.
ARG VITE_API_BASE_URL="/api"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# `npm run build`, not a bare `vite build`: the script is `tsc -b && vite build`,
# and the typecheck is the half that catches a broken import. Skipping it would
# happily ship a bundle that throws at runtime.
RUN npm run build

# ----------------------------------------------------------------------------
# Stage 2 — serve
# ----------------------------------------------------------------------------
# The *unprivileged* NGINX image, not `nginx:alpine`. It runs as uid 101 with
# no root anywhere in the container, which the stock image can't do without
# hand-chowning its cache, log and pid paths. A static file server has no reason
# to hold root, and Cloud Run's second-generation runtime is happier without it.
FROM --platform=linux/amd64 nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Where `/api` is forwarded. Set this per deployment
# (`--set-env-vars API_PROXY_TARGET=...`).
#
# The default is a placeholder that is *never* resolved at startup — the config
# looks it up per request — so an unset value leaves the site serving normally
# and only `/api` failing, instead of a revision that won't boot and says
# "host not found in upstream" in a log nobody thinks to read.
ENV API_PROXY_TARGET="http://api.invalid"

# Cloud Run overrides this. The default matters for `docker run` and for the
# healthcheck below, which has no way to read the platform's value.
ENV PORT=8080

# `.mjs` is missing from nginx's mime.types, and the omission breaks a feature.
#
# PDF.js ships its worker as an ES module, so the bundle contains one `.mjs`
# file — and nginx serves an unknown extension as `application/octet-stream`. A
# browser refuses to execute a *module* script with a non-JavaScript type, so
# the worker never starts and every résumé PDF upload fails, in the New
# interview dialog and the Résumé Analyzer alike. It fails silently in dev,
# where Vite serves the module with the right type itself.
#
# Mapped onto `application/javascript` rather than a location override so it
# also matches `gzip_types` — that worker is 1.2 MB uncompressed. The `grep`
# is not decoration: if a future base image changes this line, the build fails
# here instead of shipping the bug again.
RUN sed -i 's|application/javascript  *js;|application/javascript                           js mjs;|' \
      /etc/nginx/mime.types \
 && grep -q 'js mjs;' /etc/nginx/mime.types

# Turns on the image's own `15-local-resolvers.envsh`, which reads
# /etc/resolv.conf and exports `NGINX_LOCAL_RESOLVERS` for the templating step
# that follows it. nginx needs an explicit `resolver` to look a hostname up at
# request time and — unlike everything else in the image — will not read
# resolv.conf to find one itself.
#
# The script is opt-in: it returns immediately unless this is set. It replaced a
# hand-written copy of the same logic, which Cloud Build refused to run because
# `COPY` had not preserved an execute bit — a file mode Docker for Windows
# invents and Linux does not, so it worked on the machine that wrote it and
# failed everywhere else. Using what the image already ships removes the
# question entirely.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=build /app/dist /usr/share/nginx/html

# Informational only — Cloud Run ignores it and publishes `$PORT` regardless.
EXPOSE 8080

# `wget` is in the base image; `curl` isn't. Hits the SPA's own index, so a
# healthy result means the static files are actually being served — not merely
# that a process is listening. Ignored by Cloud Run; used by Compose and ECS.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/" || exit 1
