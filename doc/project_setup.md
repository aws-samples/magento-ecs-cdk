# Project Setup

## The project is Bootstrap with Projen and rely on CDK

### Projen installation

```bash
npm install -g yarn
npx npm i projen -D
```

#### how this project was bootstrap with Projen (just for information):

```bash
$ git init
$ npm init -y
$ npm i projen -D
$ #git defender --setup // activate git defender if required
$ npx projen new awscdk-app-ts
```

The previous command created the `.projenrc.js` project configuration file.

From this file, projen can generate/update our application directory structure:

```bash
npx projen
```

You can create alias to launc h projen:

```bash
alias pj='npx projen'
```

then execute `pj` to bootstrap or upgrade your project.

```bash
pj
```
