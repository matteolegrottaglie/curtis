// ============================================================
//  Installazione del daemon come servizio dell'utente.
//
//  macOS: LaunchAgent (~/Library/LaunchAgents)
//  Linux: systemd user unit (~/.config/systemd/user)
//
//  Serve perché le campagne durano giorni: senza servizio, il motore
//  vive solo finché l'utente tiene aperto un terminale.
// ============================================================
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { appConfig, paths } from '../config.js';

export const SERVICE_LABEL = 'com.linkedin-sequencer-mcp';
const SYSTEMD_UNIT = 'linkedin-sequencer-mcp.service';

export interface ServiceTarget {
  /** Eseguibile node da usare (quello con cui gira adesso il CLI). */
  nodePath: string;
  /** Percorso dello script CLI (dist/cli.js). */
  cliPath: string;
  /** Avvia anche il motore all'accensione del servizio. */
  autostartEngine: boolean;
}

export function servicePath(): string {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
    : join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
}

export function isServiceInstalled(): boolean {
  return existsSync(servicePath());
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plist(t: ServiceTarget): string {
  const env: Record<string, string> = {
    LKSQ_DATA_DIR: appConfig.dataDir,
    LKSQ_PORT: String(appConfig.port),
    AUTOSTART_ENGINE: String(t.autostartEngine),
    // launchd parte con un PATH minimo: senza questo, `caffeinate` e i browser
    // di sistema non si trovano.
    PATH: `${dirname(t.nodePath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  const envXml = Object.entries(env)
    .map(([k, v]) => `    <key>${k}</key>\n    <string>${xmlEscape(v)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(t.nodePath)}</string>
    <string>${xmlEscape(t.cliPath)}</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(appConfig.dataDir)}</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(paths.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(paths.logFile)}</string>
</dict>
</plist>
`;
}

function systemdUnit(t: ServiceTarget): string {
  return `[Unit]
Description=LinkedIn Sequencer MCP
After=graphical-session.target

[Service]
Type=simple
ExecStart=${t.nodePath} ${t.cliPath} start
Environment=LKSQ_DATA_DIR=${appConfig.dataDir}
Environment=LKSQ_PORT=${appConfig.port}
Environment=AUTOSTART_ENGINE=${t.autostartEngine}
WorkingDirectory=${appConfig.dataDir}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

function run(cmd: string, args: string[]): { ok: boolean; output: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: out.trim() };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, output: (err.stderr ?? err.message ?? String(e)).trim() };
  }
}

export function installService(t: ServiceTarget): string[] {
  const target = servicePath();
  mkdirSync(dirname(target), { recursive: true });
  const steps: string[] = [];

  if (process.platform === 'darwin') {
    writeFileSync(target, plist(t));
    steps.push(`LaunchAgent scritto in ${target}`);
    const uid = process.getuid?.() ?? 501;
    run('/bin/launchctl', ['bootout', `gui/${uid}/${SERVICE_LABEL}`]); // ignora se non caricato
    const boot = run('/bin/launchctl', ['bootstrap', `gui/${uid}`, target]);
    if (boot.ok) steps.push('Servizio caricato (launchctl bootstrap)');
    else {
      const legacy = run('/bin/launchctl', ['load', '-w', target]);
      steps.push(legacy.ok ? 'Servizio caricato (launchctl load)' : `Caricamento fallito: ${boot.output}`);
    }
  } else if (process.platform === 'linux') {
    writeFileSync(target, systemdUnit(t));
    steps.push(`Unit systemd scritta in ${target}`);
    run('systemctl', ['--user', 'daemon-reload']);
    const en = run('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT]);
    steps.push(en.ok ? 'Servizio abilitato e avviato' : `Abilitazione fallita: ${en.output}`);
  } else {
    throw new Error(`piattaforma non supportata per l'installazione del servizio: ${process.platform}`);
  }

  return steps;
}

export function uninstallService(): string[] {
  const target = servicePath();
  const steps: string[] = [];

  if (process.platform === 'darwin') {
    const uid = process.getuid?.() ?? 501;
    run('/bin/launchctl', ['bootout', `gui/${uid}/${SERVICE_LABEL}`]);
    run('/bin/launchctl', ['unload', '-w', target]);
    steps.push('Servizio scaricato');
  } else if (process.platform === 'linux') {
    run('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT]);
    run('systemctl', ['--user', 'daemon-reload']);
    steps.push('Servizio disabilitato');
  }

  if (existsSync(target)) {
    rmSync(target, { force: true });
    steps.push(`Rimosso ${target}`);
  } else {
    steps.push('Nessun file di servizio da rimuovere');
  }
  return steps;
}
