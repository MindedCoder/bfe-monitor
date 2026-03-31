FROM docker.1ms.run/library/node:18-alpine

WORKDIR /app

COPY package.json ./
COPY config.json ./
COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]
