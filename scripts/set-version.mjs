// Ставит версию приложения во всех файлах сразу.
// Запуск: node scripts/set-version.mjs 0.0.1
// Версию релиза workflow берёт из имени ветки: release/0.0.1 -> 0.0.1.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
// Только X.Y.Z: по этой версии обновлятор сравнивает «новее/старее».
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`Версия должна быть вида 1.2.3, получено: ${version ?? '(пусто)'}`);
  process.exit(1);
}

function edit(path, fn) {
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after === before) {
    console.log(`${path}: без изменений`);
    return;
  }
  writeFileSync(path, after);
  console.log(`${path}: ${version}`);
}

function editJson(path, fn) {
  edit(path, (text) => {
    const data = JSON.parse(text);
    fn(data);
    return JSON.stringify(data, null, 2) + '\n';
  });
}

editJson('package.json', (p) => (p.version = version));
editJson('package-lock.json', (l) => {
  l.version = version;
  l.packages[''].version = version;
});
// не через JSON.stringify, чтобы не менять форматирование остального конфига
edit('src-tauri/tauri.conf.json', (t) => t.replace(/"version": ".*?"/, `"version": "${version}"`));

// version в секции [package] — первая строка version = "..." в файле
edit('src-tauri/Cargo.toml', (t) => t.replace(/^version = ".*"$/m, `version = "${version}"`));
// запись самого приложения в Cargo.lock
edit('src-tauri/Cargo.lock', (t) =>
  t.replace(/(\[\[package\]\]\r?\nname = "macro-studio"\r?\nversion = )".*"/, `$1"${version}"`),
);
