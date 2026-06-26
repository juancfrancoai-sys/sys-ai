# Build runtime image
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package definitions from AIWorker folder
COPY AIWorker/package*.json ./

# Install backend dependencies
RUN npm ci --only=production

# Copy the actual backend source code
COPY AIWorker/ ./

# Expose backend port
ENV PORT=3000
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
