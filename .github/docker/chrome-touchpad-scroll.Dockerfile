# syntax=docker/dockerfile:1.7

ARG CHROME_IMAGE=ghcr.io/linuxserver/chrome:latest

FROM node:24-bookworm-slim AS selkies-build

ARG SELKIES_RELEASE=2.2.1

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${SELKIES_RELEASE}" \
    https://github.com/selkies-project/selkies.git /src

COPY .github/patches/selkies-trackpad-scroll.patch /tmp/selkies-trackpad-scroll.patch

RUN cd /src \
    && git apply --unidiff-zero /tmp/selkies-trackpad-scroll.patch \
    && cd addons/selkies-web-core \
    && npm install \
    && npm run build --ignore-scripts

RUN --mount=type=secret,id=github_token,target=/run/secrets/github_token,required=false \
    cd /src/addons/selkies-web-core \
    && node gendb.js

RUN cd /src/addons/selkies-dashboard \
    && npm install \
    && npm run build

FROM ${CHROME_IMAGE}

COPY --from=selkies-build /src/addons/selkies-dashboard/dist/ /usr/share/selkies/selkies-dashboard/
