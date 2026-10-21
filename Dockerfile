FROM node:20-alpine
WORKDIR /app
COPY package.json uaserials-proxy.js uaserials-server.js ./
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "uaserials-server.js"]
