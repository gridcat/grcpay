FROM node:22.16.0-alpine3.22

LABEL maintainer="Gridcoin Pay Project"
LABEL description="Development environment for grcpay backend service"

# Prisma's query engine binary dynamically links against libssl/libcrypto and
# runs its own OpenSSL-version detection against the system filesystem.
# node:*-alpine ships Node with a bundled OpenSSL but no system libssl,
# so detection fails and Prisma falls back to the wrong engine binary.
RUN apk add --no-cache openssl

WORKDIR /usr/src/app

COPY . /usr/src/app
RUN rm -rf ./node_modules

RUN npm install

# SQLite data directory — mount a volume here to persist data
RUN mkdir -p /usr/src/app/data

CMD ["npm", "run", "dev"]
