FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "tsx/esm", "server.ts"]
