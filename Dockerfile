FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist dist/
ENV DOCKSCOPE_NO_COMPOSE=1
ENV DOCKSCOPE_BIND=0.0.0.0
# State that must outlive the container: the access token above all. The default
# lives under the home directory, which is part of the writable layer and is
# discarded whenever the container is recreated, leaving the instance claimable
# again. Mount a volume here to keep it.
ENV DOCKSCOPE_STATE_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4681
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["up", "--no-open"]
