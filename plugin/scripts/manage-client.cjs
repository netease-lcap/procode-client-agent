var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// client/wave-plugin/shared.cjs
var require_shared = __commonJS({
  "client/wave-plugin/shared.cjs"(exports2, module2) {
    var fs2 = require("node:fs");
    var path2 = require("node:path");
    var { createHash, randomBytes } = require("node:crypto");
    function readConnection2(file) {
      return validateConnection(JSON.parse(fs2.readFileSync(file, "utf8")));
    }
    function validateConnection(record) {
      const url = new URL(record.url);
      if (record.version !== 1 || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || !url.port || !url.pathname.startsWith("/sessions/") || !/^[a-f0-9]{48}$/.test(url.searchParams.get("token") || "") || record.instanceId !== url.searchParams.get("token") || !path2.isAbsolute(record.cwd) || !Number.isInteger(record.pid) || record.pid <= 0 || decodeURIComponent(url.pathname.slice("/sessions/".length)) !== record.sessionId) {
        throw new Error("\u8FDE\u63A5\u6587\u4EF6\u683C\u5F0F\u65E0\u6548");
      }
      return record;
    }
    function endpoint2(record, pathname) {
      const url = new URL(pathname, record.url);
      url.search = new URL(record.url).search;
      return url;
    }
    async function verifyConnection2(record) {
      const response = await fetch(endpoint2(record, "/api/status"), { signal: AbortSignal.timeout(2500), redirect: "error" });
      if (!response.ok) throw new Error("\u670D\u52A1\u4E0D\u53EF\u7528\u6216\u8EAB\u4EFD\u9A8C\u8BC1\u5931\u8D25");
      const status = await response.json();
      if (status.sessionId !== record.sessionId || status.cwd !== record.cwd || status.pid !== record.pid || status.instanceId !== record.instanceId) throw new Error("\u670D\u52A1\u8EAB\u4EFD\u4E0E\u8FDE\u63A5\u6587\u4EF6\u4E0D\u4E00\u81F4");
      return status;
    }
    function writePrivateJson2(file, value) {
      fs2.mkdirSync(path2.dirname(file), { recursive: true, mode: 448 });
      const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        fs2.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 384, flag: "wx" });
        fs2.renameSync(temporary, file);
      } finally {
        if (fs2.existsSync(temporary)) fs2.unlinkSync(temporary);
      }
    }
    function exitReceiptPath2(record) {
      const id = createHash("sha256").update(JSON.stringify([record.instanceId, record.pid, record.startedAt])).digest("hex");
      return path2.join(record.cwd, ".data", "client-logs", `${id}.result.json`);
    }
    module2.exports = { readConnection: readConnection2, validateConnection, endpoint: endpoint2, verifyConnection: verifyConnection2, writePrivateJson: writePrivateJson2, exitReceiptPath: exitReceiptPath2 };
  }
});

