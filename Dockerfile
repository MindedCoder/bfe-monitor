FROM docker.m.daocloud.io/library/node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production
COPY config.json ./
COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]
