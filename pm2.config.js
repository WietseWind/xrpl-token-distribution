module.exports = {
  apps: [{
    name: 'xrpldistr',
    script: 'index.js',
    watch: false,
    instances: 1,
    exec_mode: 'cluster',
    ignore_watch: ["node_modules", "db", ".git"],
    env: {
      DEBUG: 'xrpldistr:*'
    },
    env_production: {
      DEBUG: 'xrpldistr:*'
    }
  }]
}