// client/wave-plugin/manage-client.cjs
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
var crypto = require("node:crypto");
var { spawn } = require("node:child_process");
var { createConnection } = require("node:net");
var { readConnection, endpoint, verifyConnection, writePrivateJson, exitReceiptPath } = require_shared();
var digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var root = path.resolve(__dirname, "..");
var cache = process.env.PROCODE_CLIENT_CACHE_DIR || path.join(os.homedir(), ".procode-client-agent");
function parseArgs(args) {
  const [action = "status", ...rest] = args;
  if (!["start", "status", "connect", "stop"].includes(action)) throw new Error("\u6307\u4EE4\u53EA\u652F\u6301 start/status/connect/stop");
  const options = { action };
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i];
    if (["--open", "--rerun", "--restart"].includes(name)) options[name.slice(2)] = true;
    else if (["--workdir", "--connection-file", "--env-file", "--requirement", "--previous-workdir"].includes(name) && rest[i + 1] && !rest[i + 1].startsWith("--")) options[name.slice(2)] = rest[++i];
    else throw new Error(`\u672A\u77E5\u53C2\u6570\u6216\u7F3A\u5C11\u503C\uFF1A${name}`);
  }
  options.workdir = fs.realpathSync(path.resolve(options.workdir || process.cwd()));
  let current = options.workdir;
  for (let level = 0; level <= 5; level++) {
    const name = path.basename(current);
    const entry = name.endsWith("-resources") ? path.join(current, name.slice(0, -10)) : null;
    if (entry) {
      if (!fs.lstatSync(entry).isSymbolicLink()) throw new Error(`\u8D44\u6E90\u76EE\u5F55\u9879\u76EE\u5165\u53E3\u5FC5\u987B\u662F\u7B26\u53F7\u94FE\u63A5\uFF1A${entry}`);
      const original = path.join(path.dirname(current), name.slice(0, -10));
      if (fs.realpathSync(entry) !== fs.realpathSync(original)) throw new Error(`\u9879\u76EE\u94FE\u63A5\u6307\u5411\u5176\u4ED6\u76EE\u5F55\uFF1A${entry}`);
      options.workdir = fs.realpathSync(entry);
      break;
    }
    if (fs.existsSync(path.join(current, "docs")) && fs.statSync(path.join(current, "docs")).isDirectory()) {
      options.workdir = current;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return options;
}
function candidates(workdir) {
  const found = [];
  let current = workdir;
  for (let level = 0; level <= 5; level++) {
    found.push(path.join(current, ".data/client-service.json"));
    const name = path.basename(current);
    found.push(path.join(current, `${name}-resources/.data/client-service.json`));
    const parent = path.dirname(current);
    found.push(path.join(parent, `${name}-resources/.data/client-service.json`));
    if (parent === current) break;
    current = parent;
  }
  return [...new Set(found)];
}
function matchesWorkdir(record, workdir) {
  const relative = path.relative(record.cwd, workdir);
  if (relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative)) return true;
  return record.cwd === path.join(path.dirname(workdir), `${path.basename(workdir)}-resources`);
}
async function locate(options, requestedFile) {
  for (const file of requestedFile ? [requestedFile] : candidates(options.workdir)) {
    try {
      const record = readConnection(file);
      if (!requestedFile && !matchesWorkdir(record, options.workdir)) continue;
      const status = await verifyConnection(record);
      return { record, status };
    } catch (error) {
      if (requestedFile) throw error;
    }
  }
  return null;
}
function bind(record, status) {
  const file = path.join(cache, "connections", `${digest(record.cwd)}.json`);
  writePrivateJson(file, record);
  return {
    connected: true,
    workdir: record.cwd,
    interactionUrl: record.url,
    sessionId: record.sessionId,
    status: status.status,
    connectionFile: file
  };
}
async function waitForStop(record) {
  const file = exitReceiptPath(record);
  const alive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  };
  const port = Number(new URL(record.url).port);
  const released = () => new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 500 });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.once("error", (error) => finish(error.code === "ECONNREFUSED"));
  });
  const until = Date.now() + 22e3;
  while (Date.now() < until) {
    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (receipt && !alive(record.pid) && !alive(receipt.jobHostPid) && await released()) {
      if (!receipt.cleanupComplete) throw new Error(`\u670D\u52A1\u5DF2\u7ECF\u9000\u51FA\uFF0C\u4F46\u90E8\u5206\u8FDB\u7A0B\u672A\u786E\u8BA4\u6E05\u7406\uFF1B\u8BF7\u67E5\u770B ${file}`);
      return { stopped: true, workdir: record.cwd, resultFile: file };
    }
    await delay(200);
  }
  throw new Error("\u5DF2\u53D1\u9001\u505C\u6B62\u8BF7\u6C42\uFF0C\u4F46\u672A\u786E\u8BA4 CLI\u3001\u6258\u7BA1\u5668\u548C\u7AEF\u53E3\u5747\u5DF2\u9000\u51FA");
}
async function installRuntime() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/runtime.json"), "utf8"));
  if (path.basename(manifest.file) !== manifest.file || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("\u8FD0\u884C\u5305\u6E05\u5355\u65E0\u6548");
  const tarball = path.join(root, "assets", manifest.file);
  if (digest(fs.readFileSync(tarball)) !== manifest.sha256) throw new Error("\u8FD0\u884C\u5305\u6821\u9A8C\u5931\u8D25");
  const installed = path.join(cache, "runtimes", manifest.sha256);
  const cli = path.join(installed, "node_modules/procode-client-agent/dist/bin/client.js");
  if (fs.existsSync(path.join(installed, ".complete")) && fs.existsSync(cli)) return cli;
  fs.mkdirSync(path.dirname(installed), { recursive: true, mode: 448 });
  const staging = fs.mkdtempSync(path.join(path.dirname(installed), ".install-"));
  try {
    await new Promise((resolve, reject) => {
      const npmArgs = ["install", "--prefix", staging, "--ignore-scripts", "--no-audit", "--no-fund", tarball];
      let npm = "npm";
      if (process.platform === "win32") {
        const entry = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")].find((file) => file && file.endsWith("npm-cli.js") && fs.existsSync(file));
        if (!entry) {
          reject(new Error("\u65E0\u6CD5\u5B9A\u4F4D npm-cli.js\uFF0C\u8BF7\u5B89\u88C5\u5305\u542B npm \u7684 Node.js"));
          return;
        }
        npm = process.execPath;
        npmArgs.unshift(entry);
      }
      const child = spawn(
        npm,
        npmArgs,
        { shell: false, stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
      );
      let output = "";
      child.stderr.on("data", (chunk) => {
        output = (output + chunk).slice(-2e3);
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("\u51C6\u5907\u8FD0\u884C\u5305\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5 npm \u7F51\u7EDC\u548C\u76EE\u5F55\u6743\u9650"));
      }, 3e5);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`\u51C6\u5907\u8FD0\u884C\u5305\u5931\u8D25\uFF08${code}\uFF09\uFF0C\u8BF7\u68C0\u67E5 npm \u7F51\u7EDC\u548C\u76EE\u5F55\u6743\u9650`));
      });
    });
    fs.writeFileSync(path.join(staging, ".complete"), manifest.sha256);
    try {
      fs.renameSync(staging, installed);
    } catch (error) {
      if (!fs.existsSync(path.join(installed, ".complete"))) throw error;
    }
    if (!fs.existsSync(cli)) throw new Error("\u8FD0\u884C\u5305\u7F3A\u5C11 client \u5165\u53E3");
    return cli;
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}
async function main(args = process.argv.slice(2)) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || major === 22 && minor < 13) throw new Error("\u9700\u8981 Node.js >=22.13");
  const options = parseArgs(args);
  const supplied = options["connection-file"] && path.resolve(options["connection-file"]);
  const existing = await locate(options, supplied);
  if (options.action === "stop") {
    if (!supplied) throw new Error("stop \u5FC5\u987B\u6307\u5B9A --connection-file\uFF0C\u53EA\u505C\u6B62\u660E\u786E\u7ED1\u5B9A\u7684\u670D\u52A1");
    await fetch(endpoint(existing.record, "/api/stop"), { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(3e3), redirect: "error" }).then(async (response) => {
      if (!response.ok) throw new Error("\u505C\u6B62\u8BF7\u6C42\u672A\u88AB\u670D\u52A1\u63A5\u53D7");
      await response.body?.cancel();
    });
    if (existing.record.shutdownProtocol === 1) return waitForStop(existing.record);
    return { stopping: true, workdir: existing.record.cwd, note: "\u5DF2\u8BF7\u6C42\u53D6\u6D88\uFF1B\u4E0D\u4EE3\u8868\u5916\u90E8\u6D3E\u751F\u8FDB\u7A0B\u5747\u5DF2\u505C\u6B62" };
  }
  if (existing && !(options.action === "start" && (options.restart || options["previous-workdir"]))) return bind(existing.record, existing.status);
  if (options.action !== "start") return { connected: false, workdir: options.workdir };
  if (supplied) throw new Error("\u6307\u5B9A\u7684\u8FDE\u63A5\u4E0D\u53EF\u7528\uFF0C\u672A\u542F\u52A8\u5176\u4ED6\u670D\u52A1");
  let parent = options.workdir;
  for (; ; ) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(parent, "package.json"), "utf8"));
      if (["@lcap/procode-agent", "procode-client-agent", "hicode-sandbox-workspace"].includes(pkg.name)) throw new Error("\u62D2\u7EDD\u5728 procode \u6E90\u7801\u6216\u5B89\u88C5\u76EE\u5F55\u542F\u52A8\u5E94\u7528");
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  fs.mkdirSync(path.join(cache, "launches"), { recursive: true, mode: 448 });
  const id = digest(options.workdir);
  const lock = path.join(cache, "launches", `${id}.lock`);
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx", 384);
  } catch {
    throw new Error("\u8BE5\u76EE\u5F55\u5DF2\u6709\u542F\u52A8\u64CD\u4F5C\u6216\u9057\u7559\u542F\u52A8\u9501\uFF1B\u8BF7\u5148\u6838\u5BF9\u5DF2\u6709\u670D\u52A1\uFF0C\u4E0D\u4F1A\u91CD\u590D\u542F\u52A8");
  }
  let child;
  const ready = path.join(cache, "launches", `${id}.${crypto.randomBytes(8).toString("hex")}.json`);
  const resultFile = `${ready}.result.json`;
  const waiting = `${ready}.waiting`;
  try {
    fs.writeSync(descriptor, String(process.pid));
    writePrivateJson(waiting, { pid: process.pid });
    const cli = await installRuntime();
    const env = { ...process.env };
    if (options["env-file"]) {
      const values = JSON.parse(fs.readFileSync(path.resolve(options["env-file"]), "utf8"));
      for (const [key, value] of Object.entries(values)) {
        if (!/^(?:AGENT_|CLIENT_|BUILD_|CUSTOM_MODEL_|CUSTOM_PROVIDER_|LCAP_|CW_|NASL_|SPECKIT_|APP_NAME$)/.test(key) || typeof value !== "string") throw new Error("\u73AF\u5883\u6587\u4EF6\u4EC5\u652F\u6301\u6A21\u578B\u3001client \u548C\u6570\u636E\u670D\u52A1\u7684\u5B57\u7B26\u4E32\u914D\u7F6E");
        env[key] = value;
      }
    }
    const log = path.join(cache, "launches", `${id}.log`);
    const fd = fs.openSync(log, "a", 384);
    try {
      const argv = [cli, "--workdir", options.workdir, "--service-file", ready];
      if (options.open) argv.push("--open");
      if (options.rerun) argv.push("--rerun");
      if (options.restart) argv.push("--restart");
      if (options["previous-workdir"]) argv.push("--previous-workdir", path.resolve(options["previous-workdir"]));
      if (options.requirement) argv.push("--requirement", options.requirement);
      child = spawn(process.execPath, argv, { cwd: path.dirname(options.workdir), env, detached: true, windowsHide: true, stdio: ["ignore", fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    let launchError;
    child.once("error", (error) => {
      launchError = error;
    });
    child.unref();
    for (let attempt = 0; attempt < 1800; attempt++) {
      if (fs.existsSync(resultFile)) return JSON.parse(fs.readFileSync(resultFile, "utf8"));
      if (launchError || child.exitCode !== null || child.signalCode !== null) throw new Error(`CLI \u542F\u52A8\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u53D7\u4FDD\u62A4\u7684\u542F\u52A8\u65E5\u5FD7\uFF1A${log}`);
      if (fs.existsSync(ready)) {
        try {
          const record = readConnection(ready);
          const status = await verifyConnection(record);
          return bind(record, status);
        } catch (error) {
          if (!fs.existsSync(resultFile) && fs.existsSync(ready) && child.exitCode !== null) throw error;
        }
      }
      await delay(200);
    }
    child.kill("SIGTERM");
    throw new Error(`\u542F\u52A8\u8D85\u65F6\uFF0C\u5DF2\u8BF7\u6C42\u7EC8\u6B62\u672C\u6B21 CLI\uFF1B\u8BF7\u68C0\u67E5\u542F\u52A8\u65E5\u5FD7\uFF1A${log}`);
  } catch (error) {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    throw error;
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
    for (const file of [waiting, ready, resultFile]) fs.rmSync(file, { force: true });
  }
}
module.exports = { main, parseArgs, matchesWorkdir };
if (require.main === module) main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
