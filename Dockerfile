# SmartMoney Terminal — self-host anywhere with normal egress.
# Your BYO keys (env or in-app) connect to live providers from here.
FROM node:22-alpine

WORKDIR /app

# devDependencies are required for `next build` (typescript, tailwind) —
# install with dev deps, then run the server in production mode.
COPY package*.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
