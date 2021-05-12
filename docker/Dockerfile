FROM node:12-alpine

RUN apk add --no-cache bash git openssh

WORKDIR /traveler
COPY package.json package-lock.json Gruntfile.js .gitignore ./
RUN npm install

COPY public ./public
COPY views ./views
COPY src ./src
COPY bin ./bin
## Needed for the version
COPY .git ./.git
RUN npm run build-all

CMD [ "./bin/app", "--config", "./config/demo_docker.jsonc" ]
