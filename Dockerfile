FROM oven/bun:1-alpine
WORKDIR /app
COPY server ./server
COPY client ./client
EXPOSE 3000
CMD ["bun", "run", "server/server.js"]
