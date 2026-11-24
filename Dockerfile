FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend/ frontend/
COPY contracts/ contracts/
RUN npm run build && cd contracts && npx hardhat compile

FROM node:24-bookworm-slim
ENV NODE_ENV=production BIND_HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/ backend/
COPY --from=build /app/frontend/dist/ frontend/dist/
COPY --from=build /app/contracts/artifacts/ contracts/artifacts/
USER node
CMD ["node", "backend/server.js"]
