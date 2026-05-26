FROM node:22.16.0-alpine3.22

LABEL maintainer="GrcPay Project"
LABEL description="Development environment for grcpay backend service"

# better-sqlite3 ships prebuilt binaries for common platforms but
# falls back to compiling from source on Alpine, which needs the
# usual toolchain. Cheap on a one-time install. su-exec lets the
# compose `command:` drop from root to the host UID after chowning
# the anon node_modules volume.
RUN apk add --no-cache python3 make g++ su-exec

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install

# SQLite data directory — mount a volume here to persist data
RUN mkdir -p /usr/src/app/data

CMD ["npm", "run", "dev"]
