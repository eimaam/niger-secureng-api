# Dockerfile 
# Use an official Node.js runtime v20 as the base image
FROM node:22-alpine

# Set the working directory in the container to /app
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to /app
COPY package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of the current directory contents to the container at /app
COPY . .

# Transpile the TypeScript code to JavaScript
RUN npm run build

# Make port 8000 available to the world outside this container
EXPOSE 8000

# Define the command to run the application
CMD ["node", "dist/api/index.js"]