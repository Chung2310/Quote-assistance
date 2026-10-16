FROM node:20.19-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json yarn.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:20.19-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3013
# The deployment maps the runtime PORT from ENV_FILE.

RUN corepack enable
COPY package.json yarn.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

USER node
CMD ["node", "apps/api/dist/start.js"]
