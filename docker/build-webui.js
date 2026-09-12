const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const cwd = path.join(__dirname, '../webui');
const styles = path.join(cwd, 'public/assets/styles');
fs.mkdirSync(styles, { recursive: true });
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('WebUI build step failed: ' + args[0]);
};
for (const theme of ['dark', 'light', 'cyber']) {
  run([theme + '.js']);
  if (!fs.statSync(path.join(styles, theme + '.less')).size) throw new Error('Empty generated theme: ' + theme);
}
fs.appendFileSync(path.join(styles, 'cyber.less'), '\n@import url(/api/setting/getBackground.less);\n.body-bg { background:@vt-bg-image; background-position-x:center; background-position-y:center; background-size:cover; }\n.login-layout { background:@body-background; }\n');
fs.writeFileSync(path.join(styles, 'follow.less'), '');
run(['node_modules/@vue/cli-service/bin/vue-cli-service.js', 'build']);
if (!fs.statSync(path.join(cwd, '../app/static/index.html')).size) throw new Error('Missing WebUI entrypoint');
