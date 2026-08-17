FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Copy the static web UI into the working directory
COPY public ./public

CMD ["npm", "start"]
