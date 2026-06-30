FROM node:22-alpine
WORKDIR /app
COPY package.json .
COPY src/ src/
RUN node -c src/*.js && node -e "require('./src/proxy')" && mkdir -p /app/data
ENV DATA_DIR=/app/data
EXPOSE 4002
CMD ["node", "src/cli.js"]
