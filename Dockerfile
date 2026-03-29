FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist dist/
EXPOSE 4681
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["up", "--no-open"]
