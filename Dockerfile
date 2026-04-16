FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# Instalar dependencias incluyendo wake_on_lan
RUN npm ci --only=production
RUN npm install wake_on_lan
COPY . .
EXPOSE 8080
CMD ["node", "server/index.js"]