FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
RUN mkdir -p /data
ENV PORT=3000
ENV DB_FILE=/data/rcc_stocks.db
ENV JWT_SECRET=RCC_STOCKS_V11_LOCAL_SECRET_2026
EXPOSE 3000
CMD ["node","server.js"]
