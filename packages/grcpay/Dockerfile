FROM node:22.16.0-alpine3.22

LABEL maintainer="GrcPay Project"
LABEL description="Development environment for grcpay backend service"

# better-sqlite3 ships prebuilt binaries for common platforms but
# falls back to compiling from source on Alpine, which needs the
# usual toolchain. Cheap on a one-time install.
RUN apk add --no-cache python3 make g++

WORKDIR /usr/src/app

COPY . /usr/src/app
RUN rm -rf ./node_modules

RUN npm install

# SQLite data directory — mount a volume here to persist data
RUN mkdir -p /usr/src/app/data

CMD ["npm", "run", "dev"]
