FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm install

# Source is volume-mounted in docker-compose, so no COPY needed for dev
EXPOSE 5173

CMD ["npm", "run", "dev"]
