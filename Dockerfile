FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src/ src/
COPY check-deps.js ./
RUN node check-deps.js && node -e "require('./src/proxy')"
EXPOSE 4002
CMD ["node", "src/cli.js"]
