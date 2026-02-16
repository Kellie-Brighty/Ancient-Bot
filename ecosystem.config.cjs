module.exports = {
  apps: [{
    name: "safu-bot",
    script: "src/index.ts",
    interpreter: "bun",
    env: {
      NODE_ENV: "production",
    }
  }]
}
