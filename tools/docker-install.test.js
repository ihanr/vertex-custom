const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

// A source archive/build context has no .git. The real webpack config must work there.
const configFile = path.join(root, 'webui', 'vue.config.js');
const result = spawnSync(process.execPath, ['-e', `
  const config = require(${JSON.stringify(configFile)});
  config.chainWebpack({plugin(name) { return {tap(fn) {
    const args = name === 'define' ? [{'process.env': {}}] : [{}];
    fn(args);
    if (name === 'define') console.log(args[0]['process.env'].version);
  }}; }});
`], { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, VERTEX_DOCKER_BUILD: 'true' } });
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(result.stdout.trim()).version, 'custom');
console.log('PASS Docker frontend configuration builds without Git history');

// Compose validation does not need a running Docker daemon.
const compose = spawnSync('docker', ['compose', '-f', path.join(root, 'compose.yaml'), 'config', '--format', 'json'], {
  cwd: root, encoding: 'utf8', env: { ...process.env, VERTEX_BIND_IP: '127.0.0.1', VERTEX_PORT: '3000', VERTEX_DATA_DIR: './vertex' }
});
assert.equal(compose.status, 0, compose.stderr || String(compose.error));
const service = JSON.parse(compose.stdout).services.vertex;
assert.equal(service.build.context.replace(/\\/g, '/'), root.replace(/\\/g, '/'));
assert.equal(service.ports[0].host_ip, '127.0.0.1');
assert.equal(service.ports[0].target, 3000);
assert.equal(service.volumes[0].target, '/vertex');
assert.equal(service.volumes[0].type, 'bind');
assert.ok(!service.privileged);
assert.ok(service.healthcheck.test);
console.log('PASS Compose validates persistent data, local-only WebUI and healthcheck');
