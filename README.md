# Cadl End-to-End Scenario

This repo contains the code and configuration for an end-to-end scenario for using Cadl to develop and deploy a full
application.

Support libraries that enable the demo features are in the `packages/` directory. The demo code itself is in the `demo/`
directory.

## Instructions

### Prerequisites

#### Install Node & NPM

Download and install from https://nodejs.org.

#### Install az cli

Follow the instructions [here](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli).

#### Install azd (Azure Accelerators)

Follow the instructions [here](https://github.com/azure/azure-dev)

#### Clone this repository

Clone this repository and cd into the root directory.

#### Install project dependencies & build

First, install our monorepo manager:

```bash
> npm install -g @microsoft/rush
```

Next, install the project's dependencies.

```bash
> rush install
```

Next, build the project.

```bash
> rush build
```

(Note that this step is only necessary for the demo and is not part of the experience)

### Running the Demo

1. Change your working directory to `./demo`, and open vscode in this directory.
2. Edit `app.cadl` if you'd like
3. Run `npm run build` which compiles the cadl to a variety of assets (openapi, bicep files, implementation stubs, clients, etc.)
4. Edit `./src/api/index.ts` and implement any function endpoints you've declared in your cadl file.
5. Edit your frontend code at `./src/web/build/index.html`.
6. Run `azd up` to deploy the application to the cloud.