# SmartMoney Terminal — self-host anywhere with normal egress.
# Your BYO keys (env or in-app) connect to live providers from here.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
